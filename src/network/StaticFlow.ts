/**
 * Model C.1: static maximum flow / minimum cut on the building network.
 *
 *   G = (V, E),  c_e = capacity of edge e (persons/s),  super-source s*, super-sink t*
 *   s* -> every population source (capacity +inf: we ask for a RATE, not a population)
 *   population source z -> row-end node n : (#row ends of z at n) * J_row
 *   exterior-door sink -> t* : +inf
 *   max  F = sum_e f(s*, .)   s.t. 0 <= f_e <= c_e, conservation       (persons/s)
 *
 * F* is the largest sustainable steady-state discharge rate. It is NOT an evacuation time:
 * a finite population N needs at least  T >= tau_min + N / F*  (tau_min = shortest travel time),
 * and the true quickest evacuation (time-expanded model, TimeExpanded.ts) is usually longer
 * because supplies are spatially uneven and must first reach the bottlenecks.
 *
 * Population counts are NEVER used as capacities here (that would mix persons and persons/s).
 */
import type { GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { SimConfig } from '../simulation/Params';
import { FlowNetwork } from './MaxFlow';
import type { BuildingNetwork } from './NetworkGraph';
import { networkFor } from './NetworkGraph';

export interface StaticFlowOptions {
  /** detailed link / network edge ids that are closed (blocked exits) */
  closed?: string[];
  /** corridor barrier slot ids */
  barriers?: string[];
  /** 'rows': row-end capacities limit the supply; 'unlimited': the building alone is analysed */
  sourceMode?: 'rows' | 'unlimited';
  /** only these levels supply flow */
  levels?: ('orchestra' | 'mezzanine' | 'balcony')[];
  /** include the urgency multiplier g(u, 0) on gate capacities (as the agents experience) */
  urgency?: boolean;
}

export interface CutEdge {
  id: string;
  label: string;
  kind: string;
  capacity: number;
  region: string;
}

export interface StaticFlowResult {
  maxFlow: number;
  cut: CutEdge[];
  cutCapacity: number;
  /** flow (persons/s) on each network edge (both directions summed, signed a->b positive) */
  edgeFlow: number[];
  /** discharge per exit group at the maximum flow */
  exitFlow: Record<string, number>;
  /** 1329 / 180 s */
  requiredRate: number;
  N: number;
  /** N / F*: pure-flow time (s), a LOWER bound ingredient, not an evacuation time */
  flowTime: number;
}

export function closedEdges(net: BuildingNetwork, closed: string[] = [], barriers: string[] = []): Set<number> {
  return new Set(net.edgesForLinks([...closed, ...barriers]));
}

export function staticMaxFlow(net: BuildingNetwork, cfg: SimConfig, N: number, opt: StaticFlowOptions = {}): StaticFlowResult {
  const closed = closedEdges(net, opt.closed ?? cfg.blocked.links, opt.barriers ?? cfg.barriers);
  const nV = net.nodes.length;
  const F = new FlowNetwork(nV + 2, 2 * (net.arcs.length + nV + 40));
  F.addNodes(nV + 2);
  const S = nV;
  const T = nV + 1;
  const mult = opt.urgency === false ? 1 : net.rates.urgencyMult;
  const levels = opt.levels;
  const zoneLevel = new Map(net.geo.zones.map((z) => [z.id, z.level]));
  for (const A of net.arcs) {
    const E = net.edges[A.edge];
    if (closed.has(E.idx)) continue;
    const srcNode = net.nodes[A.from];
    if (E.kind === 'rowExit') {
      if (levels && !levels.includes(zoneLevel.get(srcNode.zone!) as any)) continue;
      F.addArc(A.from, A.to, opt.sourceMode === 'unlimited' ? Infinity : E.capacity, A.idx);
      continue;
    }
    F.addArc(A.from, A.to, E.capacity * (E.isGate ? mult : 1), A.idx);
  }
  for (const [, src] of net.sourceOfZone) F.addArc(S, src, Infinity);
  for (const s of net.sinks) F.addArc(s, T, Infinity);
  const flow = F.maxflow(S, T);
  const cutArcs = F.minCut(S).filter((e) => F.tag[e] >= 0);
  const seen = new Set<number>();
  const cut: CutEdge[] = [];
  for (const e of cutArcs) {
    const A = net.arcs[F.tag[e]];
    const E = net.edges[A.edge];
    if (seen.has(E.idx)) continue;
    seen.add(E.idx);
    cut.push({ id: E.id, label: E.label, kind: E.kind, capacity: F.cap0[e], region: net.nodes[A.from].region });
  }
  cut.sort((a, b) => a.region.localeCompare(b.region) || a.id.localeCompare(b.id));
  const edgeFlow = new Array(net.edges.length).fill(0);
  const exitFlow: Record<string, number> = Object.fromEntries(EXIT_GROUPS.map((g) => [g, 0]));
  for (let e = 0; e < F.m; e += 2) {
    const tag = F.tag[e];
    if (tag < 0) continue;
    const A = net.arcs[tag];
    const f = F.flow(e);
    edgeFlow[A.edge] += A.dir * f;
    const E = net.edges[A.edge];
    if (E.exterior && E.exitGroup >= 0) exitFlow[EXIT_GROUPS[E.exitGroup]] += f;
  }
  return { maxFlow: flow, cut, cutCapacity: cut.reduce((s, c) => s + c.capacity, 0), edgeFlow, exitFlow, requiredRate: N / 180, N, flowTime: N / flow };
}

export interface BlockingEffect {
  id: string;
  label: string;
  maxFlow: number;
  delta: number;
}

/** Effect of closing each door / access point / stair entry on the maximum flow. */
export function blockingEffects(net: BuildingNetwork, cfg: SimConfig, N: number, ids?: string[]): { base: number; effects: BlockingEffect[] } {
  const base = staticMaxFlow(net, cfg, N, { closed: [], barriers: cfg.barriers }).maxFlow;
  const cand = ids ?? net.edges.filter((e) => e.feature && !e.barrierSlot && (e.isGate || e.exterior)).map((e) => e.id);
  const effects = cand.map((id) => {
    const r = staticMaxFlow(net, cfg, N, { closed: [id], barriers: cfg.barriers });
    return { id, label: net.edgeById(id).label, maxFlow: r.maxFlow, delta: r.maxFlow - base };
  });
  effects.sort((a, b) => a.delta - b.delta);
  return { base, effects };
}

/** Max flow per level and for the whole building, with the min-cut of each. */
export function flowReport(geo: GeometryData, cfg: SimConfig, N = 1329) {
  const net = networkFor(geo, cfg);
  const all = staticMaxFlow(net, cfg, N);
  const building = staticMaxFlow(net, cfg, N, { sourceMode: 'unlimited' });
  const byLevel = (['orchestra', 'mezzanine', 'balcony'] as const).map((lv) => ({ level: lv, ...staticMaxFlow(net, cfg, N, { levels: [lv] }) }));
  return { net, all, building, byLevel };
}
