/**
 * Per-run metrics. Sampled once per simulated second.
 */
import { EXIT_GROUPS } from '../geometry/types';
import type { ExitGroupId, GeometryData } from '../geometry/types';
import type { Agent } from './Agent';
import type { DensityResult } from './DensityRegions';
import type { ManagerSummary } from './ManagerPolicy';
import { seatPlanKeys } from './Plan';
import { ST } from './Agent';
import type { SimulationEngine } from './SimulationEngine';

export interface GateStat {
  id: string;
  label: string;
  kind: string;
  capacity: number;
  passes: number;
  maxQueue: number;
  totalWait: number;
  meanWait: number;
  maxPassesPerSecond: number;
}

export interface AgentRecord {
  id: number;
  seat: string;
  level: string;
  zone: string;
  type: string;
  v0: number;
  elderly: boolean;
  wheelchair: boolean;
  group: number;
  tAware: number;
  tStartMove: number;
  tLeftBuilding: number;
  tSafe: number;
  exitGroup: string;
  exitDoor: string;
  reroutes: number;
  waitTotal: number;
  finalState: string;
  /** dynamic behaviour (adaptive runs): event re-evaluations, conflicts, trust, urgency, density exposure */
  events?: number;
  conflicts?: number;
  trust?: number;
  urgency?: number;
  exposure?: number;
  cmSource?: string;
}

export interface RunResult {
  seed: number;
  label: string;
  scenarioId: string;
  N: number;
  /** all ambulatory agents reached the street and wheelchair users reached an assistance point */
  completed: boolean;
  /** everyone left the building (crossed an exterior door) */
  allLeftBuilding: boolean;
  gridlock: boolean;
  /** time the last person left the building (problem's definition); NaN if not everyone left */
  tEvac: number;
  /** time the last AMBULATORY person left the building (NaN if some did not) */
  tEvacAmbulatory: number;
  /** time the last ambulatory person reached a safe street-level destination */
  tSafe: number;
  tEnd: number;
  /** time the last person INCLUDING assisted wheelchair users reached the street (NaN if not modelled / not reached) */
  tSafeAll: number;
  meanExit: number;
  medianExit: number;
  p90Exit: number;
  p95Exit: number;
  p99Exit: number;
  /** persons still inside the building at t = 180 s (the problem's benchmark) */
  insideAt180: number;
  /** time the last person of each seating zone / level left the building */
  clearanceByZone: Record<string, number>;
  clearanceByLevel: Record<string, number>;
  /** mean exit time per seat block ZONE:SIDE:BAND (used by the block-level equilibrium analysis) */
  meanExitByBlock: Record<string, number>;
  /** profile of the last persons to leave (who sets the evacuation time) */
  lastOut: { n: number; zones: Record<string, number>; elderlyShare: number; groupShare: number; meanStart: number; meanWait: number; meanSpeed: number };
  meanStart: number;
  medianStart: number;
  p95Start: number;
  /** per-second time series */
  series: {
    leftBuilding: number[];
    inside: number[];
    safe: number[];
    moving: number[];
    queuing: number[];
    notStarted: number[];
  };
  exitGroupUsage: Record<ExitGroupId, number>;
  exitDoorUsage: Record<string, number>;
  gates: GateStat[];
  peakDensity: number;
  peakDensityWhere: string;
  /** person-seconds at local density above the threshold (safety proxy) */
  highDensityExposure: number;
  totalReroutes: number;
  reroutedAgents: number;
  unresolved: { inside: number; awaitingAssistance: number; trapped: number; notSafe: number };
  /** max load imbalance across used exit groups: max(load)/mean(load) */
  exitImbalance: number;
  heat?: { floor: number; x0: number; y0: number; cell: number; nx: number; ny: number; max: number[]; mean: number[] }[];
  /** density over time by measurement region (DensityRegions.ts) and individual exposure */
  density?: DensityResult;
  /** per Crowd Manager: responsibility, reach, influence, workload, instruction history */
  managers?: ManagerSummary[];
  /** dynamic-behaviour diagnostics (route changes, events, trust, guidance effectiveness) */
  behaviour?: BehaviourSummary;
  agents?: AgentRecord[];
  wallTimeMs: number;
}

