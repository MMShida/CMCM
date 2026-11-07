/**
 * Monte Carlo estimation.
 *
 * For a fixed configuration, run r = 1..R independent replications with seeds s_r
 * (derived deterministically from a base seed) and estimate
 *   mean      T_bar = (1/R) sum_r T_r
 *   std. dev. s = sqrt( sum (T_r - T_bar)^2 / (R - 1) )
 *   95% CI    T_bar +/- t_{0.975, R-1} * s / sqrt(R)
 *   P(T <= 180 s) by the empirical fraction (Wilson 95% interval)
 * Runs that do not finish (gridlock / unresolved agents) are reported separately and count
 * as NOT meeting the benchmark; they are excluded from the time statistics.
 *
 * Paired comparison of strategies A, B with common seeds (common random numbers):
 *   D_r = T_r^B - T_r^A,   D_bar +/- t * s_D / sqrt(R)
 * which removes between-audience variance shared by the two strategies.
 */
import { EXIT_GROUPS } from '../geometry/types';
import type { GeometryData } from '../geometry/types';
import type { RunResult } from './Metrics';
import type { SimConfig } from './Params';
import { cloneConfig } from './Params';
import { batchSeeds } from './Random';
import { runSimulation } from './SimulationEngine';

export interface Summary {
  n: number;
  nValid: number;
  mean: number;
  sd: number;
  median: number;
  p5: number;
  p95: number;
  min: number;
  max: number;
  ciLow: number;
  ciHigh: number;
}

/** Two-sided 97.5% quantile of Student's t (Cornish-Fisher expansion; exact enough for CIs). */
export function tQuantile975(df: number): number {
  if (df <= 0) return NaN;
  const table = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
  if (df <= 10) return table[Math.round(df) - 1];
  const z = 1.959964;
  const z3 = z ** 3;
  const z5 = z ** 5;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
}

