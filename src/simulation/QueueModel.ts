/**
 * Network-flow cross-check (independent of the agent dynamics).
 *
 * The building is treated as a capacitated directed network: every walkable link carries at
 * most c_l persons/s, where
 *   gates (doors, stairs)      c_l = C_l (the same token-bucket capacity the agents face, u = 0)
 *   other links                c_l = lanes_l * J_lane,  J_lane = v / (d_min + v T)   (headway model)
 *   seat-row ends              c = J_lane at the row speed 0.45 m/s
 * with storey stairs usable downwards only. The maximum s-t flow F* (Dinic's algorithm) from all
 * row ends to all street destinations is an upper bound on the building's evacuation RATE, so
 *   T_evac >= t_pre + N / F*
 * for any routing, and the minimum cut names the structural bottleneck. The agent model must
 * never discharge faster than F* (checked in tests/queuemodel.test.ts).
 */
import type { NavGraph } from '../geometry/NavigationGraph';
import type { GeometryData } from '../geometry/types';
import type { SimConfig } from './Params';
import { GateSystem } from './QueueSystem';
import { graphFor } from './SimulationEngine';

interface Edge {
  to: number;
  cap: number;
  rev: number;
  link: number;
}

class Dinic {
  g: Edge[][];
  level: Int32Array;
  it: Int32Array;
  constructor(n: number) {
    this.g = Array.from({ length: n }, () => []);
    this.level = new Int32Array(n);
    this.it = new Int32Array(n);
  }
  add(u: number, v: number, cap: number, link = -1) {
    this.g[u].push({ to: v, cap, rev: this.g[v].length, link });
    this.g[v].push({ to: u, cap: 0, rev: this.g[u].length - 1, link: -1 });
  }
  private bfs(s: number, t: number): boolean {
    this.level.fill(-1);
    const q = [s];
    this.level[s] = 0;
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const e of this.g[u])
        if (e.cap > 1e-12 && this.level[e.to] < 0) {
          this.level[e.to] = this.level[u] + 1;
          q.push(e.to);
        }
    }
    return this.level[t] >= 0;
  }
  private dfs(u: number, t: number, f: number): number {
    if (u === t) return f;
    for (; this.it[u] < this.g[u].length; this.it[u]++) {
      const e = this.g[u][this.it[u]];
      if (e.cap > 1e-12 && this.level[e.to] === this.level[u] + 1) {
        const d = this.dfs(e.to, t, Math.min(f, e.cap));
        if (d > 0) {
          e.cap -= d;
          this.g[e.to][e.rev].cap += d;
          return d;
        }
      }
    }
    return 0;
  }
  maxflow(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      this.it.fill(0);
      let f: number;
      while ((f = this.dfs(s, t, Infinity)) > 0) flow += f;
    }
    return flow;
  }
  /** nodes reachable from s in the residual graph (source side of the min cut) */
  reachable(s: number): Uint8Array {
    const seen = new Uint8Array(this.g.length);
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const u = st.pop()!;
      for (const e of this.g[u])
        if (e.cap > 1e-12 && !seen[e.to]) {
          seen[e.to] = 1;
          st.push(e.to);
        }
    }
    return seen;
  }
}

export interface FlowBound {
  /** maximum evacuation rate (persons/s) */
  maxFlow: number;
  /** links in the minimum cut (the structural bottleneck) */
  cut: { id: string; label: string; capacity: number }[];
  /** N / F* (s): pure flow time for N persons */
  flowTime: number;
  N: number;
}

export function laneCapacity(v: number, dmin: number, T: number): number {
  return v / (dmin + v * T);
}

export interface FlowOptions {
  /** 'street': street-level destinations; 'exterior': just outside the exterior doors (problem's definition) */
  sink?: 'street' | 'exterior';
  /** only seats of this level act as sources */
  level?: 'orchestra' | 'mezzanine' | 'balcony';
}

export function maxFlowBound(geo: GeometryData, cfg: SimConfig, N: number, closed: string[] = [], opt: FlowOptions = {}): FlowBound {
  const g: NavGraph = graphFor(geo, cfg.movement.laneWidth);
  const gates = new GateSystem(g, { ...cfg, movement: { ...cfg.movement, urgency: 0 } });
  const n = g.nodes.length;
  const S = n;
  const T = n + 1;
  const D = new Dinic(n + 2);
  const closedSet = new Set(closed.map((id) => g.linkByIdOrThrow(id)));
  const dmin = 2 * cfg.population.radiusMean;
  const Th = cfg.movement.timeHeadway;
  const walkCap = laneCapacity(1.2 * cfg.population.speedMean / 1.2, dmin, Th);
  const stairCap = laneCapacity(cfg.population.speedMean * cfg.population.stairRatio, dmin, Th);
  const rowCap = laneCapacity(cfg.movement.rowSpeed, dmin, Th);
  for (const L of g.links) {
    if (L.prohibited || L.isRow || closedSet.has(L.idx)) continue;
    const c = L.gate ? gates.baseCap[L.idx] : L.lanes * (L.isStair ? stairCap : walkCap);
    if (!g.climbs(L.idx, 1)) D.add(L.a, L.b, c, L.idx);
    if (!L.oneWay && !g.climbs(L.idx, -1)) D.add(L.b, L.a, c, L.idx);
  }
  // sources: both usable ends of every occupied seat row
  const rows = new Set(geo.seats.filter((s) => !s.wheelchair && (!opt.level || s.level === opt.level)).map((s) => s.link));
  for (const id of rows) {
    const L = g.links[g.linkByIdOrThrow(id)];
    for (const end of [L.a, L.b]) if (g.nodes[end].kind !== 'deadEnd') D.add(S, end, rowCap);
  }
  if (opt.sink === 'exterior') {
    for (const L of g.links) if (L.exterior && !closedSet.has(L.idx)) D.add(L.b, T, Infinity);
  } else for (const targets of g.safeByGroup) for (const t of targets) D.add(t, T, Infinity);
  const flow = D.maxflow(S, T);
  const side = D.reachable(S);
  const cut: FlowBound['cut'] = [];
  const seen = new Set<number>();
  for (let u = 0; u < n; u++) {
    if (!side[u]) continue;
    for (const e of D.g[u]) {
      if (e.link < 0 || side[e.to] || seen.has(e.link)) continue;
      seen.add(e.link);
      const L = g.links[e.link];
      cut.push({ id: L.id, label: L.label, capacity: L.gate ? gates.baseCap[L.idx] : L.lanes * (L.isStair ? stairCap : walkCap) });
    }
  }
  cut.sort((a, b) => b.capacity - a.capacity);
  return { maxFlow: flow, cut, flowTime: N / flow, N };
}