export interface BehaviourSummary {
  /** exit-group changes after the first choice */
  exitSwitches: number;
  /** event-triggered re-evaluations (adaptive agents) and persons with at least one */
  events: number;
  agentsWithEvents: number;
  /** contradictory instructions received */
  conflicts: number;
  meanTrust: number;
  meanUrgency: number;
  /** instruction changes by Crowd Managers */
  managerSwitches: number;
  /** persons who adopted a Crowd Manager instruction, and the share of them who left by that exit group */
  complied: number;
  followedShare: number;
  /** mean number of exits known at the end */
  meanKnownExits: number;
  /** A -> B -> A exit switches within 30 s, and the largest number of exit switches of one person */
  flipFlops: number;
  maxSwitches: number;
}

export function behaviourSummary(A: Agent[], exitGroupOf: (a: Agent) => number, managerSwitches: number): BehaviourSummary {
  let sw = 0;
  let ev = 0;
  let evA = 0;
  let conf = 0;
  let trust = 0;
  let urg = 0;
  let comp = 0;
  let foll = 0;
  let known = 0;
  let flips = 0;
  let maxSw = 0;
  for (const a of A) {
    flips += a.flipFlops;
    if (a.exitSwitches > maxSw) maxSw = a.exitSwitches;
    sw += a.exitSwitches;
    ev += a.events;
    if (a.events > 0) evA++;
    conf += a.conflicts;
    trust += a.trust;
    urg += a.urgency;
    let k = 0;
    for (let x = a.knownExits; x; x &= x - 1) k++;
    known += k;
    if (a.cmGroup >= 0) {
      comp++;
      if (exitGroupOf(a) === a.cmGroup) foll++;
    }
  }
  const n = Math.max(1, A.length);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    exitSwitches: sw,
    events: ev,
    agentsWithEvents: evA,
    conflicts: conf,
    meanTrust: r3(trust / n),
    meanUrgency: r3(urg / n),
    managerSwitches,
    complied: comp,
    followedShare: r3(comp ? foll / comp : NaN),
    meanKnownExits: r3(known / n),
    flipFlops: flips,
    maxSwitches: maxSw,
  };
}

export class MetricsRecorder {
  readonly sim: SimulationEngine;
  readonly leftBuilding: number[] = [];
  readonly inside: number[] = [];
  readonly safe: number[] = [];
  readonly moving: number[] = [];
  readonly queuing: number[] = [];
  readonly notStarted: number[] = [];
  peakDensity = 0;
  peakDensityLink = -1;
  highDensityExposure = 0;
  constructor(sim: SimulationEngine) {
    this.sim = sim;
  }

  sample() {
    const A = this.sim.agents;
    let left = 0;
    let inside = 0;
    let safe = 0;
    let moving = 0;
    let queuing = 0;
    let notStarted = 0;
    for (const a of A) {
      if (!a.inside) left++;
      else inside++;
      if (a.state === ST.EXITED) safe++;
      if (a.state === ST.QUEUING) queuing++;
      else if (a.state >= ST.MOVING && a.state <= ST.OUTSIDE) moving++;
      if (a.state <= ST.WAITING && a.link < 0) notStarted++;
    }
    this.leftBuilding.push(left);
    this.inside.push(inside);
    this.safe.push(safe);
    this.moving.push(moving);
    this.queuing.push(queuing);
    this.notStarted.push(notStarted);
  }