export function quantileSorted(s: number[], q: number): number {
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function summarize(values: number[]): Summary {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  const sorted = [...v].sort((a, b) => a - b);
  const mean = n ? v.reduce((a, b) => a + b, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? (tQuantile975(n - 1) * sd) / Math.sqrt(n) : NaN;
  return {
    n: values.length,
    nValid: n,
    mean,
    sd,
    median: quantileSorted(sorted, 0.5),
    p5: quantileSorted(sorted, 0.05),
    p95: quantileSorted(sorted, 0.95),
    min: n ? sorted[0] : NaN,
    max: n ? sorted[n - 1] : NaN,
    ciLow: mean - half,
    ciHigh: mean + half,
  };
}

/** Wilson score interval for a binomial proportion. */
export function wilson(k: number, n: number): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Compact per-run record transported from workers and exported to CSV. */
export interface RunSummary {
  seed: number;
  label: string;
  N: number;
  tEvac: number;
  tEvacAmbulatory: number;
  tSafe: number;
  meanExit: number;
  medianExit: number;
  p95Exit: number;
  medianStart: number;
  p95Start: number;
  peakDensity: number;
  peakDensityWhere: string;
  highDensityExposure: number;
  reroutedAgents: number;
  completed: boolean;
  allLeftBuilding: boolean;
  gridlock: boolean;
  unresolvedInside: number;
  awaitingAssistance: number;
  trapped: number;
  exitImbalance: number;
  exitGroupUsage: Record<string, number>;
  maxQueue: Record<string, number>;
  meanWait: Record<string, number>;
  /** persons still inside, per second */
  inside: number[];
  wallTimeMs: number;
}

export function toRunSummary(r: RunResult): RunSummary {
  const maxQueue: Record<string, number> = {};
  const meanWait: Record<string, number> = {};
  for (const g of r.gates) {
    if (g.passes === 0 && g.maxQueue === 0) continue;
    maxQueue[g.label] = g.maxQueue;
    meanWait[g.label] = g.meanWait;
  }
  return {
    seed: r.seed,
    label: r.label,
    N: r.N,
    tEvac: r.tEvac,
    tEvacAmbulatory: r.tEvacAmbulatory,
    tSafe: r.tSafe,
    meanExit: r.meanExit,
    medianExit: r.medianExit,
    p95Exit: r.p95Exit,
    medianStart: r.medianStart,
    p95Start: r.p95Start,
    peakDensity: r.peakDensity,
    peakDensityWhere: r.peakDensityWhere,
    highDensityExposure: r.highDensityExposure,
    reroutedAgents: r.reroutedAgents,
    completed: r.completed,
    allLeftBuilding: r.allLeftBuilding,
    gridlock: r.gridlock,
    unresolvedInside: r.unresolved.inside,
    awaitingAssistance: r.unresolved.awaitingAssistance,
    trapped: r.unresolved.trapped,
    exitImbalance: r.exitImbalance,
    exitGroupUsage: { ...r.exitGroupUsage },
    maxQueue,
    meanWait,
    inside: r.series.inside,
    wallTimeMs: r.wallTimeMs,
  };
}

export interface BatchStats {
  label: string;
  runs: number;
  benchmark: number;
  tEvac: Summary;
  tEvacAmbulatory: Summary;
  tSafe: Summary;
  p95Exit: Summary;
  meanExit: Summary;
  medianStart: Summary;
  peakDensity: Summary;
  exposure: Summary;
  imbalance: Summary;
  /** P(T_evac <= benchmark); unfinished runs count as failures */
  pMeet: { p: number; lo: number; hi: number };
  /** same, using the ambulatory evacuation time */
  pMeetAmbulatory: { p: number; lo: number; hi: number };
  fracGridlock: number;
  fracUnresolved: number;
  meanUsage: Record<string, number>;
  meanMaxQueue: Record<string, number>;
}

export function batchStats(label: string, runs: RunSummary[], benchmark = 180): BatchStats {
  const R = runs.length;
  const meanUsage: Record<string, number> = {};
  for (const g of EXIT_GROUPS) meanUsage[g] = R ? runs.reduce((a, r) => a + (r.exitGroupUsage[g] ?? 0), 0) / R : 0;
  const mq: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.maxQueue)) mq[k] = (mq[k] ?? 0) + v / R;
  return {
    label,
    runs: R,
    benchmark,
    tEvac: summarize(runs.map((r) => r.tEvac)),
    tEvacAmbulatory: summarize(runs.map((r) => r.tEvacAmbulatory)),
    tSafe: summarize(runs.map((r) => r.tSafe)),
    p95Exit: summarize(runs.map((r) => r.p95Exit)),
    meanExit: summarize(runs.map((r) => r.meanExit)),
    medianStart: summarize(runs.map((r) => r.medianStart)),
    peakDensity: summarize(runs.map((r) => r.peakDensity)),
    exposure: summarize(runs.map((r) => r.highDensityExposure)),
    imbalance: summarize(runs.map((r) => r.exitImbalance)),
    pMeet: wilson(runs.filter((r) => Number.isFinite(r.tEvac) && r.tEvac <= benchmark).length, R),
    pMeetAmbulatory: wilson(runs.filter((r) => Number.isFinite(r.tEvacAmbulatory) && r.tEvacAmbulatory <= benchmark).length, R),
    fracGridlock: R ? runs.filter((r) => r.gridlock).length / R : 0,
    fracUnresolved: R ? runs.filter((r) => !r.allLeftBuilding || r.trapped > 0).length / R : 0,
    meanUsage,
    meanMaxQueue: mq,
  };
}

export interface PairedDiff {
  metric: string;
  n: number;
  meanDiff: number;
  sd: number;
  ciLow: number;
  ciHigh: number;
  /** fraction of seeds in which B is strictly better (smaller) than A */
  fracBBetter: number;
}

/** Paired differences B - A on common seeds for the main metrics. */
export function pairedComparison(A: RunSummary[], B: RunSummary[]): PairedDiff[] {
  const bySeed = new Map(A.map((r) => [r.seed, r]));
  const pairs = B.filter((r) => bySeed.has(r.seed)).map((b) => [bySeed.get(b.seed)!, b] as const);
  const metrics: [string, (r: RunSummary) => number][] = [
    ['tEvac', (r) => r.tEvac],
    ['tEvacAmbulatory', (r) => r.tEvacAmbulatory],
    ['p95Exit', (r) => r.p95Exit],
    ['meanExit', (r) => r.meanExit],
    ['peakDensity', (r) => r.peakDensity],
    ['highDensityExposure', (r) => r.highDensityExposure],
    ['exitImbalance', (r) => r.exitImbalance],
  ];
  return metrics.map(([name, f]) => {
    const d = pairs.map(([a, b]) => f(b) - f(a)).filter((x) => Number.isFinite(x));
    const s = summarize(d);
    const better = pairs.filter(([a, b]) => Number.isFinite(f(a)) && Number.isFinite(f(b)) && f(b) < f(a)).length;
    return { metric: name, n: d.length, meanDiff: s.mean, sd: s.sd, ciLow: s.ciLow, ciHigh: s.ciHigh, fracBBetter: pairs.length ? better / pairs.length : NaN };
  });
}

