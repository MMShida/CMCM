/**
 * Model B/C building network G = (V, E), derived AUTOMATICALLY from the detailed geometry
 * (src/data/geometry/bailey-hall.json) so both models share one topology.
 *
 * Construction (documented in docs/NETWORK_MODEL.md, section 2):
 *  1. Feature links keep their identity as network edges: every door, access point, stair,
 *     exterior door and corridor-barrier slot. Their id is the detailed link id (D3, OST_FW,
 *     FC2, P1, F4, BSF1W, ...), i.e. a stable physical feature id shared by both models.
 *  2. Seat rows are removed; seats become population supplies at source nodes (one per
 *     guidance zone). A zone's source connects to every network node where one of its rows
 *     ends, with capacity (#row ends) * J_row.
 *  3. All other walkable links (aisles, cross-aisles, walkways, corridor, foyer, portico) are
 *     contracted: maximal chains through degree-2 nodes become one edge (length = sum,
 *     capacity = min, storage = sum), and chains longer than `segmentMax` are subdivided so
 *     that the network keeps spatial resolution.
 *  4. The network ends at the exterior doors (the problem's definition of leaving the
 *     building): the downstream node of each exterior link is a sink.
 *
 * Every network node is a real detailed node (same id, same coordinates), and every network
 * edge stores the detailed links it represents and their polyline, so the mapping between the
 * two models is explicit (`detailedNodeMap`, `detailedLinkMap`).
 */
import type { LinkGeom, NavGraph } from '../geometry/NavigationGraph';
import type { ExitGroupId, Floor, GeometryData, LinkKind } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { SimConfig } from '../simulation/Params';
import { graphFor } from '../simulation/SimulationEngine';
import { gateSystemFor, linkCapacity, physicalRates } from '../shared/PhysicalModel';
import type { PhysicalRates } from '../shared/PhysicalModel';

export type NetNodeKind = 'junction' | 'source' | 'sink';

export interface NetNode {
  idx: number;
  /** detailed node id (or SRC:<zone> for population sources) */
  id: string;
  label: string;
  kind: NetNodeKind;
  x: number;
  y: number;
  floor: Floor;
  /** holding capacity (persons) = rho_max * (half the area of the incident edges); Infinity for sources and sinks */
  storage: number;
  /** sinks: exit group index; sources: -1 */
  exitGroup: number;
  zone?: string;
  /** physical region label used in reports (orchestra, loge/mezzanine, corridor, foyer, ...) */
  region: string;
}

export interface NetEdge {
  idx: number;
  /** stable physical feature id: the detailed link id for features, CH:<first>..<last> for contracted chains, SRC:<zone>@<node> for row exits */
  id: string;
  label: string;
  kind: LinkKind | 'chain' | 'rowExit';
  /** physical endpoints (network node indices) */
  a: number;
  b: number;
  /** traversal allowed a->b / b->a */
  fwd: boolean;
  bwd: boolean;
  /** walking length (m), slope length on stairs */
  length: number;
  /** minimum clear width (m) */
  width: number;
  /** flow capacity (persons/s) before the urgency multiplier */
  capacity: number;
  isStair: boolean;
  isGate: boolean;
  exterior: boolean;
  exitGroup: number;
  accessible: boolean;
  barrierSlot: boolean;
  /** area (m^2) of the represented walkable surface */
  area: number;
  /** detailed links represented by this edge (in a->b order) */
  links: string[];
  /** polyline from a to b (world metres) */
  pts: [number, number][];
  /** cumulative length along pts */
  cum: number[];
  floor: Floor;
  approx: boolean;
  /** feature edges are doors/stairs/access points/exterior doors/barrier slots */
  feature: boolean;
}

export interface Arc {
  /** directed arc index */
  idx: number;
  edge: number;
  from: number;
  to: number;
  /** +1: a->b, -1: b->a */
  dir: 1 | -1;
}

export interface RowEnd {
  /** network node the row end maps to */
  node: number;
  /** distance (m) from the detailed row-end node to that network node (along the contracted chain) */
  extra: number;
  /** detailed row-end node */
  detailedNode: string;
}

export interface NetworkOptions {
  /** maximum length (m) of a contracted chain before it is subdivided */
  segmentMax: number;
}

export const DEFAULT_NETWORK_OPTIONS: NetworkOptions = { segmentMax: 8 };