  /** density metrics, called every step (cheap: only links with agents) */
  densityStep(dt: number) {
    const sim = this.sim;
    const thr = sim.cfg.movement.highDensityThreshold;
    const mv = sim.movement;
    for (let li = 0; li < mv.linkCount.length; li++) {
      if (mv.linkCount[li] < 2) continue;
      const L = sim.graph.links[li];
      // short links (< 1.5 m) are excluded: a 2 m window would be dominated by quantisation
      if (L.isRow || L.kind === 'outdoor' || L.len < 1.5) continue;
      const d = sim.density.linkPeak(li);
      if (d > sim.density.peakByLink[li]) sim.density.peakByLink[li] = d;
      if (d > this.peakDensity) {
        this.peakDensity = d;
        this.peakDensityLink = li;
      }
    }
    const ref = sim.cfg.analysis?.densityRef ?? 2;
    for (const a of sim.agents) {
      if (a.link < 0) continue;
      const L = sim.graph.links[a.link];
      if (L.isRow || L.len < 1.5) continue;
      // individual exposure E_i = int max(0, rho(x_i, t) - rho_ref) dt with the local 2 m window density
      if (a.densityHere > ref) {
        a.exposure += (a.densityHere - ref) * dt;
        a.timeAboveRef += dt;
      }
      if (a.densityHere >= thr) this.highDensityExposure += dt;
    }
  }
}

/**
 * Tail diagnostics shared by Models A and B: who is still inside at 180 s, per-zone / per-level
 * clearance and the profile of the last 20 persons to leave (wait = time spent queuing).
 */
