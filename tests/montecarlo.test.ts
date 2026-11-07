import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import { batchSeeds, batchStats, pairedComparison, summarize, tQuantile975, wilson } from '../src/simulation/MonteCarlo';
import { RNG } from '../src/simulation/Random';

const fake = (seed: number, tEvac: number, extra: Partial<RunSummary> = {}): RunSummary => ({
  seed,
  label: 'x',
  N: 10,
  tEvac,
  tEvacAmbulatory: tEvac,
  tSafe: tEvac,
  meanExit: tEvac / 2,
  medianExit: tEvac / 2,
  p95Exit: tEvac * 0.9,
  medianStart: 10,
  p95Start: 20,
  peakDensity: 2,
  peakDensityWhere: '-',
  highDensityExposure: 0,
  reroutedAgents: 0,
  completed: Number.isFinite(tEvac),
  allLeftBuilding: Number.isFinite(tEvac),
  gridlock: false,
  unresolvedInside: Number.isFinite(tEvac) ? 0 : 1,
  awaitingAssistance: 0,
  trapped: 0,
  exitImbalance: 1,
  exitGroupUsage: {},
  maxQueue: {},
  meanWait: {},
  inside: [],
  wallTimeMs: 0,
  ...extra,
});

describe('statistics', () => {
  it('t quantiles', () => {
    expect(tQuantile975(1)).toBeCloseTo(12.706, 2);
    expect(tQuantile975(29)).toBeCloseTo(2.045, 2);
    expect(tQuantile975(1000)).toBeCloseTo(1.962, 2);
  });

  it('summary and confidence interval', () => {
    const s = summarize([1, 2, 3, 4, 5]);
    expect(s.mean).toBe(3);
    expect(s.sd).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(s.median).toBe(3);
    expect(s.ciLow).toBeCloseTo(3 - (2.776 * Math.sqrt(2.5)) / Math.sqrt(5), 2);
  });

  it('95% CI covers the true mean ~95% of the time', () => {
    const rng = new RNG(1);
    let cover = 0;
    const reps = 400;
    for (let r = 0; r < reps; r++) {
      const x = Array.from({ length: 20 }, () => rng.normal(10, 3));
      const s = summarize(x);
      if (s.ciLow <= 10 && 10 <= s.ciHigh) cover++;
    }
    expect(cover / reps).toBeGreaterThan(0.9);
    expect(cover / reps).toBeLessThan(0.99);
  });

  it('wilson interval', () => {
    const w = wilson(5, 10);
    expect(w.p).toBe(0.5);
    expect(w.lo).toBeLessThan(0.5);
    expect(w.hi).toBeGreaterThan(0.5);
  });

  it('unfinished runs count as failing the benchmark and are flagged', () => {
    const runs = [fake(1, 150), fake(2, 170), fake(3, 250), fake(4, NaN)];
    const b = batchStats('x', runs, 180);
    expect(b.pMeet.p).toBe(0.5);
    expect(b.tEvac.nValid).toBe(3);
    expect(b.fracUnresolved).toBe(0.25);
  });

  it('paired comparison on common seeds', () => {
    const A = [fake(1, 200), fake(2, 220), fake(3, 240)];
    const B = [fake(1, 190), fake(2, 205), fake(3, 236)];
    const d = pairedComparison(A, B).find((x) => x.metric === 'tEvac')!;
    expect(d.n).toBe(3);
    expect(d.meanDiff).toBeCloseTo(-29 / 3, 6);
    expect(d.fracBBetter).toBe(1);
  });

  it('batch seeds are deterministic and distinct', () => {
    const s = batchSeeds(5, 100);
    expect(batchSeeds(5, 100)).toEqual(s);
    expect(new Set(s).size).toBe(100);
  });
});
