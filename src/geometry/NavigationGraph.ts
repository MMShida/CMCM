/**
 * Runtime navigation graph built from the geometry JSON.
 *
 * Nodes are decision points (aisle junctions, doors, landings...), links are
 * physically walkable channels (rows, aisles, corridors, doors, stairs) with
 * polyline geometry. Agents only ever occupy links, so they can never cross a
 * wall: every link was validated (tests/geometry.test.ts) not to intersect any
 * wall polyline.
 */
import type { ExitGroupId, Floor, GLink, GNode, GeometryData, LinkKind } from './types';
import { EXIT_GROUPS } from './types';

export interface LinkGeom {
  idx: number;
  id: string;
  a: number;
  b: number;
  /** walking length (slope length for stairs) */
  len: number;
  /** ratio polyline length / walking length (for mapping s to xy) */
  geomScale: number;
  width: number;
  kind: LinkKind;
  floor: Floor;
  lanes: number;
  gate: boolean;
  exterior: boolean;
  exitGroup: number; // index in EXIT_GROUPS or -1
  drop: number;
  accessible: boolean;
  oneWay: boolean;
  barrierSlot: boolean;
  prohibited: boolean;
  isStair: boolean;
  isRow: boolean;
  laneBarrier: boolean;
  /** outdoor stair (portico / monumental): affected by winter conditions */
  outdoorStair: boolean;
  /** storey-height stair (|drop| >= 2 m): evacuees only DESCEND it */
  storeyStair: boolean;
  label: string;
  xs: Float64Array;
  ys: Float64Array;
  cum: Float64Array;
  /** floors on which the link should be drawn */
  drawFloors: Floor[];
}

export interface AdjEntry {
  link: number;
  other: number;
  /** +1 if traversed a->b, -1 if b->a */
  dir: 1 | -1;
}

export const KIND_CODE: Record<LinkKind, number> = {
  row: 0,
  aisle: 1,
  crossAisle: 2,
  walkway: 3,
  corridor: 4,
  foyer: 5,
  door: 6,
  stair: 7,
  landing: 8,
  portico: 9,
  outdoor: 10,
  passage: 11,
};

export class NavGraph {
  readonly geo: GeometryData;
  readonly nodes: GNode[];
  readonly nodeIndex = new Map<string, number>();
  readonly links: LinkGeom[] = [];
  readonly linkIndex = new Map<string, number>();
  readonly adj: AdjEntry[][];
  /** reverse adjacency: radj[v] lists edges u->v as {link, other: u, dir: direction from u} */
  readonly radj: AdjEntry[][];
  /** safe destination node indices per exit group */
  readonly safeByGroup: number[][];
  readonly refugeNodes: number[];
  readonly nodeFloor: Floor[];

  constructor(geo: GeometryData, laneWidth = 0.6) {
    this.geo = geo;
    this.nodes = geo.nodes;
    geo.nodes.forEach((n, i) => this.nodeIndex.set(n.id, i));
    this.nodeFloor = geo.nodes.map((n) => n.floor);
    this.adj = geo.nodes.map(() => []);
    this.radj = geo.nodes.map(() => []);
    geo.links.forEach((l, i) => {
      const lg = this.makeLink(l, i, laneWidth);
      this.links.push(lg);
      this.linkIndex.set(l.id, i);
      if (lg.prohibited) return; // never part of the navigable graph
      this.adj[lg.a].push({ link: i, other: lg.b, dir: 1 });
      this.radj[lg.b].push({ link: i, other: lg.a, dir: 1 });
      if (!lg.oneWay) {
        this.adj[lg.b].push({ link: i, other: lg.a, dir: -1 });
        this.radj[lg.a].push({ link: i, other: lg.b, dir: -1 });
      }
    });
    this.safeByGroup = EXIT_GROUPS.map(() => []);
    this.refugeNodes = [];
    geo.nodes.forEach((n, i) => {
      if (n.kind === 'safe' && n.exitGroup) this.safeByGroup[EXIT_GROUPS.indexOf(n.exitGroup)].push(i);
      if (n.kind === 'refuge') this.refugeNodes.push(i);
    });
  }

  private makeLink(l: GLink, idx: number, laneWidth: number): LinkGeom {
    const a = this.nodeIndex.get(l.a);
    const b = this.nodeIndex.get(l.b);
    if (a === undefined || b === undefined) throw new Error(`link ${l.id} references unknown node`);
    const n = l.pts.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const cum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = l.pts[i][0];
      ys[i] = l.pts[i][1];
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    const geomLen = Math.max(cum[n - 1], 0.05);
    const drop = l.drop ?? 0;
    const isStair = l.kind === 'stair';
    const len = isStair ? Math.hypot(geomLen, drop) : geomLen;
    // lanes: a 1.1 m aisle carries two people abreast in a dense crowd, a 1.0 m walkway one
    const lanes = l.lanes ?? Math.max(1, Math.floor(l.width / laneWidth + 0.2));
    const fa = this.nodes[a].floor;
    const fb = this.nodes[b].floor;
    const drawFloors: Floor[] = [l.floor];
    if (isStair && fa !== fb) {
      for (const f of [fa, fb]) if (f !== 0 && !drawFloors.includes(f)) drawFloors.push(f);
    }
    if (l.floor === 0 && !drawFloors.includes(1)) drawFloors.push(1);
    return {
      idx,
      id: l.id,
      a,
      b,
      len,
      geomScale: geomLen / len,
      width: l.width,
      kind: l.kind,
      floor: l.floor,
      lanes,
      gate: !!l.gate,
      exterior: !!l.exterior,
      exitGroup: l.exitGroup ? EXIT_GROUPS.indexOf(l.exitGroup) : -1,
      drop,
      accessible: l.accessible !== false && !isStair,
      oneWay: !!l.oneWay || !!l.exterior, // nobody walks back into the building
      barrierSlot: !!l.barrierSlot,
      prohibited: !!l.prohibited,
      isStair,
      isRow: l.kind === 'row',
      laneBarrier: !!l.laneBarrier,
      outdoorStair: isStair && (l.id.startsWith('PST_') || l.id.startsWith('MS_')),
      storeyStair: isStair && Math.abs(drop) >= 2,
      label: l.label ?? l.id,
      xs,
      ys,
      cum,
      drawFloors: drawFloors.map((f) => (f === 0 ? 1 : f)) as Floor[],
    };
  }