export function tailMetrics(
  geo: GeometryData,
  A: Agent[],
  insideSeries: number[],
  waitOf: (a: Agent) => number = (a) => a.waitTotal,
): Pick<RunResult, 'insideAt180' | 'clearanceByZone' | 'clearanceByLevel' | 'lastOut' | 'meanExitByBlock'> {
  const zoneOf = (a: Agent) => geo.seats[a.seat].zone;
  const clearanceByZone: Record<string, number> = {};
  const clearanceByLevel: Record<string, number> = {};
  for (const a of A) {
    const t = a.inside ? Infinity : a.tLeftBuilding;
    const z = zoneOf(a);
    const lv = geo.seats[a.seat].level;
    clearanceByZone[z] = Math.max(clearanceByZone[z] ?? 0, t);
    clearanceByLevel[lv] = Math.max(clearanceByLevel[lv] ?? 0, t);
  }
  const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : NaN);
  const bSum: Record<string, number> = {};
  const bN: Record<string, number> = {};
  for (const a of A) {
    const k = seatPlanKeys(geo, a.seat)[0];
    bSum[k] = (bSum[k] ?? 0) + (a.inside ? Infinity : a.tLeftBuilding);
    bN[k] = (bN[k] ?? 0) + 1;
  }
  const meanExitByBlock: Record<string, number> = {};
  for (const k of Object.keys(bSum)) meanExitByBlock[k] = r1(bSum[k] / bN[k]);
  for (const k of Object.keys(clearanceByZone)) clearanceByZone[k] = r1(clearanceByZone[k]);
  for (const k of Object.keys(clearanceByLevel)) clearanceByLevel[k] = r1(clearanceByLevel[k]);
  const nLast = Math.min(20, A.length);
  const key = (a: Agent) => (a.inside ? Infinity : a.tLeftBuilding);
  const last = [...A].sort((x, y) => key(x) - key(y)).slice(A.length - nLast);
  const zones: Record<string, number> = {};
  for (const a of last) zones[zoneOf(a)] = (zones[zoneOf(a)] ?? 0) + 1;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : NaN);
  const r2 = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN);
  return {
    insideAt180: insideSeries.length > 180 ? insideSeries[180] : A.filter((a) => a.inside || a.tLeftBuilding > 180).length,
    clearanceByZone,
    clearanceByLevel,
    meanExitByBlock,
    lastOut: {
      n: nLast,
      zones,
      elderlyShare: r2(mean(last.map((a) => (a.elderly ? 1 : 0)))),
      groupShare: r2(mean(last.map((a) => (a.group >= 0 ? 1 : 0)))),
      meanStart: r2(mean(last.filter((a) => Number.isFinite(a.tStartMove)).map((a) => a.tStartMove))),
      meanWait: r2(mean(last.map(waitOf))),
      meanSpeed: r2(mean(last.map((a) => a.v0))),
    },
  };
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function buildResult(sim: SimulationEngine, wallTimeMs: number, opts: { agents?: boolean; heat?: boolean }): RunResult {
  const A = sim.agents;
  const g = sim.graph;
  const m = sim.metrics;
  const exitTimes = A.filter((a) => !a.inside).map((a) => a.tLeftBuilding).sort((x, y) => x - y);
  const startTimes = A.filter((a) => Number.isFinite(a.tStartMove)).map((a) => a.tStartMove).sort((x, y) => x - y);
  const allLeft = A.every((a) => !a.inside);
  const ambulatory = A.filter((a) => !a.wheelchair);
  const allSafe = ambulatory.every((a) => a.state === ST.EXITED);
  const wheelOk = A.filter((a) => a.wheelchair).every((a) => a.state === ST.AWAITING_ASSIST || a.state === ST.EXITED);
  const safeTimes = ambulatory.filter((a) => a.state === ST.EXITED).map((a) => a.tSafe);
  // assisted descents: completion time is known on arrival at the assistance point
  const wheel = A.filter((a) => a.wheelchair);
  const wheelSafe = wheel.map((a) => (a.state === ST.EXITED ? a.tSafe : a.state === ST.AWAITING_ASSIST && Number.isFinite(a.assistDue) ? a.assistDue : NaN));
  const tSafeAll = allSafe && wheelSafe.every((v) => Number.isFinite(v)) ? Math.max(0, ...safeTimes, ...wheelSafe) : NaN;
  const tail = tailMetrics(sim.geo, A, m.inside);
  const groupUsage = Object.fromEntries(EXIT_GROUPS.map((gname) => [gname, 0])) as Record<ExitGroupId, number>;
  const doorUsage: Record<string, number> = {};
  for (const a of A) {
    if (a.exitLink < 0 || a.inside) continue;
    const L = g.links[a.exitLink];
    if (L.exitGroup >= 0) groupUsage[EXIT_GROUPS[L.exitGroup]]++;
    doorUsage[L.label] = (doorUsage[L.label] ?? 0) + 1;
  }
  const gates: GateStat[] = [];
  for (const L of g.links) {
    if (!L.gate) continue;
    const passes = sim.gates.passes[L.idx];
    const log = sim.gates.passLog.get(L.idx) ?? [];
    gates.push({
      id: L.id,
      label: L.label,
      kind: L.kind,
      capacity: Math.round(sim.gates.baseCap[L.idx] * 1000) / 1000,
      passes,
      maxQueue: sim.gates.queueMax[L.idx],
      totalWait: Math.round(sim.gates.waitSum[L.idx] * 10) / 10,
      meanWait: passes > 0 ? Math.round((sim.gates.waitSum[L.idx] / passes) * 100) / 100 : 0,
      maxPassesPerSecond: log.length ? Math.max(...log) : 0,
    });
  }
  const used = Object.values(groupUsage).filter((v) => v > 0);
  const meanLoad = used.length ? used.reduce((x, y) => x + y, 0) / used.length : 0;
  const imbalance = meanLoad > 0 ? Math.max(...used) / meanLoad : 0;
  const res: RunResult = {
    seed: sim.seed,
    label: sim.cfg.label,
    scenarioId: sim.cfg.scenarioId,
    N: A.length,
    completed: allSafe && wheelOk,
    allLeftBuilding: allLeft,
    gridlock: sim.gridlock,
    tEvac: allLeft && exitTimes.length ? exitTimes[exitTimes.length - 1] : allLeft ? 0 : NaN,
    tEvacAmbulatory: ambulatory.every((a) => !a.inside) ? Math.max(0, ...ambulatory.map((a) => a.tLeftBuilding)) : NaN,
    tSafe: allSafe && safeTimes.length ? Math.max(...safeTimes) : allSafe ? 0 : NaN,
    tEnd: sim.t,
    tSafeAll,
    meanExit: exitTimes.length ? exitTimes.reduce((x, y) => x + y, 0) / exitTimes.length : NaN,
    medianExit: quantile(exitTimes, 0.5),
    p90Exit: quantile(exitTimes, 0.9),
    p95Exit: quantile(exitTimes, 0.95),
    p99Exit: quantile(exitTimes, 0.99),
    ...tail,
    meanStart: startTimes.length ? startTimes.reduce((x, y) => x + y, 0) / startTimes.length : NaN,
    medianStart: quantile(startTimes, 0.5),
    p95Start: quantile(startTimes, 0.95),
    series: {
      leftBuilding: m.leftBuilding,
      inside: m.inside,
      safe: m.safe,
      moving: m.moving,
      queuing: m.queuing,
      notStarted: m.notStarted,
    },
    exitGroupUsage: groupUsage,
    exitDoorUsage: doorUsage,
    gates,
    peakDensity: Math.round(m.peakDensity * 100) / 100,
    peakDensityWhere: m.peakDensityLink >= 0 ? g.links[m.peakDensityLink].label : '-',
    highDensityExposure: Math.round(m.highDensityExposure),
    totalReroutes: A.reduce((acc, a) => acc + a.reroutes, 0),
    reroutedAgents: A.filter((a) => a.reroutes > 0).length,
    unresolved: {
      inside: A.filter((a) => a.inside).length,
      awaitingAssistance: A.filter((a) => a.state === ST.AWAITING_ASSIST).length,
      trapped: A.filter((a) => a.state === ST.TRAPPED).length,
      notSafe: A.filter((a) => a.state !== ST.EXITED).length,
    },
    exitImbalance: Math.round(imbalance * 100) / 100,
    wallTimeMs,
  };
  if (opts.heat) {
    res.heat = sim.heat.map((h, k) => ({
      floor: k + 1,
      x0: h.x0,
      y0: h.y0,
      cell: h.cell,
      nx: h.nx,
      ny: h.ny,
      max: Array.from(h.maxD, (v) => Math.round(v * 100) / 100),
      mean: Array.from(h.sumD, (v) => Math.round((v / Math.max(1, h.samples)) * 1000) / 1000),
    }));
  }
  res.density = sim.densityResult();
  res.managers = sim.managerSummaries();
  res.behaviour = behaviourSummary(A, (a) => (a.exitLink >= 0 && !a.inside ? g.links[a.exitLink].exitGroup : -1), sim.guidance.cms.reduce((s, c) => s + c.history.filter((h) => h.planned >= 0).length, 0));
  if (opts.agents) res.agents = A.map((a) => agentRecord(sim, a));
  return res;
}

