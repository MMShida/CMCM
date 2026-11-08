/**
 * Model C.2: time-expanded network flow (quickest / earliest-arrival evacuation benchmark).
 *
 * Discretisation with step dt (default 1 s), layers k = 0..H:
 *   node copies (v, k) for every network node v
 *   movement arc  (u, k) -> (v, k + tau_a)        capacity c_a(k) = floor(c_a (k+1) dt) - floor(c_a k dt)
 *                 tau_a = round(length_a / (v_rep * stairFactor_a) / dt)   (0 allowed for very short links)
 *   holdover arc  (v, k) -> (v, k + 1)            capacity S_v (storage = rho_max * area), +inf at sources
 *   supply arc    s* -> (z, k)                    capacity = #persons of zone z released at step k
 *   sink arc      (x, k) -> t*                    +inf for exterior-door sinks x
 * The cumulative-floor capacity c_a(k) is the deterministic accumulator also used to discretise
 * Model B's fractional gate capacities; summed over any K consecutive steps it never exceeds
 * c_a K dt + 1.
 *
 * Quickest evacuation: T* = min { H : maxflow(H) = N }.
 * Earliest-arrival curve: A(H) = maxflow(H) for every H. The network is grown one layer at a
 * time and the flow is AUGMENTED (never recomputed): adding layer H only adds arcs, so the
 * previous maximum flow stays feasible, and the flow on sink arcs of earlier layers never
 * decreases (t* is never an interior node of an augmenting path). Hence the final flow
 * simultaneously attains A(H) for every H (Gale 1959; Minieka 1973) and one pass gives the
 * whole curve.
 *
 * This is an idealised benchmark: perfectly coordinated routing, people at the representative
 * free speed, no behaviour beyond the supplied release times.
 */
import type { SimConfig } from '../simulation/Params';
import { hardPanelIds } from '../simulation/Barriers';
import { FlowNetwork } from './MaxFlow';
import type { BuildingNetwork } from './NetworkGraph';
import { closedEdges } from './StaticFlow';

export interface Release {
  /** source node index */
  source: number;
  /** release time (s): when the person is ready at the source (row walk included) */
  t: number;
}

export interface TimeExpandedOptions {
  dt?: number;
  /** maximum horizon (s) */
  maxHorizon?: number;
  closed?: string[];
  barriers?: string[];
  /** speed used for transit times (default: representative free speed of the configuration) */
  speed?: number;
  /** enforce node storage on holdover arcs (default true) */
  storage?: boolean;
  /** include the urgency multiplier on gate capacities (default true) */
  urgency?: boolean;
}

export interface TimeExpandedResult {
  dt: number;
  /** quickest evacuation time T* (s); NaN if not reached within maxHorizon */
  tStar: number;
  /** curve[k] = maximum number of people outside by time k*dt */
  curve: number[];
  N: number;
  /** persons per exit group in the earliest-arrival solution */
  exitUsage: Record<string, number>;
  /** total persons through each network edge */
  edgeTotals: number[];
  /** fraction of layers in which each edge's arc ran at capacity (bottleneck indicator) */
  edgeSaturation: number[];
  layers: number;
  arcs: number;
  wallTimeMs: number;
  /** continuous vs discretised shortest travel time from every source (diagnostic) */
  discretisation: { maxAbsError: number; meanAbsError: number };
}

/** cumulative-floor capacity of a rate c (persons/s) in step k of length dt */
export function stepCapacity(c: number, k: number, dt: number): number {
  if (!Number.isFinite(c)) return Infinity;
  return Math.floor(c * (k + 1) * dt + 1e-9) - Math.floor(c * k * dt + 1e-9);
}

export function transitSteps(net: BuildingNetwork, edge: number, speed: number, stairRatio: number, dt: number): number {
  const E = net.edges[edge];
  if (E.length <= 0) return 0;
  const v = E.isStair ? speed * stairRatio : speed;
  return Math.max(0, Math.round(E.length / v / dt));
}

