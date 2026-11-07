import { describe, expect, it } from 'vitest';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { ST } from '../src/simulation/Agent';
import { batchSeeds, runBatch } from '../src/simulation/MonteCarlo';
import { defaultConfig, mergeConfig } from '../src/simulation/Params';
import { createPopulation } from '../src/simulation/Population';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine, runSimulation } from '../src/simulation/SimulationEngine';

const geo = BAILEY_HALL;

describe('population', () => {
  it('generates exactly the selected occupancy', () => {
    expect(createPopulation(geo, defaultConfig(), 1).agents.length).toBe(1329);
    const half = mergeConfig(defaultConfig(), { occupancy: { orchestra: 0.5, mezzanine: 0.5, balcony: 0.5 } });
    expect(createPopulation(geo, half, 1).agents.length).toBe(Math.round(0.5 * 527) + Math.round(0.5 * 486) + Math.round(0.5 * 316));
  });

  it('respects floor capacities and uses each seat at most once', () => {
    const cfg = mergeConfig(defaultConfig(), { occupancy: { orchestra: 0.3, mezzanine: 0.9, balcony: 1 } });
    const { agents } = createPopulation(geo, cfg, 7);
    const by = { orchestra: 0, mezzanine: 0, balcony: 0 };
    const seats = new Set<number>();
    for (const a of agents) {
      by[geo.seats[a.seat].level]++;
      seats.add(a.seat);
    }
    expect(seats.size).toBe(agents.length);
    expect(by.orchestra).toBe(Math.round(0.3 * 527));
    expect(by.mezzanine).toBe(Math.round(0.9 * 486));
    expect(by.balcony).toBe(316);
  });

  it('same seed -> same audience; different seed -> different audience', () => {
    const a = createPopulation(geo, defaultConfig(), 3).agents;
    const b = createPopulation(geo, defaultConfig(), 3).agents;
    const c = createPopulation(geo, defaultConfig(), 4).agents;
    expect(a.map((x) => x.v0)).toEqual(b.map((x) => x.v0));
    expect(a.map((x) => x.tResponse)).not.toEqual(c.map((x) => x.tResponse));
  });

  it('the audience does not depend on the intervention (common random numbers)', () => {
    const a = createPopulation(geo, scenarioById('concert-emergency'), 11).agents;
    const b = createPopulation(geo, scenarioById('led-barriers'), 11).agents;
    expect(a.map((x) => [x.seat, x.v0, x.tResponse, x.type])).toEqual(b.map((x) => [x.seat, x.v0, x.tResponse, x.type]));
  });
});

describe('simulation invariants (full house, concert emergency)', () => {
  const cfg = scenarioById('concert-emergency');
  const sim = new SimulationEngine(geo, cfg, 5);
  const traversals: { agent: number; from: number; to: number }[] = [];
  sim.traceHook = (e) => traversals.push(e);
  const conservationErrors: string[] = [];
  const g = sim.graph;
  while (!sim.finished) {
    sim.step();
    if (sim.steps % 10 === 0) {
      let onLinks = 0;
      for (const n of sim.movement.linkCount) onLinks += n;
      const seated = sim.agents.filter((a) => a.link < 0 && !a.done && a.state !== ST.TRAPPED).length;
      const done = sim.agents.filter((a) => a.done).length;
      const trapped = sim.agents.filter((a) => a.state === ST.TRAPPED && a.link < 0).length;
      if (onLinks + seated + done + trapped !== sim.agents.length) conservationErrors.push(`t=${sim.t}: ${onLinks}+${seated}+${done}+${trapped}`);
    }
  }
  const res = sim.result();

  it('completes and everyone leaves the building', () => {
    expect(res.allLeftBuilding).toBe(true);
    expect(res.gridlock).toBe(false);
    expect(res.tEvac).toBeGreaterThan(60);
    expect(res.tEvac).toBeLessThan(900);
  });

  it('occupancy is conserved across floors, stairs and exits', () => {
    expect(conservationErrors).toEqual([]);
  });

  it('agents only move between adjacent links (no teleporting)', () => {
    const bad = traversals.filter((e) => {
      const A = g.links[e.from];
      const B = g.links[e.to];
      return !(A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b);
    });
    expect(bad.length).toBe(0);
  });

  it('nobody uses the prohibited elevator', () => {
    const elev = g.linkIndex.get('ELEV_link')!;
    expect(traversals.some((e) => e.to === elev)).toBe(false);
  });

  it('no agent is counted as evacuated twice', () => {
    const exteriorEntries = new Map<number, number>();
    for (const e of traversals) if (g.links[e.to].exterior) exteriorEntries.set(e.agent, (exteriorEntries.get(e.agent) ?? 0) + 1);
    for (const v of exteriorEntries.values()) expect(v).toBe(1);
    const usage = Object.values(res.exitGroupUsage).reduce((a, b) => a + b, 0);
    expect(usage).toBe(res.N);
    expect(res.series.leftBuilding[res.series.leftBuilding.length - 1]).toBe(res.N);
  });

  it('evacuated count is monotonically non-decreasing', () => {
    const s = res.series.leftBuilding;
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
    const safe = res.series.safe;
    for (let i = 1; i < safe.length; i++) expect(safe[i]).toBeGreaterThanOrEqual(safe[i - 1]);
  });

  it('door and stair throughput never exceeds the implemented capacity', () => {
    const W = 10;
    for (const [li, log] of sim.gates.passLog) {
      const cap = sim.gates.maxCap(li);
      for (let s = 0; s + W <= log.length; s++) {
        let n = 0;
        for (let k = s; k < s + W; k++) n += log[k];
        expect(n).toBeLessThanOrEqual(cap * W + 1 + 1e-9);
      }
    }
  });

  it('wheelchair users are not reported as safe: they wait at the assistance point', () => {
    const wc = sim.agents.filter((a) => a.wheelchair);
    expect(wc.length).toBe(3);
    for (const a of wc) expect(a.state).toBe(ST.AWAITING_ASSIST);
    expect(res.unresolved.awaitingAssistance).toBe(3);
  });
});