export function agentRecord(sim: SimulationEngine, a: Agent): AgentRecord {
  const seat = sim.geo.seats[a.seat];
  const L = a.exitLink >= 0 ? sim.graph.links[a.exitLink] : null;
  const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : NaN);
  return {
    id: a.id,
    seat: seat.id,
    level: seat.level,
    zone: seat.zone,
    type: a.type,
    v0: Math.round(a.v0 * 100) / 100,
    elderly: a.elderly,
    wheelchair: a.wheelchair,
    group: a.group,
    tAware: r1(a.tAware),
    tStartMove: r1(a.tStartMove),
    tLeftBuilding: r1(a.tLeftBuilding),
    tSafe: r1(a.tSafe),
    exitGroup: L && L.exitGroup >= 0 ? EXIT_GROUPS[L.exitGroup] : '',
    exitDoor: L ? L.label : '',
    reroutes: a.reroutes,
    waitTotal: r1(a.waitTotal),
    finalState: String(a.state),
    events: a.events,
    conflicts: a.conflicts,
    trust: Math.round(a.trust * 100) / 100,
    urgency: Math.round(a.urgency * 100) / 100,
    exposure: Math.round(a.exposure * 100) / 100,
    cmSource: a.cmSource >= 0 && sim.guidance.cms[a.cmSource] ? sim.guidance.cms[a.cmSource].id : '',
  };
}