export function timeExpandedFlow(net: BuildingNetwork, cfg: SimConfig, releases: Release[], opt: TimeExpandedOptions = {}): TimeExpandedResult {
  const t0 = Date.now();
  const dt = opt.dt ?? 1;
  const Hmax = Math.ceil((opt.maxHorizon ?? 1200) / dt);
  const speed = opt.speed ?? net.rates.vRep;
  const stairRatio = cfg.population.stairRatio;
  const closed = closedEdges(net, opt.closed ?? cfg.blocked.links, opt.barriers ?? hardPanelIds(cfg));
  const mult = opt.urgency === false ? 1 : net.rates.urgencyMult;
  const useStorage = opt.storage !== false;
  const nV = net.nodes.length;
  const N = releases.length;

  // supplies per (source, step)
  const supply = new Map<number, Map<number, number>>();
  let lastRelease = 0;
  for (const r of releases) {
    const k = Math.max(0, Math.round(r.t / dt));
    lastRelease = Math.max(lastRelease, k);
    let m = supply.get(k);
    if (!m) supply.set(k, (m = new Map()));
    m.set(r.source, (m.get(r.source) ?? 0) + 1);
  }

  const arcs = net.arcs.filter((A) => !closed.has(A.edge));
  const tau = arcs.map((A) => transitSteps(net, A.edge, speed, stairRatio, dt));
  const capRate = arcs.map((A) => {
    const E = net.edges[A.edge];
    return E.capacity * (E.isGate ? mult : 1);
  });
  // arcs grouped by head layer offset
  const F = new FlowNetwork(2 + nV * 64, 1 << 16);
  const S = F.addNode();
  const T = F.addNode();
  const layerBase: number[] = [];
  const id = (v: number, k: number) => layerBase[k] + v;
  // forward arc index -> (arc index in `arcs`, tail layer)
  const arcOf: number[] = [];
  const arcLayer: number[] = [];
  const curve: number[] = [];
  let total = 0;
  let tStar = NaN;
  const sat = new Float64Array(net.edges.length);
  const satCount = new Float64Array(net.edges.length);

  for (let k = 0; k <= Hmax; k++) {
    layerBase[k] = F.addNodes(nV);
    // holdover arcs from layer k-1
    if (k > 0)
      for (let v = 0; v < nV; v++) {
        const Nd = net.nodes[v];
        if (Nd.kind === 'sink') continue;
        const c = Nd.kind === 'source' || !useStorage ? Infinity : Nd.storage;
        F.addArc(id(v, k - 1), id(v, k), c);
      }
    // movement arcs whose head lies in layer k
    for (let i = 0; i < arcs.length; i++) {
      const kt = k - tau[i];
      if (kt < 0) continue;
      const c = stepCapacity(capRate[i], kt, dt);
      if (c <= 0) continue;
      const e = F.addArc(id(arcs[i].from, kt), id(arcs[i].to, k), c, i);
      arcOf[e] = i;
      arcLayer[e] = kt;
    }
    // supplies released in layer k
    const m = supply.get(k);
    if (m) for (const [src, cnt] of m) F.addArc(S, id(src, k), cnt);
    // sinks of layer k
    for (const s of net.sinks) F.addArc(id(s, k), T, Infinity);
    total += F.maxflow(S, T);
    curve.push(Math.round(total));
    if (total >= N - 1e-6) {
      tStar = k * dt;
      break;
    }
  }
  // flows per physical edge
  const edgeTotals = new Array(net.edges.length).fill(0);
  const exitUsage: Record<string, number> = {};
  for (let e = 0; e < F.m; e += 2) {
    const i = F.tag[e];
    if (i < 0) continue;
    const A = arcs[i];
    const f = F.flow(e);
    const E = net.edges[A.edge];
    satCount[A.edge] += 1;
    if (f > 0 && f >= F.cap0[e] - 1e-9) sat[A.edge] += 1;
    if (f <= 0) continue;
    edgeTotals[A.edge] += f;
    if (E.exterior) {
      const g = E.exitGroup >= 0 ? ['FOYER', 'PORTICO_W', 'PORTICO_E', 'STAGE_W', 'STAGE_E', 'BAL_NW', 'BAL_NE'][E.exitGroup] : E.id;
      exitUsage[g] = (exitUsage[g] ?? 0) + f;
    }
  }
  const edgeSaturation = edgeTotals.map((_, i) => (satCount[i] ? sat[i] / satCount[i] : 0));
  void lastRelease;
  return {
    dt,
    tStar,
    curve,
    N,
    exitUsage,
    edgeTotals,
    edgeSaturation,
    layers: layerBase.length,
    arcs: F.m / 2,
    wallTimeMs: Date.now() - t0,
    discretisation: discretisationError(net, arcs.map((a) => a.idx), tau, speed, stairRatio, dt),
  };
}