/** Run a batch synchronously (used by the worker, the CLI and the tests). */
export function runBatch(
  geo: GeometryData,
  cfg: SimConfig,
  seeds: number[],
  onProgress?: (done: number, total: number, last: RunSummary) => void,
): RunSummary[] {
  const out: RunSummary[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const r = runSimulation(geo, cfg, seeds[i]);
    const s = toRunSummary(r);
    out.push(s);
    onProgress?.(i + 1, seeds.length, s);
  }
  return out;
}

export { batchSeeds };

// ------------------------------------------------------------------------------------
// One-at-a-time sensitivity analysis
// ------------------------------------------------------------------------------------
export interface Perturbation {
  key: string;
  label: string;
  low: number;
  high: number;
  unit: string;
  apply: (c: SimConfig, v: number) => void;
  base: (c: SimConfig) => number;
}

export const PERTURBATIONS: Perturbation[] = [
  { key: 'responseMedian', label: 'Response time median', low: 0.5, high: 1.5, unit: 'x', base: () => 1, apply: (c, v) => (c.premovement.responseMedian *= v) },
  { key: 'recognitionMedian', label: 'Recognition time median', low: 0.5, high: 2, unit: 'x', base: () => 1, apply: (c, v) => (c.premovement.recognitionMedian *= v) },
  { key: 'speedMean', label: 'Mean walking speed', low: 1.0, high: 1.4, unit: 'm/s', base: (c) => c.population.speedMean, apply: (c, v) => (c.population.speedMean = v) },
  { key: 'doorFlow', label: 'Door specific flow', low: 1.0, high: 1.9, unit: 'p/(s m)', base: (c) => c.movement.doorFlow, apply: (c, v) => (c.movement.doorFlow = v) },
  { key: 'stairFlow', label: 'Stair specific flow (incl. access stairs)', low: 0.8, high: 1.3, unit: 'p/(s m)', base: (c) => c.movement.stairFlow, apply: (c, v) => (c.movement.stairFlow = v) },
  { key: 'cmCompliance', label: 'Crowd Manager compliance', low: 0.5, high: 0.95, unit: '-', base: (c) => c.crowdManagers.complianceProb, apply: (c, v) => (c.crowdManagers.complianceProb = v) },
  { key: 'ledCompliance', label: 'LED compliance', low: 0.3, high: 0.9, unit: '-', base: (c) => c.led.complianceProb, apply: (c, v) => (c.led.complianceProb = v) },
  {
    key: 'habit',
    label: 'Habit weight (familiarity)',
    low: 0.5,
    high: 1.5,
    unit: 'x',
    base: () => 1,
    apply: (c, v) => {
      for (const w of Object.values(c.routing.weights)) w.familiarity *= v;
    },
  },
  {
    key: 'habitualShare',
    label: 'Share of habitual decision makers',
    low: 0.15,
    high: 0.55,
    unit: '-',
    base: (c) => c.population.typeShares.habitual,
    apply: (c, v) => {
      const s = c.population.typeShares;
      const rest = 1 - s.habitual;
      const scale = rest > 0 ? (1 - v) / rest : 0;
      for (const k of Object.keys(s) as (keyof typeof s)[]) if (k !== 'habitual') s[k] *= scale;
      s.habitual = v;
    },
  },
  { key: 'timeHeadway', label: 'Following time headway', low: 0.5, high: 1.0, unit: 's', base: (c) => c.movement.timeHeadway, apply: (c, v) => (c.movement.timeHeadway = v) },
  { key: 'groupFraction', label: 'Share of people in groups', low: 0.1, high: 0.8, unit: '-', base: (c) => c.population.groupFraction, apply: (c, v) => (c.population.groupFraction = v) },
];

export function perturbed(cfg: SimConfig, p: Perturbation, v: number): SimConfig {
  const c = cloneConfig(cfg);
  p.apply(c, v);
  c.label = `${cfg.label} | ${p.label}=${v}`;
  return c;
}
