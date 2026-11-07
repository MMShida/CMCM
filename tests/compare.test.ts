/**
 * Comparison framework: paired runs, Model C benchmark consistency, shared-clock
 * synchronisation of the two live engines, statistics and report assembly.
 */
import { describe, expect, it } from 'vitest';
import { comparisonStats, interventionEffect, physicalAnalysis, runPair, scaleWidths } from '../src/compare/Comparison';
import type { PairRecord } from '../src/compare/Comparison';
import { INTERVENTIONS, OCCUPANCY_LEVELS, SENSITIVITY, assembleReport, planCells } from '../src/compare/Experiments';
import { reportMarkdown } from '../src/compare/ReportMarkdown';
import { LiveController } from '../src/components/LiveController';
import { NetworkLiveController } from '../src/components/network/NetworkLiveController';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { networkFor } from '../src/network/NetworkGraph';
import { staticMaxFlow } from '../src/network/StaticFlow';
import { mergeConfig } from '../src/simulation/Params';
import { scenarioById } from '../src/simulation/Scenarios';

const geo = BAILEY_HALL;
const cfg = scenarioById('concert-emergency');

describe('paired comparison runs', () => {
  const small = mergeConfig(cfg, { occupancy: { orchestra: 0.25, mezzanine: 0.25, balcony: 0.25 }, crowdManagers: { count: -1 } });
  const rec = runPair(geo, small, 5);

  it('both models simulate the same audience and finish', () => {
    expect(rec.A!.N).toBe(rec.B!.N);
    expect(rec.A!.allLeftBuilding).toBe(true);
    expect(rec.B!.allLeftBuilding).toBe(true);
    expect(rec.A!.evacuated[rec.A!.evacuated.length - 1]).toBe(rec.A!.N);
  });

  it('Model C benchmarks are ordered: later departures can never evacuate faster', () => {
    const C = rec.C!;
    expect(C.pre).toBeGreaterThanOrEqual(C.imm);
    expect(C.realA).toBeGreaterThanOrEqual(C.imm);
    expect(C.realB).toBeGreaterThanOrEqual(C.imm);
  });

  it('runs are reproducible', () => {
    const again = runPair(geo, small, 5);
    expect(again.A!.tEvac).toBe(rec.A!.tEvac);
    expect(again.B!.tEvac).toBe(rec.B!.tEvac);
    expect(again.C).toEqual(rec.C);
  });
});

describe('shared simulated clock', () => {
  it('both live engines show their state at the same simulated time', () => {
    const A = new LiveController(geo, cfg);
    const B = new NetworkLiveController(geo, cfg);
    for (const t of [10, 37.5, 60]) {
      A.advanceTo(t);
      B.advanceTo(t);
      expect(A.sim.t).toBeGreaterThanOrEqual(t - 1e-9);
      expect(A.sim.t).toBeLessThan(t + cfg.movement.dt + 1e-9);
      expect(B.sim.t).toBeGreaterThanOrEqual(t - 1e-9);
      expect(B.sim.t).toBeLessThan(t + B.sim.opt.dt + 1e-9);
    }
    // one snapshot per simulated second in both (replay slider index = seconds)
    expect(A.snapshots.length).toBe(61);
    expect(B.snapshots.length).toBe(61);
    expect(Math.round(A.snapshots[30].t)).toBe(30);
    expect(Math.round(B.snapshots[30].t)).toBe(30);
  });
});

