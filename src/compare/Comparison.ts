/**
 * Model comparison framework (A = detailed agent-based, B = network behavioural,
 * C = ideal time-expanded network flow), on paired random scenarios.
 *
 * Pairing: for a seed, both engines call createPopulation(geo, cfg, seed), so the audience
 * (seats, types, speeds, reaction-time draws, compliance uniforms, knowledge, groups) is
 * IDENTICAL. Each engine then uses its own named random streams for its own dynamics, so
 * model-specific randomness stays separate. The Model C benchmarks for the same seed use
 *   C_imm : everyone ready at t = 0 (row walk only)
 *   C_pre : the sampled intrinsic pre-movement times t_rec + t_resp + t_prep (no social effects)
 *   C_A   : Model A's realised start times   ->  A - C_A = cost of decentralised routing + movement in A
 *   C_B   : Model B's realised start times   ->  B - C_B = the same in B (same graph and capacities:
 *                                                the cleanest decomposition)
 * B - A is NOT a pure behavioural effect: the engines differ in spatial representation, local
 * collision rules, queue implementation, geometry simplification, time step and speed model.
 */
import type { GeometryData } from '../geometry/types';
import { networkFor } from '../network/NetworkGraph';
import { NetworkSimulation } from '../network/NetworkSimulation';
import { staticMaxFlow } from '../network/StaticFlow';
import { individualBound, premovementBudget, releasesFromPopulation, timeExpandedFlow } from '../network/TimeExpanded';
import type { BatchStats, RunSummary, Summary } from '../simulation/MonteCarlo';
import { batchStats, pairedComparison, summarize, toRunSummary, wilson } from '../simulation/MonteCarlo';
import type { SimConfig } from '../simulation/Params';
import { createPopulation } from '../simulation/Population';
import { SimulationEngine } from '../simulation/SimulationEngine';

export type ModelId = 'A' | 'B';

export interface ModelRun extends RunSummary {
  model: ModelId;
  /** mean time per person spent waiting in queues (s) */
  meanQueueTime: number;
  /** largest queue at any door / stair / access point, and where */
  maxQueue1: number;
  maxQueueWhere: string;
  /** persons outside per second (N - inside) */
  evacuated: number[];
}

export interface Benchmarks {
  imm: number;
  pre: number;
  realA: number;
  realB: number;
  /** individual lower bound with the intrinsic pre-movement (own speed, no congestion) */
  indPre?: number;
  /** max(C_pre, individual bound): the tighter lower bound */
  boundPre?: number;
}

export interface PairRecord {
  seed: number;
  A?: ModelRun;
  B?: ModelRun;
  C?: Benchmarks;
}

export interface PairOptions {
  models?: ModelId[];
  /** compute the time-expanded benchmarks for this seed */
  benchmarks?: boolean;
  /** time step of the time-expanded network (s) */
  teDt?: number;
}

function enrich(model: ModelId, s: RunSummary, waits: number[], N: number): ModelRun {
  let mq = 0;
  let where = '';
  for (const [k, v] of Object.entries(s.maxQueue))
    if (v > mq) {
      mq = v;
      where = k;
    }
  return {
    ...s,
    model,
    meanQueueTime: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : NaN,
    maxQueue1: mq,
    maxQueueWhere: where,
    evacuated: s.inside.map((v) => N - v),
  };
}

export function runModelA(geo: GeometryData, cfg: SimConfig, seed: number) {
  const sim = new SimulationEngine(geo, cfg, seed);
  sim.run();
  const r = sim.result();
  const run = enrich('A', toRunSummary(r), sim.agents.map((a) => a.waitTotal), r.N);
  return { run, starts: sim.agents.map((a) => a.tStartMove), sim };
}

export function runModelB(geo: GeometryData, cfg: SimConfig, seed: number) {
  const sim = new NetworkSimulation(geo, cfg, seed);
  sim.run();
  const r = sim.result();
  const run = enrich('B', toRunSummary(r), sim.na.map((n) => n.waitTotal), r.N);
  return { run, starts: sim.agents.map((a) => a.tStartMove), sim };
}

