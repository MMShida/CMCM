/**
 * Model C validation: max flow / min cut and the time-expanded network on small networks
 * with known answers, then on the Bailey Hall network.
 */
import { describe, expect, it } from 'vitest';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { FlowNetwork } from '../src/network/MaxFlow';
import { networkFor } from '../src/network/NetworkGraph';
import { staticMaxFlow } from '../src/network/StaticFlow';
import { releasesFromPopulation, stepCapacity, timeExpandedFlow } from '../src/network/TimeExpanded';
import { createPopulation } from '../src/simulation/Population';
import { RNG } from '../src/simulation/Random';
import { scenarioById } from '../src/simulation/Scenarios';

/** minimal stand-in for BuildingNetwork: a list of nodes and directed arcs */
function tiny(spec: { nodes: ('source' | 'junction' | 'sink')[]; storage?: number[]; arcs: [number, number, number, number][] }) {
  // arcs: [from, to, capacity (p/s), length (m)]  (speed 1 m/s => transit = length)
  const nodes = spec.nodes.map((kind, idx) => ({ idx, id: `n${idx}`, kind, storage: kind === 'junction' ? (spec.storage?.[idx] ?? Infinity) : Infinity, exitGroup: kind === 'sink' ? 0 : -1, floor: 1, x: 0, y: 0 }));
  const edges = spec.arcs.map(([a, b, c, len], idx) => ({ idx, id: `e${idx}`, a, b, capacity: c, length: len, isStair: false, isGate: false, exterior: nodes[b].kind === 'sink', exitGroup: 0, kind: 'corridor' }));
  const arcs = spec.arcs.map(([a, b], idx) => ({ idx, edge: idx, from: a, to: b, dir: 1 }));
  return {
    nodes,
    edges,
    arcs,
    sinks: nodes.filter((n) => n.kind === 'sink').map((n) => n.idx),
    sourceOfZone: new Map(nodes.filter((n) => n.kind === 'source').map((n) => [n.id, n.idx])),
    rates: { vRep: 1, urgencyMult: 1 },
    edgesForLinks: (ids: string[]) => ids.map((id) => Number(id.slice(1))),
  } as any;
}
const cfg0 = { blocked: { links: [] }, barriers: [], population: { stairRatio: 1 } } as any;
const release = (src: number, n: number, t = 0) => Array.from({ length: n }, () => ({ source: src, t }));

describe('maximum flow / minimum cut (small networks)', () => {
  it('CLRS example: max flow 23 equals the min-cut capacity', () => {
    const F = new FlowNetwork();
    F.addNodes(6);
    const E: [number, number, number][] = [
      [0, 1, 16],
      [0, 2, 13],
      [1, 2, 10],
      [2, 1, 4],
      [1, 3, 12],
      [3, 2, 9],
      [2, 4, 14],
      [4, 3, 7],
      [3, 5, 20],
      [4, 5, 4],
    ];
    for (const [u, v, c] of E) F.addArc(u, v, c);
    expect(F.maxflow(0, 5)).toBeCloseTo(23, 9);
    const cut = F.minCut(0);
    expect(cut.reduce((s, e) => s + F.cap0[e], 0)).toBeCloseTo(23, 9);
  });

  it('max flow equals min-cut capacity on 40 random networks, and blocking an arc never increases it', () => {
    const rng = new RNG(7, 'flowtest');
    for (let k = 0; k < 40; k++) {
      const n = 4 + rng.int(10);
      const arcs: [number, number, number][] = [];
      for (let i = 0; i < 3 * n; i++) {
        const u = rng.int(n);
        const v = rng.int(n);
        if (u !== v) arcs.push([u, v, 1 + rng.int(9)]);
      }
      const build = (skip = -1) => {
        const F = new FlowNetwork();
        F.addNodes(n);
        arcs.forEach(([u, v, c], i) => i !== skip && F.addArc(u, v, c));
        return F;
      };
      const F = build();
      const f = F.maxflow(0, n - 1);
      const cut = F.minCut(0).reduce((s, e) => s + F.cap0[e], 0);
      expect(cut).toBeCloseTo(f, 9);
      if (arcs.length) {
        const G = build(rng.int(arcs.length));
        expect(G.maxflow(0, n - 1)).toBeLessThanOrEqual(f + 1e-9);
      }
    }
  });

  it('incremental augmentation reaches the same maximum as a fresh computation', () => {
    const F = new FlowNetwork();
    F.addNodes(4);
    F.addArc(0, 1, 3);
    F.addArc(1, 3, 2);
    const f1 = F.maxflow(0, 3);
    F.addArc(0, 2, 5);
    F.addArc(2, 3, 4);
    const f2 = F.maxflow(0, 3);
    expect(f1).toBe(2);
    expect(f1 + f2).toBe(6);
  });
});