describe('physical analysis and door-width sensitivity', () => {
  it('wider doors never reduce, narrower doors never increase the maximum flow', () => {
    const base = staticMaxFlow(networkFor(geo, cfg), cfg, 1329).maxFlow;
    const wide = staticMaxFlow(networkFor(scaleWidths(geo, 1.2), cfg), cfg, 1329).maxFlow;
    const narrow = staticMaxFlow(networkFor(scaleWidths(geo, 0.8), cfg), cfg, 1329).maxFlow;
    expect(wide).toBeGreaterThanOrEqual(base - 1e-9);
    expect(narrow).toBeLessThanOrEqual(base + 1e-9);
    expect(narrow).toBeLessThan(wide);
  });

  it('the quickest evacuation respects the static rate bound (T* >= N / F*) and 180 s needs 7.38 p/s', () => {
    const p = physicalAnalysis(geo, cfg, 1);
    expect(p.requiredRate).toBeCloseTo(1329 / 180, 9);
    expect(p.tStarImm).toBeGreaterThanOrEqual(p.N / p.maxFlow - 1);
    expect(p.tStarPre).toBeGreaterThanOrEqual(p.tStarImm);
  });
});

describe('statistics and reports', () => {
  const fake = (seed: number, a: number, b: number): PairRecord =>
    ({
      seed,
      A: { tEvac: a, p95Exit: a - 50, evacuated: [0, 10], maxQueue: {}, meanWait: {}, exitGroupUsage: {}, inside: [10, 0], meanQueueTime: 5, maxQueue1: 3, maxQueueWhere: 'D3' },
      B: { tEvac: b, p95Exit: b - 50, evacuated: [0, 10], maxQueue: {}, meanWait: {}, exitGroupUsage: {}, inside: [10, 0], meanQueueTime: 4, maxQueue1: 2, maxQueueWhere: 'FC1' },
      C: { imm: 100, pre: 150, realA: 160, realB: 140 },
    }) as unknown as PairRecord;

  it('paired differences are computed seed by seed', () => {
    const recs = [fake(1, 300, 250), fake(2, 310, 255), fake(3, 290, 245)];
    const s = comparisonStats('x', recs);
    const ba = s.diffs.find((d) => d.label.startsWith('B - A'))!;
    expect(ba.mean).toBeCloseTo(-50, 9);
    expect(ba.n).toBe(3);
    const bc = s.diffs.find((d) => d.label.startsWith('B - C_B'))!;
    expect(bc.mean).toBeCloseTo((110 + 115 + 105) / 3, 9);
    const eff = interventionEffect(recs, [fake(1, 280, 240), fake(2, 300, 250), fake(3, 280, 230)], 'A');
    expect(eff.mean).toBeCloseTo((-20 - 10 - 10) / 3, 9);
  });

  it('experiment plans cover the seven interventions, five occupancy levels and all sensitivity levels', () => {
    expect(INTERVENTIONS.length).toBe(7);
    expect(planCells(['interventions'], geo).length).toBe(7);
    expect(planCells(['occupancy'], geo).length).toBe(OCCUPANCY_LEVELS.length);
    expect(planCells(['sensitivity'], geo).length).toBe(1 + SENSITIVITY.reduce((s, f) => s + f.levels.length, 0));
    // door-width levels carry their own geometry variant
    const w = planCells(['sensitivity'], geo).filter((c) => c.factor === 'doorWidth');
    expect(w.every((c) => c.geo && c.geo !== geo)).toBe(true);
  });

  it('a report assembles and renders with paired intervention effects', () => {
    const cells = planCells(['interventions'], geo).slice(0, 2);
    const recs = [
      [fake(1, 300, 250), fake(2, 310, 255)],
      [fake(1, 290, 240), fake(2, 300, 250)],
    ];
    const phys = cells.map(() => ({ maxFlow: 17, requiredRate: 7.38, flowTime: 78, tStarImm: 101, tStarPre: 160, cut: [], exitUsageImm: {} }));
    const rep = assembleReport(cells, recs, phys, { source: 'cli', runs: 2, baseSeed: 1, models: ['A', 'B'] });
    expect(rep.interventions!.length).toBe(2);
    expect(rep.interventions![1].effectA!.mean).toBeCloseTo(-10, 9);
    expect(rep.interventions![1].effectB!.mean).toBeCloseTo(-7.5, 9);
    const md = reportMarkdown(rep);
    expect(md).toContain('## 2. Interventions');
    expect(md).toContain('not a pure behavioural effect');
  });
});
