/**
 * Model B validation: topology mapping, shared (paired) population, physical invariants,
 * reproducibility, closures, reporting, and consistency with the Model C bounds.
 */
import { describe, expect, it } from 'vitest';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { networkFor } from '../src/network/NetworkGraph';
import { NetworkSimulation, PH, runNetworkSimulation } from '../src/network/NetworkSimulation';
import { staticMaxFlow } from '../src/network/StaticFlow';
import { releasesFromPopulation, timeExpandedFlow } from '../src/network/TimeExpanded';
import { mergeConfig } from '../src/simulation/Params';
import { createPopulation } from '../src/simulation/Population';
import { scenarioById } from '../src/simulation/Scenarios';

const geo = BAILEY_HALL;
const cfg = scenarioById('concert-emergency');
const net = networkFor(geo, cfg);

describe('network topology and mapping to physical features', () => {
  it('every official connection is one network edge with the same feature id', () => {
    const ids = [
      ...['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'],
      ...['OST_FW', 'OST_MW', 'OST_BW', 'OST_FE', 'OST_ME', 'OST_BE'],
      ...['FC1', 'FC2', 'FC3'],
      ...['P1', 'P2', 'P3', 'P4'],
      ...['F1', 'F2', 'F3', 'F4', 'F5'],
      ...['BSF1W', 'BSF2W', 'BSF1E', 'BSF2E'],
    ];
    for (const id of ids) {
      const matches = net.edges.filter((e) => e.id === id);
      expect(matches.length, id).toBe(1);
      expect(matches[0].links).toEqual([id]);
      expect(geo.links.some((l) => l.id === id)).toBe(true);
    }
    // 13 exterior doors: 5 foyer, 4 portico, 2 stage escape, 2 balcony stairwells
    expect(net.edges.filter((e) => e.exterior).length).toBe(13);
    expect(net.sinks.length).toBe(13);
  });

  it('network nodes are real detailed nodes and every walkable link is represented exactly once', () => {
    for (const n of net.nodes) {
      if (n.kind === 'source') continue;
      const d = geo.nodes.find((x) => x.id === n.id)!;
      expect(d).toBeTruthy();
      expect(n.x).toBe(d.x);
      expect(n.y).toBe(d.y);
    }
    const seen = new Map<string, number>();
    for (const e of net.edges) for (const l of e.links) seen.set(l, (seen.get(l) ?? 0) + 1);
    for (const [, c] of seen) expect(c).toBe(1);
    expect(seen.has('ELEV_link')).toBe(false);
    // chain lengths are the sums of the detailed link lengths
    for (const e of net.edges) {
      if (e.kind === 'rowExit') continue;
      const sum = e.links.reduce((s, id) => s + net.detailed.links[net.detailed.linkIndex.get(id)!].len, 0);
      expect(e.length).toBeCloseTo(sum, 6);
    }
  });

  it('every seat reaches a source and a row end, and every source can reach an exit', () => {
    for (const s of geo.seats) {
      expect(net.sourceOfZone.has(s.zone)).toBe(true);
      expect((net.rowEnds.get(s.link) ?? []).length, s.id).toBeGreaterThan(0);
    }
    for (const [, src] of net.sourceOfZone) {
      const seen = new Uint8Array(net.nodes.length);
      const st = [src];
      seen[src] = 1;
      while (st.length) {
        const u = st.pop()!;
        for (const ai of net.out[u]) {
          const v = net.arcs[ai].to;
          if (!seen[v]) {
            seen[v] = 1;
            st.push(v);
          }
        }
      }
      expect(net.sinks.some((s) => seen[s])).toBe(true);
    }
  });

  it('storey-height stairs are descend-only and nothing leaves a sink', () => {
    for (const A of net.arcs) {
      const E = net.edges[A.edge];
      expect(net.nodes[A.from].kind).not.toBe('sink');
      if (E.isStair && E.links.length === 1) {
        const li = net.detailed.linkIndex.get(E.links[0])!;
        expect(net.detailed.climbs(li, A.dir)).toBe(false);
      }
    }
  });
});

describe('paired population (common random numbers across models)', () => {
  it('Model B simulates exactly the same people as Model A for a seed', () => {
    const A = createPopulation(geo, cfg, 11).agents;
    const B = new NetworkSimulation(geo, cfg, 11).agents;
    expect(B.length).toBe(A.length);
    for (let i = 0; i < A.length; i++) {
      for (const k of ['seat', 'type', 'v0', 'tRecognition', 'tResponse', 'tPrepare', 'uCM', 'uLED', 'knownExits', 'group', 'wheelchair', 'familiar'] as const) expect((B[i] as any)[k]).toEqual((A[i] as any)[k]);
    }
  });
});