describe('time-expanded network (small networks with known answers)', () => {
  it('single corridor: T* = tau + ceil(N / c) - 1', () => {
    // N = 10 people, 2 persons/s, 3 s transit: departures at 0..4, arrivals at 3..7
    const net = tiny({ nodes: ['source', 'sink'], arcs: [[0, 1, 2, 3]] });
    const r = timeExpandedFlow(net, cfg0, release(0, 10));
    expect(r.tStar).toBe(7);
    expect(r.curve.slice(0, 8)).toEqual([0, 0, 0, 2, 4, 6, 8, 10]);
  });

  it('two parallel routes (1 p/s, 2 s and 1 p/s, 5 s): T* = 8 for N = 10', () => {
    const net = tiny({
      nodes: ['source', 'sink'],
      arcs: [
        [0, 1, 1, 2],
        [0, 1, 1, 5],
      ],
    });
    const r = timeExpandedFlow(net, cfg0, release(0, 10));
    expect(r.tStar).toBe(8);
  });

  it('release times delay the benchmark (departure constraints are respected)', () => {
    const net = tiny({ nodes: ['source', 'sink'], arcs: [[0, 1, 2, 3]] });
    const r = timeExpandedFlow(net, cfg0, release(0, 10, 20));
    expect(r.tStar).toBe(27);
    expect(r.curve[22]).toBe(0);
  });

  it('a closed edge carries no flow; closing the only route makes evacuation impossible', () => {
    const net = tiny({
      nodes: ['source', 'junction', 'sink'],
      arcs: [
        [0, 1, 2, 1],
        [1, 2, 2, 1],
      ],
    });
    const r = timeExpandedFlow(net, { ...cfg0, blocked: { links: ['e1'] } }, release(0, 5), { maxHorizon: 60 });
    expect(Number.isNaN(r.tStar)).toBe(true);
    expect(r.curve[r.curve.length - 1]).toBe(0);
  });

  it('the earliest-arrival curve equals a fresh max-flow computation at every horizon', () => {
    // bottleneck network with a holdover-limited junction
    const net = tiny({
      nodes: ['source', 'junction', 'junction', 'sink'],
      storage: [0, 3, 2, 0],
      arcs: [
        [0, 1, 3, 1],
        [1, 2, 1.5, 2],
        [0, 2, 0.7, 4],
        [2, 3, 2, 1],
        [1, 3, 0.4, 6],
      ],
    });
    const rel = [...release(0, 25), ...release(0, 10, 4)];
    const full = timeExpandedFlow(net, cfg0, rel);
    for (let H = 0; H < full.curve.length; H++) {
      const one = timeExpandedFlow(net, cfg0, rel, { maxHorizon: H });
      expect(one.curve[one.curve.length - 1]).toBe(full.curve[H]);
    }
    for (let k = 1; k < full.curve.length; k++) expect(full.curve[k]).toBeGreaterThanOrEqual(full.curve[k - 1]);
  });

  it('cumulative-floor discretisation never exceeds c*K*dt + 1 in any K consecutive steps', () => {
    for (const c of [0.37, 0.99, 1.64, 2.06, 4.7])
      for (const dt of [0.25, 0.5, 1])
        for (let k0 = 0; k0 < 40; k0 += 7)
          for (const K of [1, 3, 10, 30]) {
            let s = 0;
            for (let k = k0; k < k0 + K; k++) s += stepCapacity(c, k, dt);
            expect(s).toBeLessThanOrEqual(c * K * dt + 1 + 1e-9);
            expect(s).toBeGreaterThanOrEqual(c * K * dt - 1 - 1e-9);
          }
  });
});

describe('Bailey Hall network flows', () => {
  const cfg = scenarioById('concert-emergency');
  const net = networkFor(BAILEY_HALL, cfg);
  const N = 1329;

  it('static max flow equals the min-cut capacity and is reported in persons/s', () => {
    const r = staticMaxFlow(net, cfg, N);
    expect(r.maxFlow).toBeGreaterThan(0);
    expect(r.cutCapacity).toBeCloseTo(r.maxFlow, 6);
    expect(r.requiredRate).toBeCloseTo(N / 180, 9);
    for (const c of r.cut) expect(net.edgeIndex.has(c.id)).toBe(true);
  });

  it('closing exits or placing barriers can only reduce the maximum flow', () => {
    const base = staticMaxFlow(net, cfg, N, { closed: [], barriers: [] }).maxFlow;
    for (const ids of [['FC2'], ['F1', 'F2'], ['P1', 'P2', 'P3', 'P4'], ['OST_FW']]) expect(staticMaxFlow(net, cfg, N, { closed: ids, barriers: [] }).maxFlow).toBeLessThanOrEqual(base + 1e-9);
    const bar = net.edges.filter((e) => e.barrierSlot).map((e) => e.id);
    expect(staticMaxFlow(net, cfg, N, { closed: [], barriers: bar }).maxFlow).toBeLessThanOrEqual(base + 1e-9);
  });

  it('time-expanded benchmark: T* >= N / F*, blocked edges carry no flow, curve reaches N', () => {
    const pop = createPopulation(BAILEY_HALL, cfg, 1);
    const rel = releasesFromPopulation(net, cfg, pop.agents.map((a) => ({ seat: a.seat, tDepart: 0 })));
    const F = staticMaxFlow(net, cfg, N).maxFlow;
    const r = timeExpandedFlow(net, cfg, rel);
    expect(Number.isFinite(r.tStar)).toBe(true);
    expect(r.tStar).toBeGreaterThanOrEqual(N / F - 1);
    expect(r.curve[r.curve.length - 1]).toBe(N);
    const blocked = timeExpandedFlow(net, cfg, rel, { closed: ['FC1', 'FC2', 'FC3'] });
    expect(blocked.exitUsage.FOYER ?? 0).toBe(0);
    expect(blocked.tStar).toBeGreaterThanOrEqual(r.tStar);
  });
});