  /**
   * Position at absolute distance s (walking length from node a) along link,
   * plus lateral offset `lat` (metres, positive = left of the a->b direction).
   * Writes into out[0..1]; returns the segment index used (for caching).
   */
  pointAt(li: number, s: number, lat: number, out: Float64Array | number[], hint = 0): number {
    const L = this.links[li];
    const g = Math.min(Math.max(s * L.geomScale, 0), L.cum[L.cum.length - 1]);
    const cum = L.cum;
    let i = Math.min(Math.max(hint, 1), cum.length - 1);
    while (i < cum.length - 1 && cum[i] < g) i++;
    while (i > 1 && cum[i - 1] > g) i--;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? (g - cum[i - 1]) / seg : 0;
    const dx = L.xs[i] - L.xs[i - 1];
    const dy = L.ys[i] - L.ys[i - 1];
    const inv = seg > 0 ? 1 / seg : 0;
    out[0] = L.xs[i - 1] + dx * t - dy * inv * lat;
    out[1] = L.ys[i - 1] + dy * t + dx * inv * lat;
    return i;
  }

  groupIndex(g: ExitGroupId): number {
    return EXIT_GROUPS.indexOf(g);
  }

  linkByIdOrThrow(id: string): number {
    const i = this.linkIndex.get(id);
    if (i === undefined) throw new Error(`unknown link ${id}`);
    return i;
  }

  /** true if traversing link li in direction dir climbs a storey-height stair */
  climbs(li: number, dir: 1 | -1): boolean {
    const L = this.links[li];
    return L.storeyStair && ((L.drop > 0 && dir === -1) || (L.drop < 0 && dir === 1));
  }

  /** Nominal traversal time (s) of a link in a given direction, at reference speed 1.2 m/s. */
  nominalCost(li: number, dir: 1 | -1, throughRow: boolean): number {
    const L = this.links[li];
    if (L.isRow) return (L.len / 0.45) * (throughRow ? 4 : 1) + (throughRow ? 10 : 0);
    if (L.isStair) {
      const goingDown = (L.drop > 0 && dir === 1) || (L.drop < 0 && dir === -1);
      return L.len / (goingDown ? 0.7 : 0.6);
    }
    return L.len / 1.2 + (L.gate ? 1 : 0);
  }
}

/** Binary min-heap keyed by float priority. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const K = this.keys;
    const V = this.vals;
    K.push(k);
    V.push(v);
    let i = K.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= K[i]) break;
      [K[p], K[i]] = [K[i], K[p]];
      [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const K = this.keys;
    const V = this.vals;
    const k = K[0];
    const v = V[0];
    const lk = K.pop()!;
    const lv = V.pop()!;
    if (K.length > 0) {
      K[0] = lk;
      V[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < K.length && K[l] < K[m]) m = l;
        if (r < K.length && K[r] < K[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]];
        [V[m], V[i]] = [V[i], V[m]];
        i = m;
      }
    }
    return [k, v];
  }
}

export interface Field {
  /** cost-to-go (s at reference speed) per node; Infinity if unreachable */
  dist: Float64Array;
  /** link to take from each node (adjacency entry index into adj[node]); -1 at targets/unreachable */
  next: Int32Array;
}

/**
 * Multi-source Dijkstra over the reversed graph: cost-to-go to any of `targets`.
 * `blocked(link)` excludes links (known closures, inaccessible stairs, ...).
 */
export function computeField(g: NavGraph, targets: number[], blocked: (li: number) => boolean): Field {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const next = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  for (const t of targets) {
    dist[t] = 0;
    heap.push(0, t);
  }
  while (heap.size > 0) {
    const [d, v] = heap.pop();
    if (d > dist[v]) continue;
    const radj = g.radj[v];
    for (let k = 0; k < radj.length; k++) {
      const e = radj[k];
      const u = e.other;
      if (blocked(e.link)) continue;
      if (g.climbs(e.link, e.dir)) continue; // nobody evacuates by climbing a storey
      const ku = g.nodes[u].kind;
      if (ku === 'safe' || ku === 'refuge') continue; // sinks are absorbing
      const nd = d + g.nominalCost(e.link, e.dir, true);
      if (nd < dist[u]) {
        dist[u] = nd;
        const au = g.adj[u];
        let idx = -1;
        for (let q = 0; q < au.length; q++)
          if (au[q].link === e.link && au[q].dir === e.dir) {
            idx = q;
            break;
          }
        next[u] = idx;
        heap.push(nd, u);
      }
    }
  }
  return { dist, next };
}