/** Model C benchmark for given departure times (NaN starts = never departed: excluded). */
export function benchmark(geo: GeometryData, cfg: SimConfig, seed: number, starts: 'imm' | 'pre' | number[], dt = 1) {
  const net = networkFor(geo, cfg);
  const people = benchmarkPeople(geo, cfg, seed, starts);
  const ok = people.filter((p) => Number.isFinite(p.tDepart));
  const flow = timeExpandedFlow(net, cfg, releasesFromPopulation(net, cfg, ok), { dt });
  const ind = individualBound(net, cfg, ok);
  // the tighter of the two lower bounds: capacity (flow at the representative speed) or the slowest individual
  return { ...flow, tInd: ind.tInd, tBound: Math.max(Number.isFinite(flow.tStar) ? flow.tStar : Infinity, ind.tInd) };
}

/** people entering the Model C benchmarks (departure times + individual attributes) */
export function benchmarkPeople(geo: GeometryData, cfg: SimConfig, seed: number, starts: 'imm' | 'pre' | number[]) {
  const pop = createPopulation(geo, cfg, seed).agents;
  return pop.map((a, i) => ({
    seat: a.seat,
    tDepart: starts === 'imm' ? 0 : starts === 'pre' ? a.tRecognition + a.tResponse + a.tPrepare : starts[i],
    v0: a.v0,
    stairRatio: a.stairRatio,
    wheelchair: a.wheelchair,
  }));
}

export function runPair(geo: GeometryData, cfg: SimConfig, seed: number, opt: PairOptions = {}): PairRecord {
  const models = opt.models ?? ['A', 'B'];
  const out: PairRecord = { seed };
  let sA: number[] | null = null;
  let sB: number[] | null = null;
  if (models.includes('A')) {
    const a = runModelA(geo, cfg, seed);
    out.A = a.run;
    sA = a.starts;
  }
  if (models.includes('B')) {
    const b = runModelB(geo, cfg, seed);
    out.B = b.run;
    sB = b.starts;
  }
  if (opt.benchmarks !== false) {
    const dt = opt.teDt ?? 1;
    const pre = benchmark(geo, cfg, seed, 'pre', dt);
    out.C = {
      imm: benchmark(geo, cfg, seed, 'imm', dt).tStar,
      pre: pre.tStar,
      indPre: pre.tInd,
      boundPre: pre.tBound,
      realA: sA ? benchmark(geo, cfg, seed, sA, dt).tStar : NaN,
      realB: sB ? benchmark(geo, cfg, seed, sB, dt).tStar : NaN,
    };
  }
  return out;
}

export interface DiffStat extends Summary {
  label: string;
}

export interface ComparisonStats {
  label: string;
  runs: number;
  A?: BatchStats & { meanQueueTime: Summary; maxQueue: Summary; topBottleneck: string };
  B?: BatchStats & { meanQueueTime: Summary; maxQueue: Summary; topBottleneck: string };
  C?: { imm: Summary; pre: Summary; realA: Summary; realB: Summary; pMeetImm: ReturnType<typeof wilson>; pMeetPre: ReturnType<typeof wilson> };
  /** paired differences on common seeds */
  diffs: DiffStat[];
  /** B - A for each RunSummary metric */
  pairedBA: ReturnType<typeof pairedComparison>;
}