describe('reproducibility and variation', () => {
  it('same seed and configuration give identical results', () => {
    const cfg = scenarioById('concert-emergency');
    const a = runSimulation(geo, cfg, 42, { agents: true });
    const b = runSimulation(geo, cfg, 42, { agents: true });
    expect(a.tEvac).toBe(b.tEvac);
    expect(a.exitDoorUsage).toEqual(b.exitDoorUsage);
    expect(a.agents!.map((x) => x.tLeftBuilding)).toEqual(b.agents!.map((x) => x.tLeftBuilding));
  });

  it('different seeds produce plausible variation', () => {
    const cfg = scenarioById('concert-emergency');
    const t = [1, 2, 3, 4].map((s) => runSimulation(geo, cfg, s).tEvac);
    expect(new Set(t.map((x) => x.toFixed(1))).size).toBeGreaterThan(1);
    for (const x of t) {
      expect(x).toBeGreaterThan(100);
      expect(x).toBeLessThan(700);
    }
  });

  it('batched and individually run simulations agree for the same seeds', () => {
    const cfg = scenarioById('occ-25');
    const seeds = batchSeeds(9, 3);
    const batch = runBatch(geo, cfg, seeds);
    const single = seeds.map((s) => runSimulation(geo, cfg, s));
    expect(batch.map((r) => r.tEvac)).toEqual(single.map((r) => r.tEvac));
    expect(batch.map((r) => r.p95Exit)).toEqual(single.map((r) => r.p95Exit));
  });
});

describe('interventions and obstructions', () => {
  it('a blocked exit never discharges anybody', () => {
    for (const k of ['discovery', 'announced', 'immediate'] as const) {
      const sim = new SimulationEngine(geo, scenarioById(`blocked-${k}`), 2);
      sim.run();
      const li = sim.graph.linkIndex.get('FC2')!;
      expect(sim.gates.passes[li]).toBe(0);
      expect(sim.result().allLeftBuilding).toBe(true);
    }
  });

  it('corridor barriers are never crossed', () => {
    const sim = new SimulationEngine(geo, scenarioById('barriers'), 3);
    sim.run();
    for (const li of sim.barrierLinks) expect(sim.gates.passes[li]).toBe(0);
  });

  it('guidance compliance changes behaviour probabilistically', () => {
    const plan = (c: ReturnType<typeof defaultConfig>) => c.led.plan;
    const mk = (p: number) => mergeConfig(scenarioById('led'), { crowdManagers: { count: 0 }, led: { complianceProb: p } });
    const share = (p: number) => {
      const sim = new SimulationEngine(geo, mk(p), 8);
      sim.run();
      const c = mk(p);
      let follow = 0;
      let complied = 0;
      for (const a of sim.agents) {
        if (a.ledGroup >= 0) complied++;
        const zone = geo.seats[a.seat].zone;
        const L = a.exitLink >= 0 ? sim.graph.links[a.exitLink] : null;
        if (L && L.exitGroup >= 0 && ['FOYER', 'PORTICO_W', 'PORTICO_E', 'STAGE_W', 'STAGE_E', 'BAL_NW', 'BAL_NE'][L.exitGroup] === plan(c)[zone]) follow++;
      }
      return { follow: follow / sim.agents.length, complied };
    };
    const lo = share(0);
    const hi = share(1);
    expect(lo.complied).toBe(0);
    expect(hi.complied).toBeGreaterThan(1000);
    expect(hi.follow).toBeGreaterThan(lo.follow + 0.1);
  });
});

describe('failed or unresolved runs are reported explicitly', () => {
  it('a run stopped before completion is not counted as completed', () => {
    const cfg = mergeConfig(scenarioById('concert-emergency'), { tMax: 60 });
    const r = runSimulation(geo, cfg, 1);
    expect(r.allLeftBuilding).toBe(false);
    expect(Number.isNaN(r.tEvac)).toBe(true);
    expect(r.unresolved.inside).toBeGreaterThan(0);
    expect(r.completed).toBe(false);
  });

  it('wheelchair users without an accessible route are reported as trapped, not evacuated', () => {
    const r = runSimulation(geo, scenarioById('blocked-foyer'), 1);
    expect(r.unresolved.trapped).toBeGreaterThan(0);
    expect(r.allLeftBuilding).toBe(false);
    expect(Number.isNaN(r.tEvac)).toBe(true);
    expect(Number.isFinite(r.tEvacAmbulatory)).toBe(true);
  });
});