/** compare continuous and discretised shortest times from every source to the nearest sink */
function discretisationError(net: BuildingNetwork, arcIdx: number[], tau: number[], speed: number, stairRatio: number, dt: number) {
  const nV = net.nodes.length;
  const errs: number[] = [];
  const contW = arcIdx.map((ai) => {
    const E = net.edges[net.arcs[ai].edge];
    return E.length / (E.isStair ? speed * stairRatio : speed);
  });
  const discW = tau.map((t) => t * dt);
  const sp = (w: number[]) => {
    // reverse Dijkstra from all sinks (small graph: simple O(V^2))
    const d = new Float64Array(nV).fill(Infinity);
    const done = new Uint8Array(nV);
    for (const s of net.sinks) d[s] = 0;
    for (;;) {
      let u = -1;
      for (let v = 0; v < nV; v++) if (!done[v] && d[v] < Infinity && (u < 0 || d[v] < d[u])) u = v;
      if (u < 0) break;
      done[u] = 1;
      arcIdx.forEach((ai, i) => {
        const A = net.arcs[ai];
        if (A.to === u && d[u] + w[i] < d[A.from]) d[A.from] = d[u] + w[i];
      });
    }
    return d;
  };
  const dc = sp(contW);
  const dd = sp(discW);
  for (const [, src] of net.sourceOfZone) if (Number.isFinite(dc[src])) errs.push(Math.abs(dd[src] - dc[src]));
  return { maxAbsError: Math.max(0, ...errs), meanAbsError: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0 };
}

/**
 * Releases for the ideal benchmarks from a population (seat -> zone source, row walk included).
 * Wheelchair users are NOT part of the flow (they need the accessible route and assistance);
 * they enter the individual bound below instead.
 */
export function releasesFromPopulation(
  net: BuildingNetwork,
  cfg: SimConfig,
  people: { seat: number; tDepart: number; wheelchair?: boolean }[],
): Release[] {
  const geo = net.geo;
  const out: Release[] = [];
  for (const p of people) {
    if (p.wheelchair) continue;
    const seat = geo.seats[p.seat];
    const src = net.sourceOfZone.get(seat.zone);
    if (src === undefined) continue;
    out.push({ source: src, t: p.tDepart + rowWalkTime(net, cfg, p.seat, net.rates.vRep) });
  }
  return out;
}

export interface SeatExit {
  /** network node of the row end */
  node: number;
  /** distance along the row (m), walked at the row speed */
  row: number;
  /** distance from the detailed row end to the network node (m), walked at the free speed */
  extra: number;
}

/** usable row ends of a seat, nearest first */
export function seatExits(net: BuildingNetwork, seatIdx: number): SeatExit[] {
  const seat = net.geo.seats[seatIdx];
  const ends = net.rowEnds.get(seat.link) ?? [];
  const L = net.detailed.links[net.detailed.linkIndex.get(seat.link)!];
  const out = ends.map((e) => {
    const atA = net.detailed.nodes[L.a].id === e.detailedNode;
    return { node: e.node, row: Math.max(0, atA ? seat.s : L.len - seat.s), extra: e.extra };
  });
  out.sort((a, b) => a.row + a.extra - (b.row + b.extra));
  return out;
}

export interface IndividualPerson {
  seat: number;
  tDepart: number;
  v0: number;
  stairRatio: number;
  wheelchair?: boolean;
}

/**
 * Individual lower bound (no congestion at all): every person needs at least
 *   t_depart + row walk + (shortest effective length to an exterior door) / v_i,
 * with stair lengths divided by the person's own stair-speed ratio and, for wheelchair users,
 * accessible links only. No plan or routing can beat max_i of this, whatever the capacities.
 * Complements the flow benchmark, which uses one representative speed for everybody.
 */
