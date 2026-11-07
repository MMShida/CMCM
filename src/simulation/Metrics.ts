/**
 * Per-run metrics. Sampled once per simulated second.
 */
import { EXIT_GROUPS } from '../geometry/types';
import type { ExitGroupId } from '../geometry/types';
import type { Agent } from './Agent';
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
  meanExit: number;
  medianExit: number;
  p95Exit: number;
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
  agents?: AgentRecord[];
  wallTimeMs: number;
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
    for (const a of sim.agents) {
      if (a.link < 0 || a.densityHere < thr) continue;
      const L = sim.graph.links[a.link];
      if (L.isRow || L.len < 1.5) continue;
      this.highDensityExposure += dt;
    }
  }
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
    meanExit: exitTimes.length ? exitTimes.reduce((x, y) => x + y, 0) / exitTimes.length : NaN,
    medianExit: quantile(exitTimes, 0.5),
    p95Exit: quantile(exitTimes, 0.95),
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
  };
}