export class BuildingNetwork {
  readonly geo: GeometryData;
  readonly detailed: NavGraph;
  readonly rates: PhysicalRates;
  readonly nodes: NetNode[] = [];
  readonly edges: NetEdge[] = [];
  readonly arcs: Arc[] = [];
  /** outgoing arcs per node */
  readonly out: number[][] = [];
  /** incoming arcs per node */
  readonly inc: number[][] = [];
  readonly nodeIndex = new Map<string, number>();
  readonly edgeIndex = new Map<string, number>();
  /** detailed node id -> network node index, or the edge it was contracted into */
  readonly detailedNodeMap = new Map<string, { node: number } | { edge: number; s: number }>();
  /** detailed link id -> network edge index (contracted links share an edge) */
  readonly detailedLinkMap = new Map<string, number>();
  /** row link id -> usable row ends */
  readonly rowEnds = new Map<string, RowEnd[]>();
  /** zone id -> source node */
  readonly sourceOfZone = new Map<string, number>();
  readonly sinks: number[] = [];
  readonly sinksByGroup: number[][];
  readonly options: NetworkOptions;
  /** source (row-exit) edges */
  readonly sourceEdges: number[] = [];

  constructor(geo: GeometryData, cfg: SimConfig, options: Partial<NetworkOptions> = {}) {
    this.geo = geo;
    this.options = { ...DEFAULT_NETWORK_OPTIONS, ...options };
    const g = graphFor(geo, cfg.movement.laneWidth);
    this.detailed = g;
    this.rates = physicalRates(cfg);
    const gates = gateSystemFor(g, cfg);
    const r = this.rates;
    const capOf = (L: LinkGeom) => linkCapacity(L, gates, r);
    const isFeature = (L: LinkGeom) => L.gate || L.exterior || L.barrierSlot || L.isStair || L.kind === 'door';

    // ---- 0. inside region: everything reachable from the seats without crossing an exterior link
    const nN = g.nodes.length;
    const inside = new Uint8Array(nN);
    const usable = (L: LinkGeom) => !L.prohibited;
    {
      const st: number[] = [];
      for (const s of geo.seats) {
        const L = g.links[g.linkIndex.get(s.link)!];
        for (const n of [L.a, L.b]) if (!inside[n]) {
          inside[n] = 1;
          st.push(n);
        }
      }
      while (st.length) {
        const u = st.pop()!;
        for (const e of [...g.adj[u], ...g.radj[u]]) {
          const L = g.links[e.link];
          if (!usable(L) || L.exterior) continue;
          if (!inside[e.other]) {
            inside[e.other] = 1;
            st.push(e.other);
          }
        }
      }
    }
    // links belonging to the network: non-row, usable, with both ends inside, or exterior links leaving the inside
    const inNet = (L: LinkGeom) => usable(L) && !L.isRow && ((inside[L.a] && inside[L.b]) || (L.exterior && inside[L.a]));
    const sinkNode = new Uint8Array(nN);
    for (const L of g.links) if (inNet(L) && L.exterior) sinkNode[L.b] = 1;

    // undirected incidence over network links
    const inc: number[][] = g.nodes.map(() => []);
    for (const L of g.links) if (inNet(L)) {
      inc[L.a].push(L.idx);
      inc[L.b].push(L.idx);
    }
    const kept = new Uint8Array(nN);
    const rowEndNodes = new Set<number>();
    for (const L of g.links) if (L.isRow) for (const n of [L.a, L.b]) if (g.nodes[n].kind !== 'deadEnd') rowEndNodes.add(n);
    for (let n = 0; n < nN; n++) {
      if (!inside[n] && !sinkNode[n]) continue;
      if (inc[n].length === 0) continue;
      if (sinkNode[n] || inc[n].length !== 2 || inc[n].some((li) => isFeature(g.links[li]))) kept[n] = 1;
    }

    const other = (li: number, n: number) => (g.links[li].a === n ? g.links[li].b : g.links[li].a);
    const walkChains = () => {
      const chains: { nodes: number[]; links: number[] }[] = [];
      const seen = new Uint8Array(g.links.length);
      for (let u = 0; u < nN; u++) {
        if (!kept[u]) continue;
        for (const l0 of inc[u]) {
          if (seen[l0] || isFeature(g.links[l0])) continue;
          const nodes = [u];
          const links: number[] = [];
          let cur = u;
          let li = l0;
          for (let guard = 0; guard < 10000; guard++) {
            seen[li] = 1;
            links.push(li);
            const nx = other(li, cur);
            nodes.push(nx);
            cur = nx;
            if (kept[cur]) break;
            const nextL = inc[cur].find((x) => x !== li);
            if (nextL === undefined) break;
            li = nextL;
          }
          chains.push({ nodes, links });
        }
      }
      return chains;
    };
    // ---- subdivide long chains
    for (const ch of walkChains()) {
      const len = ch.links.reduce((s, li) => s + g.links[li].len, 0);
      const k = Math.ceil(len / this.options.segmentMax);
      if (k <= 1) continue;
      const cum: number[] = [0];
      for (const li of ch.links) cum.push(cum[cum.length - 1] + g.links[li].len);
      for (let j = 1; j < k; j++) {
        const target = (j * len) / k;
        let best = -1;
        let bd = Infinity;
        for (let i = 1; i < ch.nodes.length - 1; i++) {
          const d = Math.abs(cum[i] - target);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best > 0) kept[ch.nodes[best]] = 1;
      }
    }

    // ---- network nodes
    const regionOf = (id: string, floor: Floor): string => {
      if (floor === 2) return 'balcony';
      if (/^(AW|AE|FX|SPW|SPE|ORW|ORE|ORC)/.test(id)) return 'orchestra';
      if (/^(L[NSM][WE]|MR[WE]|MC|WK)/.test(id)) return 'loge/mezzanine';
      if (/^(C_|CN|BS[WE][0-2])/.test(id)) return 'corridor';
      if (/^(FC|FY|ELEV)/.test(id)) return 'foyer';
      if (/^(PO|PS)/.test(id)) return 'portico';
      if (/^(SE|BN|BST|VEST)/.test(id)) return 'stairs/escape';
      return 'other';
    };
    for (let n = 0; n < nN; n++) {
      if (!kept[n]) continue;
      const D = g.nodes[n];
      const idx = this.nodes.length;
      let eg = -1;
      if (sinkNode[n]) {
        const L = g.links.find((l) => inNet(l) && l.exterior && l.b === n)!;
        eg = L.exitGroup;
      }
      this.nodes.push({
        idx,
        id: D.id,
        label: D.label ?? D.id,
        kind: sinkNode[n] ? 'sink' : 'junction',
        x: D.x,
        y: D.y,
        floor: (D.floor === 0 ? 1 : D.floor) as Floor,
        storage: sinkNode[n] ? Infinity : 0,
        exitGroup: eg,
        region: sinkNode[n] ? 'outside' : regionOf(D.id, D.floor),
      });
      this.nodeIndex.set(D.id, idx);
      this.detailedNodeMap.set(D.id, { node: idx });
      if (sinkNode[n]) this.sinks.push(idx);
    }

    // ---- network edges (features + contracted chains)
    const polyOf = (li: number, fromNode: number): [number, number][] => {
      const L = g.links[li];
      const pts = Array.from(L.xs, (x, i) => [x, L.ys[i]] as [number, number]);
      return L.a === fromNode ? pts : pts.reverse();
    };
    const addEdge = (e: Omit<NetEdge, 'idx' | 'cum'>) => {
      const cum = [0];
      for (let i = 1; i < e.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]));
      const E: NetEdge = { ...e, idx: this.edges.length, cum };
      this.edges.push(E);
      this.edgeIndex.set(E.id, E.idx);
      return E;
    };
    for (const L of g.links) {
      if (!inNet(L) || !isFeature(L)) continue;
      const E = addEdge({
        id: L.id,
        // plan door numbers alone (e.g. "20001") are not informative: prefix the feature id
        label: L.label && /^\d+$/.test(L.label) ? `${L.id} (door ${L.label})` : L.label || L.id,
        kind: L.kind,
        a: this.nodeIndex.get(g.nodes[L.a].id)!,
        b: this.nodeIndex.get(g.nodes[L.b].id)!,
        fwd: !g.climbs(L.idx, 1),
        bwd: !L.oneWay && !g.climbs(L.idx, -1),
        length: L.len,
        width: L.width,
        capacity: capOf(L),
        isStair: L.isStair,
        isGate: L.gate,
        exterior: L.exterior,
        exitGroup: L.exitGroup,
        accessible: L.accessible,
        barrierSlot: L.barrierSlot,
        area: L.len * L.width,
        links: [L.id],
        pts: polyOf(L.idx, L.a),
        floor: (L.floor === 0 ? 1 : L.floor) as Floor,
        approx: !!geo.links[L.idx].approx,
        feature: true,
      });
      this.detailedLinkMap.set(L.id, E.idx);
    }
    for (const ch of walkChains()) {
      const Ls = ch.links.map((li) => g.links[li]);
      const u = ch.nodes[0];
      const v = ch.nodes[ch.nodes.length - 1];
      if (!kept[v]) continue; // dangling dead end (no row attached): irrelevant for egress
      let fwd = true;
      let bwd = true;
      ch.links.forEach((li, k) => {
        const L = g.links[li];
        const along = L.a === ch.nodes[k]; // traversed a->b when moving u->v
        if (L.oneWay) {
          if (!along) fwd = false;
          else bwd = false;
        }
      });
      const pts: [number, number][] = [];
      ch.links.forEach((li, k) => {
        const p = polyOf(li, ch.nodes[k]);
        if (k > 0) p.shift();
        pts.push(...p);
      });
      const first = Ls[0].id;
      const last = Ls[Ls.length - 1].id;
      const E = addEdge({
        id: Ls.length === 1 ? `CH:${first}` : `CH:${first}..${last}`,
        label: Ls.length === 1 ? first : `${first}..${last}`,
        kind: Ls.length === 1 ? Ls[0].kind : 'chain',
        a: this.nodeIndex.get(g.nodes[u].id)!,
        b: this.nodeIndex.get(g.nodes[v].id)!,
        fwd,
        bwd,
        length: Ls.reduce((s, L) => s + L.len, 0),
        width: Math.min(...Ls.map((L) => L.width)),
        capacity: Math.min(...Ls.map(capOf)),
        isStair: false,
        isGate: false,
        exterior: false,
        exitGroup: -1,
        accessible: Ls.every((L) => L.accessible),
        barrierSlot: false,
        area: Ls.reduce((s, L) => s + L.len * L.width, 0),
        links: Ls.map((L) => L.id),
        pts,
        floor: (Ls[0].floor === 0 ? 1 : Ls[0].floor) as Floor,
        approx: Ls.some((L) => !!geo.links[L.idx].approx),
        feature: false,
      });
      let s = 0;
      ch.links.forEach((li, k) => {
        this.detailedLinkMap.set(g.links[li].id, E.idx);
        if (k > 0) this.detailedNodeMap.set(g.nodes[ch.nodes[k]].id, { edge: E.idx, s });
        s += g.links[li].len;
      });
    }

    // ---- node storage: rho_max * half the area of every incident edge (min 2 persons)
    const area = new Float64Array(this.nodes.length);
    for (const E of this.edges) {
      area[E.a] += E.area / 2;
      area[E.b] += E.area / 2;
    }
    for (const N of this.nodes) if (N.kind === 'junction') N.storage = Math.max(2, Math.floor(r.rhoMax * area[N.idx]));

    // ---- row ends and sources
    for (const L of g.links) {
      if (!L.isRow) continue;
      const ends: RowEnd[] = [];
      for (const n of [L.a, L.b]) {
        if (g.nodes[n].kind === 'deadEnd') continue;
        const id = g.nodes[n].id;
        const m = this.detailedNodeMap.get(id);
        if (!m) continue;
        if ('node' in m) ends.push({ node: m.node, extra: 0, detailedNode: id });
        else {
          const E = this.edges[m.edge];
          const toA = m.s;
          const toB = E.length - m.s;
          // the nearer endpoint the person can actually walk to
          const useA = (toA <= toB && E.bwd) || !E.fwd;
          ends.push({ node: useA ? E.a : E.b, extra: useA ? toA : toB, detailedNode: id });
        }
      }
      this.rowEnds.set(L.id, ends);
    }
    const zoneRowEnds = new Map<string, Map<number, number>>();
    const rowsSeen = new Set<string>();
    for (const s of geo.seats) {
      if (rowsSeen.has(`${s.zone}|${s.link}`)) continue;
      rowsSeen.add(`${s.zone}|${s.link}`);
      let m = zoneRowEnds.get(s.zone);
      if (!m) zoneRowEnds.set(s.zone, (m = new Map()));
      for (const e of this.rowEnds.get(s.link) ?? []) m.set(e.node, (m.get(e.node) ?? 0) + 1);
    }
    for (const z of geo.zones) {
      const m = zoneRowEnds.get(z.id);
      if (!m) continue;
      const seats = geo.seats.filter((s) => s.zone === z.id);
      const cx = seats.reduce((a, s) => a + s.x, 0) / seats.length;
      const cy = seats.reduce((a, s) => a + s.y, 0) / seats.length;
      const idx = this.nodes.length;
      this.nodes.push({
        idx,
        id: `SRC:${z.id}`,
        label: z.label,
        kind: 'source',
        x: cx,
        y: cy,
        floor: z.level === 'balcony' ? 2 : 1,
        storage: Infinity,
        exitGroup: -1,
        zone: z.id,
        region: z.level === 'balcony' ? 'balcony' : z.level === 'orchestra' ? 'orchestra' : 'loge/mezzanine',
      });
      this.nodeIndex.set(`SRC:${z.id}`, idx);
      this.sourceOfZone.set(z.id, idx);
      for (const [node, count] of m) {
        const N = this.nodes[node];
        const E = addEdge({
          id: `SRC:${z.id}@${N.id}`,
          label: `${z.id} rows -> ${N.id}`,
          kind: 'rowExit',
          a: idx,
          b: node,
          fwd: true,
          bwd: false,
          length: 0,
          width: 0.45,
          capacity: count * r.rowEnd,
          isStair: false,
          isGate: false,
          exterior: false,
          exitGroup: -1,
          accessible: true,
          barrierSlot: false,
          area: 0,
          links: [],
          pts: [
            [cx, cy],
            [N.x, N.y],
          ],
          floor: N.floor,
          approx: false,
          feature: false,
        });
        this.sourceEdges.push(E.idx);
      }
    }

    // ---- directed arcs
    for (let i = 0; i < this.nodes.length; i++) {
      this.out.push([]);
      this.inc.push([]);
    }
    for (const E of this.edges) {
      const add = (from: number, to: number, dir: 1 | -1) => {
        const A: Arc = { idx: this.arcs.length, edge: E.idx, from, to, dir };
        this.arcs.push(A);
        this.out[from].push(A.idx);
        this.inc[to].push(A.idx);
      };
      // nothing leaves a sink (the network ends at the exterior doors)
      if (E.fwd && this.nodes[E.a].kind !== 'sink') add(E.a, E.b, 1);
      if (E.bwd && this.nodes[E.b].kind !== 'sink') add(E.b, E.a, -1);
    }
    this.sinksByGroup = EXIT_GROUPS.map((_, k) => this.sinks.filter((s) => this.nodes[s].exitGroup === k));
  }

  edgeById(id: string): NetEdge {
    const i = this.edgeIndex.get(id);
    if (i === undefined) throw new Error(`unknown network edge ${id}`);
    return this.edges[i];
  }

  /** network edges that represent any of the given detailed link ids (blocked exits, barriers) */
  edgesForLinks(ids: string[]): number[] {
    const out = new Set<number>();
    for (const id of ids) {
      const e = this.detailedLinkMap.get(id);
      if (e !== undefined) out.add(e);
    }
    return [...out];
  }

  /** point at distance s along edge E (from a) */
  pointAt(E: NetEdge, s: number): [number, number] {
    const pts = E.pts;
    const total = E.cum[E.cum.length - 1];
    if (total <= 1e-9) return pts[0];
    const d = Math.max(0, Math.min(total, s * (total / Math.max(1e-9, E.length || total))));
    let i = 1;
    while (i < E.cum.length - 1 && E.cum[i] < d) i++;
    const t = (d - E.cum[i - 1]) / Math.max(1e-9, E.cum[i] - E.cum[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }

  stats() {
    const junctions = this.nodes.filter((n) => n.kind === 'junction').length;
    return {
      nodes: this.nodes.length,
      junctions,
      sources: this.sourceOfZone.size,
      sinks: this.sinks.length,
      edges: this.edges.length,
      featureEdges: this.edges.filter((e) => e.feature).length,
      chainEdges: this.edges.filter((e) => !e.feature && e.kind !== 'rowExit').length,
      rowExitEdges: this.sourceEdges.length,
      arcs: this.arcs.length,
    };
  }
}

const cache = new WeakMap<GeometryData, Map<string, BuildingNetwork>>();
/** cached network for a geometry + the physical parameters it depends on */
export function networkFor(geo: GeometryData, cfg: SimConfig, options: Partial<NetworkOptions> = {}): BuildingNetwork {
  const key = JSON.stringify([cfg.movement, cfg.population.speedMean, cfg.population.stairRatio, cfg.population.radiusMean, cfg.population.luggageFlowFactor, cfg.environment, options]);
  let m = cache.get(geo);
  if (!m) cache.set(geo, (m = new Map()));
  let n = m.get(key);
  if (!n) {
    n = new BuildingNetwork(geo, cfg, options);
    m.set(key, n);
  }
  return n;
}

export function exitGroupName(k: number): ExitGroupId | '' {
  return k >= 0 ? EXIT_GROUPS[k] : '';
}