function modelStats(label: string, runs: ModelRun[]) {
  const bs = batchStats(label, runs);
  const where = new Map<string, number>();
  for (const r of runs) where.set(r.maxQueueWhere, (where.get(r.maxQueueWhere) ?? 0) + 1);
  const top = [...where.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return { ...bs, meanQueueTime: summarize(runs.map((r) => r.meanQueueTime)), maxQueue: summarize(runs.map((r) => r.maxQueue1)), topBottleneck: top };
}

function diff(label: string, recs: PairRecord[], f: (r: PairRecord) => number): DiffStat {
  return { label, ...summarize(recs.map(f).filter(Number.isFinite)) };
}

export function comparisonStats(label: string, recs: PairRecord[], benchmark = 180): ComparisonStats {
  const A = recs.map((r) => r.A).filter((x): x is ModelRun => !!x);
  const B = recs.map((r) => r.B).filter((x): x is ModelRun => !!x);
  const C = recs.map((r) => r.C).filter((x): x is Benchmarks => !!x);
  const meet = (v: number[]) => wilson(v.filter((x) => Number.isFinite(x) && x <= benchmark).length, v.length);
  const diffs: DiffStat[] = [];
  if (A.length && B.length) diffs.push(diff('B - A (model structure + behaviour representation)', recs, (r) => (r.B?.tEvac ?? NaN) - (r.A?.tEvac ?? NaN)));
  if (C.length) {
    if (A.length) diffs.push(diff('A - C_A (decentralised routing/movement in A, same departures)', recs, (r) => (r.A?.tEvac ?? NaN) - (r.C?.realA ?? NaN)));
    if (B.length) diffs.push(diff('B - C_B (decentralised routing/queuing in B, same graph and departures)', recs, (r) => (r.B?.tEvac ?? NaN) - (r.C?.realB ?? NaN)));
    if (B.length) diffs.push(diff('C_B - C_pre (social/group/guidance effects on departures)', recs, (r) => (r.C?.realB ?? NaN) - (r.C?.pre ?? NaN)));
    diffs.push(diff('C_pre - C_imm (cost of sampled pre-movement)', recs, (r) => (r.C?.pre ?? NaN) - (r.C?.imm ?? NaN)));
  }
  return {
    label,
    runs: recs.length,
    A: A.length ? modelStats(`${label} [A]`, A) : undefined,
    B: B.length ? modelStats(`${label} [B]`, B) : undefined,
    C: C.length
      ? {
          imm: summarize(C.map((c) => c.imm)),
          pre: summarize(C.map((c) => c.pre)),
          realA: summarize(C.map((c) => c.realA)),
          realB: summarize(C.map((c) => c.realB)),
          pMeetImm: meet(C.map((c) => c.imm)),
          pMeetPre: meet(C.map((c) => c.pre)),
        }
      : undefined,
    diffs,
    pairedBA: A.length && B.length ? pairedComparison(A, B) : [],
  };
}

/** paired intervention effect (strategy - reference) for one model on common seeds */
export function interventionEffect(ref: PairRecord[], alt: PairRecord[], model: ModelId, metric: (r: ModelRun) => number = (r) => r.tEvac): Summary {
  const bySeed = new Map(ref.map((r) => [r.seed, r]));
  const d: number[] = [];
  for (const r of alt) {
    const q = bySeed.get(r.seed);
    const a = q?.[model];
    const b = r[model];
    if (a && b) d.push(metric(b) - metric(a));
  }
  return summarize(d.filter(Number.isFinite));
}

/** Physical (Model C) analysis of a configuration: static flow, min cut, quickest evacuation. */
export function physicalAnalysis(geo: GeometryData, cfg: SimConfig, seed = 1, dt = 1, opts: { budget?: boolean; target?: number } = {}) {
  const net = networkFor(geo, cfg);
  const N = createPopulation(geo, cfg, seed).agents.length;
  const st = staticMaxFlow(net, cfg, N);
  const imm = benchmark(geo, cfg, seed, 'imm', dt);
  const pre = benchmark(geo, cfg, seed, 'pre', dt);
  const budget = opts.budget ? premovementBudget(net, cfg, benchmarkPeople(geo, cfg, seed, 'pre'), opts.target ?? 180, dt) : null;
  return {
    N,
    maxFlow: st.maxFlow,
    requiredRate: N / 180,
    flowTime: st.flowTime,
    cut: st.cut,
    exitFlow: st.exitFlow,
    edgeFlow: st.edgeFlow,
    tStarImm: imm.tStar,
    tStarPre: pre.tStar,
    /** individual (own speed, no congestion) lower bound with the sampled pre-movement */
    tIndPre: pre.tInd,
    /** tighter lower bound max(T*_pre, individual bound) */
    tBoundPre: pre.tBound,
    /** largest scaling of the sampled pre-movement for which the ideal flow still meets the target */
    premovementAlpha: budget?.alpha ?? NaN,
    curveImm: imm.curve,
    curvePre: pre.curve,
    exitUsageImm: imm.exitUsage,
    saturationImm: imm.edgeSaturation,
    edgeTotalsImm: imm.edgeTotals,
    discretisation: imm.discretisation,
  };
}

/** Geometry variant with door (and optionally stair) clear widths scaled: door-width sensitivity. */
export function scaleWidths(geo: GeometryData, doors: number, stairs = 1): GeometryData {
  const g = structuredClone(geo);
  for (const l of g.links) {
    if (l.kind === 'door') l.width *= doors;
    else if (l.kind === 'stair') l.width *= stairs;
  }
  g.name = `${geo.name} (doors x${doors}, stairs x${stairs})`;
  return g;
}