export function individualBound(net: BuildingNetwork, cfg: SimConfig, people: IndividualPerson[], closedLinks?: string[], barriers?: string[]): { tInd: number; who: number; times: number[] } {
  const closed = closedEdges(net, closedLinks ?? cfg.blocked.links, barriers ?? hardPanelIds(cfg));
  const nV = net.nodes.length;
  const fieldCache = new Map<string, Float64Array>();
  const field = (ratio: number, accessible: boolean) => {
    const key = `${ratio}|${accessible}`;
    let d = fieldCache.get(key);
    if (d) return d;
    d = new Float64Array(nV).fill(Infinity);
    const done = new Uint8Array(nV);
    for (const s of net.sinks) d[s] = 0;
    for (;;) {
      let u = -1;
      for (let v = 0; v < nV; v++) if (!done[v] && d[v] < Infinity && (u < 0 || d[v] < d[u])) u = v;
      if (u < 0) break;
      done[u] = 1;
      for (const A of net.arcs) {
        if (A.to !== u || closed.has(A.edge)) continue;
        const E = net.edges[A.edge];
        if (E.kind === 'rowExit') continue;
        if (accessible && (E.isStair || !E.accessible)) continue;
        const w = E.isStair ? E.length / Math.max(0.05, ratio) : E.length;
        if (d[u] + w < d[A.from]) d[A.from] = d[u] + w;
      }
    }
    fieldCache.set(key, d);
    return d;
  };
  const times = people.map((p) => {
    // An unknown departure cannot certify full-house clearance; do not drop that person.
    if (!Number.isFinite(p.tDepart)) return Infinity;
    const d = field(p.wheelchair ? 1 : p.stairRatio, !!p.wheelchair);
    let best = Infinity;
    for (const e of seatExits(net, p.seat)) {
      const t = e.row / Math.max(0.05, Math.min(cfg.movement.rowSpeed, p.v0)) + (e.extra + d[e.node]) / Math.max(0.05, p.v0);
      if (t < best) best = t;
    }
    return p.tDepart + best;
  });
  let tInd = 0;
  let who = -1;
  times.forEach((t, i) => {
    if (t > tInd) {
      tInd = t;
      who = i;
    }
  });
  return { tInd, who, times };
}

/**
 * Pre-movement budget: the largest factor alpha such that the ideal time-expanded evacuation with
 * departures alpha * t_depart still meets the target (bisection; T*(alpha) is non-decreasing).
 * alpha < 1 means people must start faster than the sampled pre-movement for the target to be
 * feasible even with perfect coordination; alpha = 0 is the immediate-start case.
 */
export function premovementBudget(net: BuildingNetwork, cfg: SimConfig, people: { seat: number; tDepart: number; wheelchair?: boolean }[], target = 180, dt = 1): { alpha: number; tStarAt1: number; tStarAt0: number } {
  const T = (alpha: number) => timeExpandedFlow(net, cfg, releasesFromPopulation(net, cfg, people.map((p) => ({ ...p, tDepart: alpha * p.tDepart }))), { dt, maxHorizon: 1200 }).tStar;
  const t1 = T(1);
  const t0 = T(0);
  if (!(t0 <= target)) return { alpha: 0, tStarAt1: t1, tStarAt0: t0 };
  if (t1 <= target) {
    // feasible at the sampled pre-movement: report how much slower it could be (up to x3)
    let lo = 1;
    let hi = 3;
    if (T(hi) <= target) return { alpha: hi, tStarAt1: t1, tStarAt0: t0 };
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (T(mid) <= target) lo = mid;
      else hi = mid;
    }
    return { alpha: lo, tStarAt1: t1, tStarAt0: t0 };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (T(mid) <= target) lo = mid;
    else hi = mid;
  }
  return { alpha: lo, tStarAt1: t1, tStarAt0: t0 };
}

/** time (s) from the seat to the nearest row-end network node */
export function rowWalkTime(net: BuildingNetwork, cfg: SimConfig, seatIdx: number, speed: number): number {
  const ex = seatExits(net, seatIdx);
  if (!ex.length) return net.geo.seats[seatIdx].aisleDist / Math.max(0.05, cfg.movement.rowSpeed);
  let best = Infinity;
  for (const e of ex) best = Math.min(best, e.row / Math.max(0.05, cfg.movement.rowSpeed) + e.extra / Math.max(0.05, speed));
  return best;
}