describe('Model B invariants (full house, concert emergency)', () => {
  const sim = new NetworkSimulation(geo, cfg, 4);
  const entries: { agent: number; arc: number; t: number }[] = [];
  sim.traceHook = (e) => entries.push(e);
  const conservation: string[] = [];
  while (!sim.finished) {
    sim.step();
    if (sim.steps % 8 === 0) {
      const counts = [0, 0, 0, 0, 0, 0];
      for (const n of sim.na) counts[n.phase]++;
      if (counts.reduce((a, b) => a + b, 0) !== sim.agents.length) conservation.push(`t=${sim.t}`);
      const q = sim.queues.reduce((s, x) => s + x.length, 0);
      const inQ = sim.na.filter((n) => n.phase === PH.QUEUE && n.arc >= 0).length;
      if (q !== inQ) conservation.push(`queues t=${sim.t}: ${q} vs ${inQ}`);
    }
  }
  const r = sim.result();

  it('completes: everybody leaves, no gridlock, wheelchair users awaiting assistance', () => {
    expect(r.allLeftBuilding).toBe(true);
    expect(r.gridlock).toBe(false);
    expect(r.unresolved.awaitingAssistance).toBe(3);
    expect(r.tEvac).toBeGreaterThan(60);
    expect(r.tEvac).toBeLessThan(900);
  });

  it('population is conserved and queues are consistent', () => {
    expect(conservation).toEqual([]);
    const s = r.series;
    for (let k = 0; k < s.inside.length; k++) expect(s.inside[k] + s.leftBuilding[k]).toBe(r.N);
    for (let k = 1; k < s.leftBuilding.length; k++) expect(s.leftBuilding[k]).toBeGreaterThanOrEqual(s.leftBuilding[k - 1]);
    expect(s.leftBuilding[s.leftBuilding.length - 1]).toBe(r.N);
  });

  it('nobody is counted as evacuated twice and moves only between adjacent edges', () => {
    const exits = new Map<number, number>();
    const lastArc = new Map<number, number>();
    for (const e of entries) {
      const A = net.arcs[e.arc];
      if (net.edges[A.edge].exterior) exits.set(e.agent, (exits.get(e.agent) ?? 0) + 1);
      const prev = lastArc.get(e.agent);
      if (prev !== undefined) expect(net.arcs[prev].to).toBe(A.from);
      lastArc.set(e.agent, e.arc);
    }
    for (const v of exits.values()) expect(v).toBe(1);
    expect(exits.size).toBe(r.N);
    expect(Object.values(r.exitGroupUsage).reduce((a, b) => a + b, 0)).toBe(r.N);
  });

  it('no arc ever exceeds its capacity in any 10 s window (token bucket, burst 1)', () => {
    const W = 10;
    const mult = 1 + cfg.movement.fasterIsSlower.gain * cfg.movement.urgency;
    for (const [ai, log] of sim.passLog) {
      const E = net.edges[net.arcs[ai].edge];
      const cap = E.capacity * (E.isGate ? mult : 1);
      for (let s = 0; s + W <= log.length; s++) {
        let n = 0;
        for (let k = s; k < s + W; k++) n += log[k];
        expect(n).toBeLessThanOrEqual(cap * W + 1 + 1e-9);
      }
    }
  });

  it('the network discharge never exceeds the static max-flow bound (30 s windows)', () => {
    const F = staticMaxFlow(net, cfg, r.N, { sourceMode: 'unlimited' }).maxFlow;
    const s = r.series.leftBuilding;
    const W = 30;
    for (let k = 0; k + W < s.length; k++) expect(s[k + W] - s[k]).toBeLessThanOrEqual(F * W + 13);
  });

  it('no simulated run beats the ideal time-expanded bound (fastest walkers, immediate start)', () => {
    const pop = createPopulation(geo, cfg, 4);
    const rel = releasesFromPopulation(net, cfg, pop.agents.map((a) => ({ seat: a.seat, tDepart: 0 })));
    const lb = timeExpandedFlow(net, cfg, rel, { speed: cfg.population.speedMax, storage: false });
    expect(r.tEvac).toBeGreaterThanOrEqual(lb.tStar - 2);
  });
});

describe('Model B: reproducibility, closures and reporting', () => {
  it('same seed gives identical results; different seeds vary', () => {
    const a = runNetworkSimulation(geo, cfg, 21).result;
    const b = runNetworkSimulation(geo, cfg, 21).result;
    expect(a.tEvac).toBe(b.tEvac);
    expect(a.exitDoorUsage).toEqual(b.exitDoorUsage);
    const t = [22, 23, 24].map((s) => runNetworkSimulation(geo, cfg, s).result.tEvac);
    expect(new Set([a.tEvac, ...t].map((x) => x.toFixed(2))).size).toBeGreaterThan(1);
  });

  it('a blocked exit and corridor barriers never discharge anybody', () => {
    for (const id of ['blocked-discovery', 'blocked-announced', 'blocked-immediate', 'barriers']) {
      const c = scenarioById(id);
      const { sim, result } = runNetworkSimulation(geo, c, 2);
      for (const e of [...sim.closed]) for (const A of net.arcs) if (A.edge === e) expect(sim.passes[A.idx]).toBe(0);
      expect(result.allLeftBuilding).toBe(true);
    }
  });

  it('an unfinished run is reported as unfinished; missing accessible routes as trapped', () => {
    const r = runNetworkSimulation(geo, mergeConfig(cfg, { tMax: 60 }), 1).result;
    expect(r.completed).toBe(false);
    expect(Number.isNaN(r.tEvac)).toBe(true);
    expect(r.unresolved.inside).toBeGreaterThan(0);
    const f = runNetworkSimulation(geo, scenarioById('blocked-foyer'), 1).result;
    expect(f.unresolved.trapped).toBe(3);
    expect(Number.isNaN(f.tEvac)).toBe(true);
    expect(Number.isFinite(f.tEvacAmbulatory)).toBe(true);
  });

  it('guidance compliance changes route choices', () => {
    const plan = cfg.led.plan;
    const share = (p: number) => {
      const c = mergeConfig(scenarioById('led'), { crowdManagers: { count: 0 }, led: { complianceProb: p } });
      const { sim } = runNetworkSimulation(geo, c, 8);
      let follow = 0;
      for (const n of sim.na) {
        const E = n.exitEdge >= 0 ? net.edges[n.exitEdge] : null;
        if (E && ['FOYER', 'PORTICO_W', 'PORTICO_E', 'STAGE_W', 'STAGE_E', 'BAL_NW', 'BAL_NE'][E.exitGroup] === plan[geo.seats[n.a.seat].zone]) follow++;
      }
      return follow / sim.na.length;
    };
    expect(share(1)).toBeGreaterThan(share(0) + 0.1);
  });
});
