/**
 * Model B: stochastic behavioural evacuation on the building network (no spatial collisions).
 *
 * One agent per occupant. The audience (seats, behaviour types, speeds, reaction-time draws,
 * familiarity, compliance uniforms, exit knowledge, groups, seated neighbourhoods) is produced
 * by the SAME function as Model A (createPopulation), so for a given seed both models simulate
 * exactly the same people. Model-specific randomness (route-choice Gumbel draws, hearing, info
 * sharing) uses separate seeded streams ('net-route', 'net-dyn', 'net-guidance').
 *
 * Discrete time step dt (default 0.25 s). Each step:
 *   1. pre-movement state machine (lognormal phases, social clock dc/dt = 1 + kappa*phi,
 *      awareness hazard lambda*phi, group waiting) - same rules and parameters as Model A
 *   2. information and guidance (Crowd Managers by voice radius, LED strips, blocked-exit
 *      announcements, word of mouth at nodes)
 *   3. route selection: multinomial logit over the known exit groups with Model A's weights,
 *      path cost = travel time + (w_queue / w_time) * visible queue delay
 *   4. edge service: every directed arc has a FIFO queue at its tail node and a token bucket
 *      (capacity c_a * g(u, pi) persons/s, burst 1) - the deterministic accumulator
 *   5. move agents into allowed arcs (token available and head-node storage not full)
 *   6. advance agents in transit (travel time = length / (v_i * stair factor))
 *   7. arrivals: crossing an exterior door = left the building
 *   8. statistics (once per simulated second)
 * Agents that cannot reach any exit are reported (TRAPPED), runs end at tMax, and a run with
 * no progress for 120 s is flagged as gridlock. Nothing loops forever.
 *
 * Dynamic behaviour and adaptive Crowd Managers (cfg.adaptive, docs/ADAPTIVE.md) use the same rules
 * as Model A where the network representation allows: beliefs / confidence / urgency / trust /
 * commitment / event-triggered review in the exit choice (events are checked for people waiting
 * in a queue, since a person in transit on an edge cannot turn), and the shared ManagerPolicy
 * (observation of arc queues, radio, coordinated instructions). Reach uses the network: same
 * floor, straight line <= R and the same room (graph without door edges) or a walking distance
 * through a door <= reachFactor x R. Density is measured on the same regions as Model A (edges are
 * mapped back to the geometry links they contain); individual exposure uses the density of the
 * edge the person is on (coarser than Model A's 2 m window).
 */
import type { GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { Agent } from '../simulation/Agent';
import { ST } from '../simulation/Agent';
import type { DensityResult, HeatItem } from '../simulation/DensityRegions';
import { DensityRecorder, buildRegions } from '../simulation/DensityRegions';
import type { ManagerState, ManagerSummary, PolicyEnv } from '../simulation/ManagerPolicy';
import { ManagerPolicy, newManager, plannedGroups, reassign, summarizeManagers, workloadIndex } from '../simulation/ManagerPolicy';
import type { GateStat, RunResult } from '../simulation/Metrics';
import { behaviourSummary, tailMetrics } from '../simulation/Metrics';
import { placementPosts } from '../simulation/Placements';
import type { SimConfig } from '../simulation/Params';
import { planExitIndex } from '../simulation/Plan';
import { OUTWARD_ONLY } from '../simulation/Routing';
import { createPopulation } from '../simulation/Population';
import { effectiveSpeedFactor } from '../simulation/QueueSystem';
import { RNG } from '../simulation/Random';
import type { BuildingNetwork } from './NetworkGraph';
import { networkFor } from './NetworkGraph';
import { closedEdges } from './StaticFlow';
import { seatExits } from './TimeExpanded';

export interface NetSimOptions {
  dt: number;
  /** seconds blocked by full storage after which an agent may enter anyway (prevents artificial deadlock) */
  storageRelief: number;
  /** density-dependent transit speed (Weidmann-type) on edges; off = constant free speed (matches Model C) */
  densitySpeed: boolean;
}

export const DEFAULT_NET_OPTIONS: NetSimOptions = { dt: 0.25, storageRelief: 30, densitySpeed: false };

/** movement phase of a network agent */
export const PH = { SEATED: 0, ROW: 1, QUEUE: 2, TRANSIT: 3, OUT: 4, STUCK: 5 } as const;

class Heap {
  k: number[] = [];
  v: number[] = [];
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
  topKey() {
    return this.k[0];
  }
}

interface NetCM extends ManagerState {
  lastCheck: number;
  /** walking distance (m) from the post to every network node */
  dist: Float64Array;
  /** edges in the observation area (local density) */
  obsEdges: number[];
}

export class NetAgent {
  phase: number = PH.SEATED;
  /** current node (queue / arrival), source while seated */
  node = -1;
  /** arc in transit or queued for */
  arc = -1;
  /** remaining transit / row-walk time (s) and the total (for interpolation) */
  remaining = 0;
  total = 0;
  /** planned arcs and position in the plan */
  path: number[] = [];
  pathPos = 0;
  exitGroup = -1;
  rowExitArc = -1;
  rowNode = -1;
  queueSince = 0;
  noRouteSince = -1;
  known: Uint8Array | null = null;
  tLeft = NaN;
  exitEdge = -1;
  waitTotal = 0;
  reroutes = 0;
  vEff = 1;
  lastArc = -1;
  /** re-plan at the next node (information received while walking) */
  pendingReplan = false;
  /** the pending re-plan comes from a new Crowd Manager instruction (adaptive: bypasses commitment) */
  pendingGuidance = false;
  /** density region the person is in (for boundary flows) and the seat's row-end node (cached) */
  region = -1;
  seatNode = -1;
  constructor(public readonly a: Agent) {}
}

export class NetworkSimulation {
  readonly net: BuildingNetwork;
  readonly cfg: SimConfig;
  readonly geo: GeometryData;
  readonly seed: number;
  readonly opt: NetSimOptions;
  readonly agents: Agent[];
  readonly groups: number[][];
  readonly na: NetAgent[];
  t = 0;
  steps = 0;
  finished = false;
  gridlock = false;
  readonly closed: Set<number>;
  readonly barrierEdges: Set<number>;
  readonly blockedEdges: Set<number>;
  /** per arc FIFO queue of agent ids (waiting at the arc's tail node) */
  readonly queues: number[][];
  readonly tokens: Float64Array;
  readonly passes: Int32Array;
  readonly passLog = new Map<number, number[]>();
  readonly queueMax: Int32Array;
  readonly waitSum: Float64Array;
  /** agents waiting at each node */
  readonly waiting: Int32Array;
  /** agents in transit on each arc */
  readonly transit: Int32Array;
  readonly rngRoute: RNG;
  readonly rngDyn: RNG;
  readonly rngGuide: RNG;
  private readonly visibleArcs: number[][];
  private readonly nearClosed: number[][];
  private readonly nearSigns: number[][];
  readonly cmTimes: NetCM[];
  /** acoustic space (room) of each network node: components without door / exterior edges */
  private readonly space: Int32Array;
  private readonly isDoorEdge: Uint8Array;
  readonly policy: ManagerPolicy | null = null;
  private heardBy: Int32Array = new Int32Array(0);
  private reachedEver: Uint8Array = new Uint8Array(0);
  private instructedEver: Uint8Array = new Uint8Array(0);
  private compliedEver: Uint8Array = new Uint8Array(0);
  private zoneIdx: Int32Array = new Int32Array(0);
  private zoneMask: Uint8Array[] = [];
  private routeCache = new Map<string, { walk: number; gates: number[] } | null>();
  /** per-second snapshot of positions (x, y, floor, node) used by reach and bookkeeping */
  private snap: Float64Array = new Float64Array(0);
  // density
  readonly densityRec: DensityRecorder;
  /** region segments of every edge along a -> b: [start s, end s, region] */
  private readonly segs: { s0: number; s1: number; r: number }[][];
  private readonly heatEdges: number[];
  private readonly heatIndex: Int32Array;
  private edgeDensity: Float64Array;
  private readonly heard: Int32Array;
  private readonly env: number;
  private lastProgress = 0;
  private leftCount = 0;
  private series = { leftBuilding: [] as number[], inside: [] as number[], safe: [] as number[], moving: [] as number[], queuing: [] as number[], notStarted: [] as number[] };
  private readonly groupReadyCount: Int32Array;
  private ledActive = false;
  private guideAcc = 0;
  private densityExposure = 0;
  private peakDensity = 0;
  private peakDensityWhere = '';
  private wall0 = Date.now();
  /** optional hook (tests): arc entries */
  traceHook: ((e: { agent: number; arc: number; t: number }) => void) | null = null;

  constructor(geo: GeometryData, cfg: SimConfig, seed: number, opt: Partial<NetSimOptions> = {}) {
    this.geo = geo;
    this.cfg = cfg;
    this.seed = seed;
    this.opt = { ...DEFAULT_NET_OPTIONS, ...opt };
    this.net = networkFor(geo, cfg);
    const net = this.net;
    const pop = createPopulation(geo, cfg, seed);
    this.agents = pop.agents;
    this.groups = pop.groups;
    this.na = this.agents.map((a) => new NetAgent(a));
    this.rngRoute = new RNG(seed, 'net-route');
    this.rngDyn = new RNG(seed, 'net-dyn');
    this.rngGuide = new RNG(seed, 'net-guidance');
    this.blockedEdges = new Set(net.edgesForLinks(cfg.blocked.links));
    this.barrierEdges = new Set(net.edgesForLinks(cfg.barriers));
    this.closed = closedEdges(net, cfg.blocked.links, cfg.barriers);
    const nA = net.arcs.length;
    this.queues = net.arcs.map(() => []);
    this.tokens = new Float64Array(nA).fill(1);
    this.passes = new Int32Array(nA);
    this.queueMax = new Int32Array(nA);
    this.waitSum = new Float64Array(nA);
    this.waiting = new Int32Array(net.nodes.length);
    this.transit = new Int32Array(nA);
    this.env = effectiveSpeedFactor(cfg);
    this.groupReadyCount = new Int32Array(this.groups.length);
    // perception sets per node
    const R = cfg.routing;
    this.visibleArcs = net.nodes.map((n) =>
      net.arcs.filter((A) => net.nodes[A.from].floor === n.floor && Math.hypot(net.nodes[A.from].x - n.x, net.nodes[A.from].y - n.y) <= R.visibilityRange).map((A) => A.idx),
    );
    const closedList = [...this.closed];
    this.nearClosed = net.nodes.map((n) =>
      closedList.filter((e) => {
        const E = net.edges[e];
        return [E.a, E.b].some((m) => net.nodes[m].floor === n.floor && Math.hypot(net.nodes[m].x - n.x, net.nodes[m].y - n.y) <= cfg.blocked.discoveryRange);
      }),
    );
    const signNodes: number[][] = EXIT_GROUPS.map(() => []);
    for (const E of net.edges) {
      if (E.exterior && E.exitGroup >= 0) signNodes[E.exitGroup].push(E.a);
      if (/^SD[WE]$/.test(E.id)) signNodes[E.id === 'SDW' ? 3 : 4].push(E.a);
      if (/^BND[WE]$/.test(E.id)) signNodes[E.id === 'BNDW' ? 5 : 6].push(E.a);
    }
    this.nearSigns = net.nodes.map((n) =>
      signNodes.map((arr, gi) => (arr.some((s) => net.nodes[s].floor === n.floor && Math.hypot(net.nodes[s].x - n.x, net.nodes[s].y - n.y) <= R.noticeRange) ? gi : -1)).filter((g) => g >= 0),
    );
    // Crowd Managers (same posts, count rule and activation distribution as Model A)
    const C = cfg.crowdManagers;
    const nCM = C.count < 0 ? Math.ceil(this.agents.length / 250) : C.count;
    const allPosts = geo.crowdManagerPosts;
    const order = C.posts && C.posts.length ? C.posts.map((id) => allPosts.find((p) => p.id === id)).filter((p): p is (typeof allPosts)[number] => !!p) : allPosts;
    const posts = order.filter((p) => !C.unavailable.includes(p.id));
    const act = allPosts.map(() => this.rngGuide.lognormalMedian(C.activationMedian, C.activationSigma));
    const custom = placementPosts(geo, C.placement);
    const chosen = custom
      ? custom.slice(0, nCM).map((p, i) => ({ p, t: act[i % act.length] }))
      : posts.slice(0, Math.min(nCM, posts.length)).map((p) => ({ p, t: act[allPosts.indexOf(p)] }));
    const doorLinks = new Set(geo.links.filter((L) => L.kind === 'door').map((L) => L.id));
    this.isDoorEdge = Uint8Array.from(net.edges, (E) => (E.kind === 'door' || E.exterior || E.links.some((id) => doorLinks.has(id)) ? 1 : 0));
    this.space = this.computeSpaces();
    const knows0 = cfg.blocked.links.length > 0 && cfg.blocked.knowledge === 'immediate';
    this.cmTimes = chosen.map(({ p, t }, i) => {
      const node = this.nearestNetNode(p.x, p.y, p.floor);
      const base = newManager(i, p, node, t, plannedGroups(p.zones, C.plan), knows0);
      base.group = this.space[node] * 4 + (p.floor === 2 ? 2 : 1);
      return Object.assign(base, { lastCheck: -Infinity, dist: this.walkFrom(node), obsEdges: [] as number[] });
    });
    this.heard = new Int32Array(this.agents.length).fill(-1);
    this.outwardOnly = Uint8Array.from(net.edges.map((E) => (OUTWARD_ONLY.test(E.id) ? 1 : 0)));
    // counterflow: the two directions of an edge share its capacity
    this.oppArc = new Int32Array(net.arcs.length).fill(-1);
    for (const A of net.arcs) {
      const o = net.arcs.find((B) => B.edge === A.edge && B.idx !== A.idx);
      if (o) this.oppArc[A.idx] = o.idx;
    }
    // responders entering against the flow (stress test)
    const resp = new Set(cfg.stress.responders?.links ?? []);
    this.responderArc = Uint8Array.from(net.arcs.map((A) => (resp.has(net.edges[A.edge].id) ? 1 : 0)));
    this.groupWaitSince = new Float64Array(this.groups.length).fill(NaN);
    // pre-assigned exits: same random stream and rule as Model A (identical assignments per seed)
    const PA = cfg.preassign;
    if (PA && PA.enabled) {
      const rng = new RNG(seed, 'preassign');
      for (const a of this.agents) {
        const uReach = rng.random();
        const uComply = rng.random();
        if (a.wheelchair || uReach >= PA.reachProb) continue;
        const gi = planExitIndex(PA.plan, geo, a.seat);
        a.knownExits |= 1 << gi;
        if (uComply < PA.complianceProb) a.assignGroup = gi;
      }
    }
    for (const n of this.na) {
      const a = n.a;
      n.node = net.sourceOfZone.get(geo.seats[a.seat].zone) ?? -1;
      n.vEff = a.v0;
      if (cfg.blocked.links.length && cfg.blocked.knowledge === 'immediate') for (const e of this.blockedEdges) this.learn(n, e);
    }
    // groups move at the pace of their slowest member (unless they agreed to meet outside)
    if (!cfg.population.groupMeetOutside)
      for (const g of this.groups) {
        const v = Math.min(...g.map((i) => this.agents[i].v0));
        for (const i of g) this.na[i].vEff = v;
      }
    // density regions: edges mapped back to geometry links
    const regions = buildRegions(geo, cfg);
    const geoLen = new Map(geo.links.map((L) => [L.id, L.pts.reduce((acc, pt, k) => (k ? acc + Math.hypot(pt[0] - L.pts[k - 1][0], pt[1] - L.pts[k - 1][1]) : 0), 0)]));
    this.segs = net.edges.map((E) => {
      if (E.kind === 'rowExit' || !E.links.length) return [];
      const lens = E.links.map((id) => geoLen.get(id) ?? 0);
      const tot = lens.reduce((a, b) => a + b, 0) || 1;
      const out: { s0: number; s1: number; r: number }[] = [];
      let acc = 0;
      E.links.forEach((id, k) => {
        const s0 = (acc / tot) * E.length;
        acc += lens[k];
        out.push({ s0, s1: (acc / tot) * E.length, r: regions.byLink.get(id) ?? -1 });
      });
      return out;
    });
    this.heatEdges = net.edges.filter((E) => E.kind !== 'rowExit' && E.kind !== 'outdoor' && E.pts.length >= 2).map((E) => E.idx);
    this.heatIndex = new Int32Array(net.edges.length).fill(-1);
    this.heatEdges.forEach((e, i) => (this.heatIndex[e] = i));
    this.edgeDensity = new Float64Array(net.edges.length);
    const heatItems: HeatItem[] | null = cfg.analysis?.keepSeries
      ? this.heatEdges.map((e) => {
          const E = net.edges[e];
          const segR = this.segs[e].length ? this.segs[e][Math.floor(this.segs[e].length / 2)].r : -1;
          return { id: E.id, floor: E.floor, pts: E.pts, area: Math.max(0.05, E.area), region: segR };
        })
      : null;
    this.densityRec = new DensityRecorder(regions, cfg, heatItems);
    this.setupManagers();
    this.record();
  }

  // ------------------------------------------------------------------ rooms, reach, managers
  private computeSpaces(): Int32Array {
    const net = this.net;
    const parent = Int32Array.from(net.nodes, (_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    for (const E of net.edges) {
      if (this.isDoorEdge[E.idx]) continue;
      const ra = find(E.a);
      const rb = find(E.b);
      if (ra !== rb) parent[ra] = rb;
    }
    return Int32Array.from(net.nodes, (_, i) => find(i));
  }

  /** walking distance (m) over the network from a node (row exits excluded) */
  private walkFrom(src: number): Float64Array {
    const net = this.net;
    const d = new Float64Array(net.nodes.length).fill(Infinity);
    d[src] = 0;
    const h = new Heap();
    h.push(0, src);
    while (h.size) {
      const k = h.topKey();
      const u = h.pop();
      if (k > d[u]) continue;
      for (const ai of net.out[u]) {
        const A = net.arcs[ai];
        const E = net.edges[A.edge];
        if (E.kind === 'rowExit') continue;
        const nd = k + E.length;
        if (nd < d[A.to]) {
          d[A.to] = nd;
          h.push(nd, A.to);
        }
      }
    }
    return d;
  }

  private setupManagers() {
    const net = this.net;
    const cfg = this.cfg;
    const A = cfg.adaptive;
    const R = A?.observeRange ?? 18;
    const f = A?.reachFactor ?? 1.4;
    for (const cm of this.cmTimes) {
      const fl = cm.floor === 2 ? 2 : 1;
      for (const E of net.edges) {
        if (E.kind === 'rowExit') continue;
        const N = net.nodes[E.a];
        if ((N.floor === 2 ? 2 : 1) !== fl || Math.hypot(N.x - cm.x, N.y - cm.y) > R) continue;
        const sameRoom = this.space[E.a] === this.space[cm.node] || this.space[E.b] === this.space[cm.node];
        if (!sameRoom && cm.dist[E.a] > f * R) continue;
        cm.obsEdges.push(E.idx);
        if (E.isGate) for (const ai of net.out[E.a]) if (net.arcs[ai].edge === E.idx) cm.obsGates.push(ai);
      }
    }
    const Rv = cfg.crowdManagers.radius;
    for (const a of this.cmTimes) a.peers = this.cmTimes.filter((b) => b !== a && b.group === a.group && Math.hypot(a.x - b.x, a.y - b.y) <= 2 * Rv).map((b) => b.idx);
    const nA = this.agents.length;
    const nCM = Math.max(1, this.cmTimes.length);
    this.reachedEver = new Uint8Array(nA * nCM);
    this.instructedEver = new Uint8Array(nA * nCM);
    this.compliedEver = new Uint8Array(nA * nCM);
    const zones = [...new Set(this.geo.seats.map((x) => x.zone))];
    this.zoneIdx = Int32Array.from(this.agents, (a) => zones.indexOf(this.geo.seats[a.seat].zone));
    this.zoneMask = this.cmTimes.map((cm) => Uint8Array.from(zones, (z) => (cm.zones.includes(z) ? 1 : 0)));
    this.snap = new Float64Array(nA * 4);
    if (A?.managers) {
      this.heardBy = new Int32Array(nA * nCM).fill(-1);
      const groupCap = EXIT_GROUPS.map((_, gi) => net.edges.reduce((acc, E) => acc + (E.exterior && E.exitGroup === gi ? E.capacity : 0), 0));
      const env: PolicyEnv = {
        queueAt: (ai) => this.queues[ai].length,
        capOf: (ai) => net.edges[net.arcs[ai].edge].capacity,
        closedGate: (ai) => this.closed.has(net.arcs[ai].edge),
        route: (node, gi, knows) => this.staffRoute(node, gi, knows),
        groupCap,
      };
      (this as { policy: ManagerPolicy | null }).policy = new ManagerPolicy(cfg, this.cmTimes, env, this.seed, 'net-cm-policy');
    }
  }

  /** staff route (walk at 1.2 m/s and gate arcs on it) from a node to exit group gi */
  private staffRoute(from: number, gi: number, knows: boolean): { walk: number; gates: number[] } | null {
    const key = `${from}|${gi}|${knows ? 1 : 0}`;
    if (this.routeCache.has(key)) return this.routeCache.get(key)!;
    const net = this.net;
    const nV = net.nodes.length;
    const dist = new Float64Array(nV).fill(Infinity);
    const prev = new Int32Array(nV).fill(-1);
    const h = new Heap();
    dist[from] = 0;
    h.push(0, from);
    while (h.size) {
      const d = h.topKey();
      const u = h.pop();
      if (d > dist[u]) continue;
      if (net.nodes[u].kind === 'sink') continue;
      for (const ai of net.out[u]) {
        const A = net.arcs[ai];
        const E = net.edges[A.edge];
        if (E.kind === 'rowExit' || (knows && this.closed.has(A.edge))) continue;
        const nd = d + E.length / 1.2;
        if (nd < dist[A.to]) {
          dist[A.to] = nd;
          prev[A.to] = ai;
          h.push(nd, A.to);
        }
      }
    }
    let best = Infinity;
    let node = -1;
    for (const sk of net.sinksByGroup[gi]) if (dist[sk] < best) {
      best = dist[sk];
      node = sk;
    }
    const out = node < 0 ? null : { walk: best, gates: this.pathTo(prev, node).filter((ai) => net.edges[net.arcs[ai].edge].isGate) };
    this.routeCache.set(key, out);
    return out;
  }

  private seatNodeOf(n: NetAgent): number {
    if (n.seatNode < 0) {
      const ex = seatExits(this.net, n.a.seat);
      n.seatNode = ex.length ? ex[0].node : 0;
    }
    return n.seatNode;
  }

  /** network node that represents where the person is (for rooms and walking distances) */
  private nodeOf(n: NetAgent): number {
    const net = this.net;
    switch (n.phase) {
      case PH.SEATED:
      case PH.ROW:
        return this.seatNodeOf(n);
      case PH.TRANSIT: {
        if (n.arc < 0) return n.node;
        const A = net.arcs[n.arc];
        if (net.edges[A.edge].kind === 'rowExit') return n.rowNode >= 0 ? n.rowNode : this.seatNodeOf(n);
        const f = n.total > 0 ? 1 - n.remaining / n.total : 1;
        return f < 0.5 ? A.from : A.to;
      }
      default:
        if (n.arc >= 0 && net.edges[net.arcs[n.arc].edge].kind === 'rowExit') return n.rowNode >= 0 ? n.rowNode : this.seatNodeOf(n);
        return n.node >= 0 ? n.node : this.seatNodeOf(n);
    }
  }

  /** once per second: position snapshot used by reach and bookkeeping */
  private takeSnapshot() {
    const S = this.snap;
    for (const n of this.na) {
      const i = n.a.id;
      if (n.phase === PH.OUT) {
        S[4 * i + 3] = -1;
        continue;
      }
      const [x, y, f] = this.position(n);
      S[4 * i] = x;
      S[4 * i + 1] = y;
      S[4 * i + 2] = f;
      S[4 * i + 3] = this.nodeOf(n);
    }
  }

  /** the building part of the reach rule: same room, or through a door within reachFactor x R on foot */
  private topoOk(cm: NetCM, i: number, R: number): boolean {
    const S = this.snap;
    const node = S[4 * i + 3];
    if (node < 0) return false;
    if (this.space[node] === this.space[cm.node]) return true;
    const N = this.net.nodes[node];
    const walk = cm.dist[node] + Math.hypot(S[4 * i] - N.x, S[4 * i + 1] - N.y);
    return walk <= (this.cfg.adaptive?.reachFactor ?? 1.4) * R;
  }

  private inVoiceRange(cm: NetCM, i: number, R: number): boolean {
    const S = this.snap;
    if (S[4 * i + 3] < 0) return false;
    if ((S[4 * i + 2] === 2 ? 2 : 1) !== (cm.floor === 2 ? 2 : 1)) return false;
    return Math.hypot(S[4 * i] - cm.x, S[4 * i + 1] - cm.y) <= R;
  }

  private readonly oppArc: Int32Array;
  /** edges used outward only (same rule as Model A) */
  private readonly outwardOnly: Uint8Array;
  private readonly responderArc: Uint8Array;
  private readonly groupWaitSince: Float64Array;
  /** redirections made by Crowd Manager queue rebalancing (diagnostics) */
  redirections = 0;

  private nearestNetNode(x: number, y: number, floor: number): number {
    const net = this.net;
    let best = 0;
    let bd = Infinity;
    for (const N of net.nodes) {
      if (N.kind !== 'junction' || (N.floor === 2 ? 2 : 1) !== (floor === 2 ? 2 : 1)) continue;
      const d = Math.hypot(N.x - x, N.y - y);
      if (d < bd) {
        bd = d;
        best = N.idx;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ knowledge
  private learn(n: NetAgent, edge: number): boolean {
    if (!n.known) n.known = new Uint8Array(this.net.edges.length);
    if (n.known[edge]) return false;
    n.known[edge] = 1;
    return true;
  }

  private knowsClosed(n: NetAgent, edge: number) {
    return !!n.known && n.known[edge] === 1;
  }

  // ------------------------------------------------------------------ routing
  private arcTime(n: NetAgent, arc: number): number {
    const E = this.net.edges[this.net.arcs[arc].edge];
    if (E.length <= 0) return 0;
    const v = n.vEff * this.env * (E.isStair ? n.a.stairRatio || this.cfg.population.stairRatio : 1);
    return E.length / Math.max(0.05, v);
  }

  /**
   * Forward Dijkstra from start nodes (with initial costs) over arcs the agent believes usable.
   * cost = travel + qw * visible queue delay. Returns per-node cost and predecessor arc.
   */
  private search(n: NetAgent, starts: { node: number; cost: number }[], noArc: number, viewNode: number) {
    const net = this.net;
    const nV = net.nodes.length;
    const dist = new Float64Array(nV).fill(Infinity);
    const prev = new Int32Array(nV).fill(-1);
    const w = this.cfg.routing.weights[n.a.type];
    const adaptive = !!this.cfg.adaptive?.agents;
    const infoLevel = adaptive ? this.cfg.adaptive.congestionInfo : 'local';
    const qw = infoLevel === 'none' ? 0 : w.queue / Math.max(0.1, w.time);
    const vis = viewNode >= 0 ? new Set(this.visibleArcs[viewNode]) : null;
    const allVis = infoLevel === 'global';
    // adaptive: walls block the view (same room or a door of that room), as in Model A
    const roomOk = (ai: number) => !adaptive || infoLevel !== 'local' || viewNode < 0 || this.space[this.net.arcs[ai].from] === this.space[viewNode] || this.space[this.net.arcs[ai].to] === this.space[viewNode];
    const od = adaptive ? new Float64Array(nV) : null;
    const og = adaptive ? new Int32Array(nV) : null;
    const oe = adaptive ? new Uint8Array(nV) : null;
    const boost = this.cfg.routing.narrowDoorBoost;
    const noReentry = this.cfg.routing.noReentry !== false;
    const h = new Heap();
    for (const s of starts) {
      if (s.cost < dist[s.node]) {
        dist[s.node] = s.cost;
        h.push(s.cost, s.node);
      }
    }
    while (h.size) {
      const d = h.topKey();
      const u = h.pop();
      if (d > dist[u]) continue;
      if (net.nodes[u].kind === 'sink') continue;
      for (const ai of net.out[u]) {
        if (ai === noArc) continue;
        const A = net.arcs[ai];
        const E = net.edges[A.edge];
        if (E.kind === 'rowExit') continue;
        if (this.knowsClosed(n, A.edge)) continue;
        if (n.a.wheelchair && !E.accessible) continue;
        if (noReentry && A.dir < 0 && this.outwardOnly[A.edge] && !n.a.separated) continue; // as in Model A
        let c = this.arcTime(n, ai);
        let delay = 0;
        let seen = 0;
        if (allVis || (vis && vis.has(ai) && roomOk(ai))) {
          const q = this.queues[ai].length;
          if (q > 0) {
            const cap = Math.max(0.05, E.capacity);
            const narrow = 1 + boost * Math.max(0, (2 - E.width) / 2);
            c += qw * (q / cap) * (E.isGate ? narrow : 1);
            delay = q / cap;
          }
          if (E.isGate && infoLevel !== 'none') seen = 1;
        }
        const nd = d + c;
        if (nd < dist[A.to]) {
          dist[A.to] = nd;
          prev[A.to] = ai;
          if (od && og && oe) {
            od[A.to] = od[u] + delay;
            og[A.to] = og[u] + seen;
            oe[A.to] = oe[u] | (seen && E.exterior ? 1 : 0);
          }
          h.push(nd, A.to);
        }
      }
    }
    return { dist, prev, od, og, oe };
  }

  private pathTo(prev: Int32Array, target: number): number[] {
    const out: number[] = [];
    let v = target;
    for (let guard = 0; guard < 10000 && prev[v] >= 0; guard++) {
      out.push(prev[v]);
      v = this.net.arcs[prev[v]].from;
    }
    return out.reverse();
  }

  /** share of nearby moving agents heading to each exit group (visible neighbours) */
  private socialGrid: Map<number, number[]> | null = null;
  private socialGridT = -1;
  private socialPos: Float64Array | null = null;
  /** moving agents bucketed in R x R cells, rebuilt every 0.5 s of simulated time */
  private buildSocialGrid() {
    const R = Math.max(1, this.cfg.routing.socialRadius);
    const grid = new Map<number, number[]>();
    const pos = this.socialPos ?? (this.socialPos = new Float64Array(this.na.length * 3));
    for (const m of this.na) {
      if (m.exitGroup < 0 || m.phase === PH.OUT || m.phase === PH.SEATED || m.phase === PH.STUCK) continue;
      const [x, y, f] = this.position(m);
      const i = m.a.id;
      pos[3 * i] = x;
      pos[3 * i + 1] = y;
      pos[3 * i + 2] = f;
      const key = ((Math.floor(x / R) + 500) * 1000 + Math.floor(y / R) + 500) * 4 + f;
      let arr = grid.get(key);
      if (!arr) grid.set(key, (arr = []));
      arr.push(i);
    }
    this.socialGrid = grid;
    this.socialGridT = this.t;
  }

  private socialShares(n: NetAgent): number[] {
    const out = new Array(EXIT_GROUPS.length).fill(0);
    let tot = 0;
    const R = Math.max(1, this.cfg.routing.socialRadius);
    if (!this.socialGrid || this.t - this.socialGridT >= 0.5) this.buildSocialGrid();
    const pos = this.socialPos!;
    const [x, y, f] = this.position(n);
    const cx = Math.floor(x / R);
    const cy = Math.floor(y / R);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = this.socialGrid!.get(((cx + dx + 500) * 1000 + cy + dy + 500) * 4 + f);
        if (!arr) continue;
        for (const i of arr) {
          const m = this.na[i];
          if (m === n || m.exitGroup < 0) continue;
          if (Math.abs(pos[3 * i] - x) > R || Math.abs(pos[3 * i + 1] - y) > R) continue;
          out[m.exitGroup]++;
          tot++;
        }
      }
    return tot ? out.map((v) => v / tot) : out;
  }

  /**
   * Exit choice (multinomial logit, Model A's weights) and path.
   * `fromSeat`: the agent is still at its seat (start = its row ends); otherwise at node n.node.
   */
  chooseExit(n: NetAgent, cause: 'start' | 'node' | 'info' | 'event' | 'guidance'): boolean {
    const net = this.net;
    const a = n.a;
    const AD = this.cfg.adaptive;
    const adaptive = !!AD?.agents;
    const prevGroup = n.exitGroup;
    const prevFirst = n.path[n.pathPos] ?? -1;
    let starts: { node: number; cost: number }[];
    let view: number;
    const fromSeat = n.phase === PH.SEATED || n.phase === PH.ROW;
    if (fromSeat) {
      const ex = seatExits(net, a.seat);
      starts = ex.map((e) => ({ node: e.node, cost: e.row / Math.max(0.05, this.cfg.movement.rowSpeed) + e.extra / Math.max(0.05, n.vEff) }));
      view = ex.length ? ex[0].node : -1;
    } else {
      starts = [{ node: n.node, cost: 0 }];
      view = n.node;
    }
    // routine re-plans never U-turn onto the edge just walked
    const lastEdge = n.lastArc >= 0 ? net.arcs[n.lastArc].edge : -1;
    const turnOk = cause === 'info' || (cause === 'event' && a.delaySince > 20);
    const uturn = !fromSeat && !turnOk && lastEdge >= 0 ? net.arcs.findIndex((A) => A.edge === lastEdge && A.from === n.node) : -1;
    let r = this.search(n, starts, uturn, view);
    const groupCost = (k: number, res: typeof r) => {
      let best = Infinity;
      let node = -1;
      for (const s of net.sinksByGroup[k]) if (res.dist[s] < best) {
        best = res.dist[s];
        node = s;
      }
      return { cost: best, node };
    };
    let costs = EXIT_GROUPS.map((_, k) => groupCost(k, r));
    if (uturn >= 0 && !costs.some((c) => Number.isFinite(c.cost))) {
      r = this.search(n, starts, -1, view);
      costs = EXIT_GROUPS.map((_, k) => groupCost(k, r));
    }
    let best = -1;
    if (a.wheelchair) {
      // as in Model A: accessible route to the main entrance (assistance point outside the foyer)
      if (Number.isFinite(costs[0].cost)) best = 0;
    } else if (
      a.group >= 0 &&
      !a.groupLeader &&
      !this.cfg.population.groupMeetOutside &&
      this.na[this.groups[a.group][0]].exitGroup >= 0 &&
      Number.isFinite(costs[this.na[this.groups[a.group][0]].exitGroup].cost)
    ) {
      best = this.na[this.groups[a.group][0]].exitGroup;
    } else {
      const w = this.cfg.routing.weights[a.type];
      const social = w.social > 0 ? this.socialShares(n) : new Array(EXIT_GROUPS.length).fill(0);
      // followers may learn an exit by seeing others head to it
      if (a.type === 'follower')
        social.forEach((s, k) => {
          if (s > 0.3 && !(a.knownExits & (1 << k)) && this.rngRoute.random() < this.cfg.routing.socialLearnProb) a.knownExits |= 1 << k;
        });
      let bestV = -Infinity;
      const ku = adaptive ? AD.urgencyEffect * a.urgency : 0;
      const expected = new Array(EXIT_GROUPS.length).fill(0);
      const conf: number[] = new Array(EXIT_GROUPS.length).fill(NaN);
      const util: number[] = new Array(EXIT_GROUPS.length).fill(-Infinity);
      for (let k = 0; k < EXIT_GROUPS.length; k++) {
        if (!(a.knownExits & (1 << k))) continue;
        let T = costs[k].cost;
        if (!Number.isFinite(T)) continue;
        let unc = 0;
        if (adaptive && r.od && r.og && r.oe) {
          // beliefs and confidence (same rule as Model A, Routing.ts)
          const tg = costs[k].node;
          const c0 = k === 0 || a.familiar ? 0.8 : 0.5;
          const obs = r.od[tg];
          if (AD.congestionInfo !== 'none' && r.oe[tg]) {
            a.belief[k] = obs;
            a.beliefT[k] = this.t;
            conf[k] = 1;
            expected[k] = obs;
          } else {
            const age = this.t - a.beliefT[k];
            const fresh = Number.isFinite(age) && AD.congestionInfo !== 'none' ? Math.exp(-Math.max(0, age) / AD.memoryTau) : 0;
            const remembered = fresh > 0 ? a.belief[k] * fresh : 0;
            T += Math.max(0, remembered - obs);
            conf[k] = Math.max(c0, fresh);
            expected[k] = Math.max(obs, remembered);
            if (AD.congestionInfo !== 'none' && r.og[tg] > 0 && obs > remembered) {
              a.belief[k] = obs;
              a.beliefT[k] = this.t;
            }
          }
          unc = -AD.uncertaintyWeight * (1 - conf[k]);
        }
        // guidance = share of adopted instructions (CM, LED, pre-assignment) pointing to k (as Model A)
        const nSrc = (a.cmGroup >= 0 ? 1 : 0) + (a.ledGroup >= 0 ? 1 : 0) + (a.assignGroup >= 0 ? 1 : 0);
        const G = nSrc ? ((a.cmGroup === k ? 1 : 0) + (a.ledGroup === k ? 1 : 0) + (a.assignGroup === k ? 1 : 0)) / nSrc : 0;
        const S = adaptive ? social[k] * a.socialSus : social[k];
        const gw = adaptive ? 0.75 + 0.5 * a.coop : 1;
        if (adaptive && k === a.prevExit && k !== prevGroup && this.t - a.prevSwitchT < 30) unc -= w.inertia;
        const u = -w.time * (1 + ku) * (T / 30) + w.familiarity * (1 - ku) * (k === 0 ? 1 : 0) + w.social * S + w.guidance * 3 * gw * G + w.inertia * (k === prevGroup ? 1 : 0) + unc;
        util[k] = u;
        const v = u + (this.cfg.routing.persistentTaste !== false && a.taste.length ? a.taste[k] : this.rngRoute.gumbel());
        if (v > bestV) {
          bestV = v;
          best = k;
        }
      }
      if (adaptive && best >= 0) {
        const commit = AD.minCommit * (1 - 0.5 * a.urgency);
        if (prevGroup >= 0 && best !== prevGroup && Number.isFinite(util[prevGroup]) && (cause === 'node' || cause === 'event') && this.t - a.lastSwitchT < commit) best = prevGroup;
        if (best !== prevGroup) a.lastSwitchT = this.t;
        a.lastDecisionT = this.t;
        a.expDelay = expected[best];
        a.delaySince = 0;
        a.confidence = conf.map((c) => (Number.isFinite(c) ? Math.round(c * 100) / 100 : NaN));
      }
    }
    if (best < 0) {
      n.exitGroup = -1;
      n.path = [];
      n.pathPos = 0;
      return false;
    }
    n.exitGroup = best;
    a.targetGroup = best;
    const target = costs[best].node;
    const p = this.pathTo(r.prev, target);
    if (fromSeat) {
      // choose the row end the path starts from
      const startNode = p.length ? net.arcs[p[0]].from : target;
      const src = n.node;
      n.rowNode = startNode;
      n.rowExitArc = net.out[src].find((ai) => net.arcs[ai].to === startNode) ?? -1;
    }
    n.path = p;
    n.pathPos = 0;
    const changed = (prevGroup >= 0 && prevGroup !== best) || (prevFirst >= 0 && (p[0] ?? -1) !== prevFirst && cause !== 'start');
    if (changed && cause !== 'start') {
      n.reroutes++;
      a.reroutes++;
    }
    if (prevGroup >= 0 && prevGroup !== best) {
      a.exitSwitches++;
      if (best === a.prevExit && this.t - a.prevSwitchT < 30) a.flipFlops++;
      a.prevExit = prevGroup;
      a.prevSwitchT = this.t;
    }
    return changed;
  }

  // ------------------------------------------------------------------ positions (visualisation, perception)
  /** [x, y, floor] of an agent */
  position(n: NetAgent): [number, number, number] {
    const net = this.net;
    const a = n.a;
    const seat = this.geo.seats[a.seat];
    const sf = seat.level === 'balcony' ? 2 : 1;
    switch (n.phase) {
      case PH.SEATED:
        return [seat.x, seat.y, sf];
      case PH.ROW: {
        const N = net.nodes[n.rowNode];
        const f = n.total > 0 ? 1 - n.remaining / n.total : 1;
        return [seat.x + (N.x - seat.x) * f, seat.y + (N.y - seat.y) * f, sf];
      }
      case PH.TRANSIT: {
        if (n.arc < 0) {
          const N = net.nodes[n.node];
          return [N.x, N.y, N.floor];
        }
        const A = net.arcs[n.arc];
        const E = net.edges[A.edge];
        const f = n.total > 0 ? 1 - n.remaining / n.total : 1;
        const s = (A.dir === 1 ? f : 1 - f) * E.length;
        const [x, y] = net.pointAt(E, s);
        const fl = E.isStair ? (f < 0.5 ? net.nodes[A.from].floor : net.nodes[A.to].floor) : E.floor;
        return [x, y, fl];
      }
      case PH.QUEUE:
      case PH.STUCK: {
        if (n.arc >= 0 && net.edges[net.arcs[n.arc].edge].kind === 'rowExit') {
          const N = net.nodes[n.rowNode];
          return [N.x, N.y, N.floor];
        }
        const N = net.nodes[n.node];
        return [N.x, N.y, N.floor];
      }
      default: {
        const E = n.exitEdge >= 0 ? net.edges[n.exitEdge] : null;
        if (E) {
          const N = net.nodes[E.b];
          return [N.x, N.y, N.floor];
        }
        return [seat.x, seat.y, sf];
      }
    }
  }

  // ------------------------------------------------------------------ pre-movement (same rules as Model A)
  private socialPhi(a: Agent): number {
    const nb = a.neighbours;
    if (!nb || nb.length === 0) return 0;
    let s = 0;
    for (let k = 0; k < nb.length; k++) {
      const st = this.agents[nb[k]].state;
      if (st >= ST.MOVING) s += 1;
      else if (st >= ST.PREPARING) s += 0.5;
    }
    return s / nb.length;
  }

  private makeAware(a: Agent) {
    if (a.state !== ST.UNAWARE) return;
    a.state = ST.AWARE;
    a.tAware = this.t;
    a.clock = 0;
  }

  private premovement(dt: number) {
    const P = this.cfg.premovement;
    for (const n of this.na) {
      const a = n.a;
      if (n.phase !== PH.SEATED) continue;
      const st = a.state;
      if (st > ST.WAITING) continue;
      const phi = st <= ST.AWARE ? this.socialPhi(a) : 0;
      if (st === ST.UNAWARE) {
        a.clock += dt * (1 + P.socialKappa * phi);
        if (a.clock >= a.tRecognition || (phi > 0 && this.rngDyn.random() < P.socialAwareRate * phi * dt)) this.makeAware(a);
      } else if (st === ST.AWARE) {
        if (a.hesitate > 0) {
          a.hesitate -= dt;
          continue;
        }
        a.clock += dt * (1 + P.socialKappa * phi);
        if (a.clock >= a.tResponse) {
          a.state = ST.PREPARING;
          a.clock = 0;
        }
      } else if (st === ST.PREPARING) {
        a.clock += dt;
        if (a.clock >= a.tPrepare) this.ready(n);
      }
    }
  }

  private ready(n: NetAgent) {
    const a = n.a;
    if (a.group >= 0 && !a.separated && !this.cfg.population.groupMeetOutside) {
      a.state = ST.WAITING;
      this.groupReadyCount[a.group]++;
      const members = this.groups[a.group];
      if (members.some((i) => this.na[i].phase !== PH.SEATED)) {
        // the group already gave up waiting: leave as soon as ready (as in Model A)
        this.depart(n);
        return;
      }
      if (Number.isNaN(this.groupWaitSince[a.group])) this.groupWaitSince[a.group] = this.t;
      if (this.groupReadyCount[a.group] < members.length) return;
      // everybody ready: leader first, then the others (they adopt the leader's exit)
      for (const i of members) this.depart(this.na[i]);
      this.groupWaitSince[a.group] = NaN;
      return;
    }
    this.depart(n);
  }

  /** ready group members give up waiting after groupWaitMax (as in Model A) */
  private groupTimeouts() {
    const lim = this.cfg.population.groupWaitMax ?? 90;
    for (let gid = 0; gid < this.groups.length; gid++) {
      const t0 = this.groupWaitSince[gid];
      if (Number.isNaN(t0) || this.t - t0 <= lim) continue;
      for (const i of this.groups[gid]) if (this.agents[i].state === ST.WAITING) this.depart(this.na[i]);
      this.groupWaitSince[gid] = NaN;
    }
  }

  private depart(n: NetAgent) {
    const a = n.a;
    if (n.phase !== PH.SEATED) return;
    a.state = ST.MOVING;
    a.tStartMove = this.t;
    this.ledPerceive(n);
    this.chooseExit(n, 'start');
    if (n.exitGroup < 0 || n.rowExitArc < 0) {
      // no known reachable exit from the seat
      if (a.wheelchair) {
        a.state = ST.TRAPPED;
        n.phase = PH.STUCK;
        return;
      }
      // follow the crowd: learn the foyer (always signed) and retry
      a.knownExits |= 1;
      this.chooseExit(n, 'start');
      if (n.exitGroup < 0 || n.rowExitArc < 0) {
        a.state = ST.TRAPPED;
        n.phase = PH.STUCK;
        return;
      }
    }
    const ex = seatExits(this.net, a.seat).find((e) => e.node === n.rowNode);
    const tRow = ex ? ex.row / Math.max(0.05, this.cfg.movement.rowSpeed) + ex.extra / Math.max(0.05, n.vEff * this.env) : 0;
    n.phase = PH.ROW;
    n.remaining = tRow;
    n.total = tRow;
  }

  // ------------------------------------------------------------------ guidance
  private recommend(n: NetAgent, knows: boolean, dynamic: boolean, plan: Record<string, string>, cm: (typeof this.cmTimes)[number] | null = null): number {
    let gi = planExitIndex(plan, this.geo, n.a.seat);
    if (cm && cm.redirect.has(gi)) gi = cm.redirect.get(gi)!;
    if (knows && dynamic && this.closed.size) {
      // staff know the true state: nearest open exit group if the planned one is cut off
      const starts = n.phase === PH.SEATED || n.phase === PH.ROW ? seatExits(this.net, n.a.seat).map((e) => ({ node: e.node, cost: e.row })) : [{ node: n.node, cost: 0 }];
      const tmp = new NetAgent(n.a);
      tmp.vEff = n.vEff;
      tmp.known = new Uint8Array(this.net.edges.length);
      for (const e of this.closed) tmp.known[e] = 1;
      const r = this.search(tmp, starts, -1, -1);
      const c = (k: number) => Math.min(...this.net.sinksByGroup[k].map((s) => r.dist[s]));
      if (!Number.isFinite(c(gi))) {
        let bc = Infinity;
        for (let k = 0; k < EXIT_GROUPS.length; k++)
          if (c(k) < bc) {
            bc = c(k);
            gi = k;
          }
      }
    }
    return gi;
  }

  private instruct(n: NetAgent, cm: (typeof this.cmTimes)[number]) {
    const a = n.a;
    const C = this.cfg.crowdManagers;
    const first = !a.instructedCM;
    a.instructedCM = true;
    if (a.state === ST.UNAWARE) this.makeAware(a);
    if (first && a.state === ST.AWARE) a.tResponse = a.clock + Math.max(0, a.tResponse - a.clock) * this.cfg.premovement.cmFactor;
    let info = false;
    if (cm.knowsBlocked) for (const e of this.blockedEdges) info = this.learn(n, e) || info;
    for (const e of this.barrierEdges) info = this.learn(n, e) || info;
    const gi = this.recommend(n, cm.knowsBlocked, C.dynamic, C.plan, cm);
    a.knownExits |= 1 << gi;
    this.countInstructed(n, cm);
    const R = C.radius * (this.cfg.environment.smoke > 0.5 ? 0.7 : 1);
    if (!this.topoOk(cm, a.id, R)) cm.throughWall++;
    const prevTarget = n.exitGroup;
    let complied = false;
    if (a.uCM < C.complianceProb) {
      const prev = a.cmGroup;
      a.cmGroup = gi;
      a.cmSource = cm.idx;
      a.cmTime = this.t;
      complied = true;
      if (a.ledGroup >= 0 && a.ledGroup !== gi && prev !== gi) a.hesitate += this.cfg.led.conflictDelay;
    }
    // as in Model A: only newly learned closures force an unconditional re-plan
    if (n.phase === PH.QUEUE && n.arc >= 0 && this.net.edges[this.net.arcs[n.arc].edge].kind !== 'rowExit') this.replanInQueue(n, info ? 'info' : 'node');
    else if (n.phase === PH.TRANSIT || n.phase === PH.ROW || n.phase === PH.QUEUE) n.pendingReplan = true;
    if (complied) this.countComplied(n, cm, prevTarget, gi);
  }

  /** adaptive instruction (same rules as Model A's GuidanceSystem.instructAdaptive) */
  private instructAdaptive(n: NetAgent, cm: NetCM) {
    const a = n.a;
    const C = this.cfg.crowdManagers;
    const A = this.cfg.adaptive;
    const t = this.t;
    const first = !a.instructedCM;
    a.instructedCM = true;
    if (a.state === ST.UNAWARE) this.makeAware(a);
    if (first && a.state === ST.AWARE) a.tResponse = a.clock + Math.max(0, a.tResponse - a.clock) * this.cfg.premovement.cmFactor;
    let info = false;
    if (cm.knowsBlocked) for (const e of this.blockedEdges) info = this.learn(n, e) || info;
    for (const e of this.barrierEdges) info = this.learn(n, e) || info;
    const gi = this.recommend(n, cm.knowsBlocked, C.dynamic, C.plan, cm);
    a.knownExits |= 1 << gi;
    a.urgency = Math.max(a.urgency, 0.5);
    this.countInstructed(n, cm);
    if (A.shareCongestion && A.congestionInfo !== 'none' && this.policy) {
      const gw = this.policy.groupWaits(cm);
      for (let g = 0; g < gw.length; g++) {
        if (!Number.isFinite(gw[g].w)) continue;
        if (!Number.isNaN(a.beliefT[g]) && a.beliefT[g] > gw[g].t) continue;
        a.belief[g] = gw[g].w;
        a.beliefT[g] = gw[g].t;
      }
    }
    if (a.cmGroup >= 0 && a.cmSource >= 0 && a.cmSource !== cm.idx) {
      if (a.cmGroup !== gi && t - a.cmTime < 60) {
        a.conflicts++;
        cm.conflicts++;
        this.cmTimes[a.cmSource].conflicts++;
        a.hesitate += A.conflictDelay;
        a.trust = Math.max(0.2, a.trust - 0.5 * A.trustLoss);
      } else if (a.cmGroup === gi) a.trust = Math.min(1.2, a.trust + A.trustGain);
    }
    const prevTarget = n.exitGroup;
    let complied = false;
    if (a.uCM < C.complianceProb * a.trust) {
      const prev = a.cmGroup;
      a.cmGroup = gi;
      a.cmSource = cm.idx;
      a.cmTime = t;
      complied = true;
      if (a.ledGroup >= 0 && a.ledGroup !== gi && prev !== gi) a.hesitate += this.cfg.led.conflictDelay;
    }
    if (n.phase === PH.QUEUE && n.arc >= 0 && this.net.edges[this.net.arcs[n.arc].edge].kind !== 'rowExit') this.replanInQueue(n, info ? 'info' : 'guidance');
    else if (n.phase === PH.TRANSIT || n.phase === PH.ROW || n.phase === PH.QUEUE) {
      n.pendingReplan = true;
      n.pendingGuidance = !info;
    }
    if (complied) this.countComplied(n, cm, prevTarget, gi);
  }

  private countInstructed(n: NetAgent, cm: NetCM) {
    const k = n.a.id * this.cmTimes.length + cm.idx;
    if (!this.instructedEver[k]) {
      this.instructedEver[k] = 1;
      cm.instructed++;
    }
  }

  private countComplied(n: NetAgent, cm: NetCM, prevTarget: number, gi: number) {
    const k = n.a.id * this.cmTimes.length + cm.idx;
    if (!this.compliedEver[k]) {
      this.compliedEver[k] = 1;
      cm.complied++;
    }
    if (prevTarget >= 0 && prevTarget !== gi && n.exitGroup === gi) cm.changed++;
  }

  private ledPerceive(n: NetAgent) {
    const a = n.a;
    const L = this.cfg.led;
    if (!L.enabled || !this.ledActive || a.ledSeen || a.wheelchair) return;
    a.ledSeen = true;
    const pSee = L.perceiveProb * (1 - 0.5 * Math.min(1, this.cfg.environment.smoke));
    if (a.uLEDsee >= pSee) return;
    let gi = planExitIndex(L.plan, this.geo, a.seat);
    if (L.dynamic && this.blockedEdges.size) {
      for (const e of this.blockedEdges) this.learn(n, e);
      gi = this.recommend(n, true, true, L.plan);
    }
    a.knownExits |= 1 << gi;
    if (a.uLED < L.complianceProb) {
      a.ledGroup = gi;
      if (a.cmGroup >= 0 && a.cmGroup !== gi) a.hesitate += L.conflictDelay;
    }
  }

  private guidance() {
    const t = this.t;
    const B = this.cfg.blocked;
    if (B.links.length && B.knowledge === 'announced' && t >= B.announceDelay)
      for (const cm of this.cmTimes)
        if (!cm.knowsBlocked) {
          cm.knowsBlocked = true;
          cm.version++;
        }
    const L = this.cfg.led;
    if (L.enabled && !this.ledActive && t >= L.activationTime) {
      this.ledActive = true;
      for (const n of this.na) if (n.phase === PH.ROW || n.phase === PH.QUEUE || n.phase === PH.TRANSIT) this.ledPerceive(n);
    }
    // voice instructions and word of mouth are evaluated once per simulated second (as in Model A)
    this.guideAcc += this.opt.dt;
    if (this.guideAcc < 1 - 1e-9) return;
    this.guideAcc = 0;
    if (this.groups.length) this.groupTimeouts();
    const C = this.cfg.crowdManagers;
    const pHear = 1 - Math.exp(-C.hearRate);
    const R = C.radius * (this.cfg.environment.smoke > 0.5 ? 0.7 : 1);
    const RB = C.rebalance;
    this.takeSnapshot();
    if (this.policy) this.adaptiveGuidance(t, R, pHear);
    for (const cm of this.cmTimes) {
      if (this.policy) break;
      if (t < cm.tActive) continue;
      if (RB && RB.enabled && t - cm.lastCheck >= RB.interval - 1e-9) {
        cm.lastCheck = t;
        this.rebalance(cm, RB.threshold);
      }
      for (const n of this.na) {
        if (n.phase === PH.OUT || n.phase === PH.STUCK) continue;
        if (this.heard[n.a.id] >= cm.version) continue;
        const [x, y, f] = this.position(n);
        if (f !== cm.floor || Math.hypot(x - cm.x, y - cm.y) > R) continue;
        if (this.rngGuide.random() > pHear) continue;
        this.heard[n.a.id] = cm.version;
        this.instruct(n, cm);
      }
    }
    this.recordManagers(t, R);
    // word of mouth: people waiting at the same node pass on blocked-exit knowledge
    if (this.blockedEdges.size) {
      const pShare = 1 - Math.exp(-this.cfg.routing.shareInfoRate);
      const byNode = new Map<number, NetAgent[]>();
      for (const n of this.na) if (n.phase === PH.QUEUE && n.node >= 0) {
        let arr = byNode.get(n.node);
        if (!arr) byNode.set(n.node, (arr = []));
        arr.push(n);
      }
      for (const [, arr] of byNode) {
        const informed = arr.filter((n) => [...this.blockedEdges].some((e) => this.knowsClosed(n, e)));
        if (!informed.length) continue;
        for (const n of arr) {
          if (informed.includes(n)) continue;
          if (this.rngDyn.random() > pShare) continue;
          let changed = false;
          for (const e of this.blockedEdges) if (informed.some((m) => this.knowsClosed(m, e))) changed = this.learn(n, e) || changed;
          if (changed) this.replanInQueue(n, 'info');
        }
      }
    }
  }

  private adaptiveGuidance(t: number, R: number, pHear: number) {
    const policy = this.policy!;
    policy.step(t);
    if (this.cfg.adaptive.reassign === 'whenClear' && reassign(this.cmTimes, t, (x, y) => (x as NetCM).dist[y.node], this.cfg.crowdManagers.plan)) {
      const zones = [...new Set(this.geo.seats.map((x) => x.zone))];
      this.zoneMask = this.cmTimes.map((cm) => Uint8Array.from(zones, (z) => (cm.zones.includes(z) ? 1 : 0)));
    }
    const nCM = this.cmTimes.length;
    for (const cm of this.cmTimes) {
      if (t < cm.tActive) continue;
      for (const n of this.na) {
        if (n.phase === PH.OUT || n.phase === PH.STUCK) continue;
        const i = n.a.id;
        if (!this.inVoiceRange(cm, i, R) || !this.topoOk(cm, i, R)) continue;
        if (!cm.knowsBlocked && this.blockedEdges.size && n.known && [...this.blockedEdges].some((e) => n.known![e] === 1) && this.rngGuide.random() < 0.5) {
          cm.knowsBlocked = true;
          cm.version++;
          cm.reviewNow = true;
        }
        const every = this.cfg.adaptive.hearEvery !== false;
        const k = i * nCM + cm.idx;
        if (every ? this.heardBy[k] >= cm.version : this.heard[i] >= cm.version) continue;
        if (this.rngGuide.random() > pHear) continue;
        if (every) this.heardBy[k] = cm.version;
        else this.heard[i] = cm.version;
        this.instructAdaptive(n, cm);
      }
    }
  }

  /** R / H / I / workload bookkeeping once per second (no random draws) */
  private recordManagers(t: number, R: number) {
    const nCM = this.cmTimes.length;
    if (!nCM) return;
    const plan = this.cfg.crowdManagers.plan;
    const Rc = new Int32Array(nCM);
    const Ic = new Int32Array(nCM);
    const planned = this.cmTimes.map(() => new Map<number, number>());
    for (const n of this.na) {
      if (n.phase === PH.OUT || n.phase === PH.STUCK) continue;
      const a = n.a;
      const z = this.zoneIdx[a.id];
      for (let m = 0; m < nCM; m++)
        if (z >= 0 && this.zoneMask[m][z]) {
          Rc[m]++;
          const p = planExitIndex(plan, this.geo, a.seat);
          planned[m].set(p, (planned[m].get(p) ?? 0) + 1);
        }
      if (a.cmSource >= 0 && a.cmGroup >= 0 && n.exitGroup === a.cmGroup) Ic[a.cmSource]++;
    }
    const crit = this.cfg.adaptive?.criticalWait ?? 30;
    const adaptive = !!this.policy;
    for (let m = 0; m < nCM; m++) {
      const cm = this.cmTimes[m];
      let H = 0;
      const reachP = new Map<number, number>();
      if (t >= cm.tActive)
        for (const n of this.na) {
          const i = n.a.id;
          if (n.phase === PH.OUT || n.phase === PH.STUCK || !this.inVoiceRange(cm, i, R)) continue;
          if (adaptive && !this.topoOk(cm, i, R)) continue;
          H++;
          const pp = planExitIndex(plan, this.geo, n.a.seat);
          reachP.set(pp, (reachP.get(pp) ?? 0) + 1);
          const k = i * nCM + m;
          if (!this.reachedEver[k]) {
            this.reachedEver[k] = 1;
            cm.uniqueReached++;
          }
        }
      let nCrit = 0;
      for (const ai of cm.obsGates) if (this.queues[ai].length / Math.max(0.05, this.net.edges[this.net.arcs[ai].edge].capacity) > crit) nCrit++;
      let dens = 0;
      for (const e of cm.obsEdges) if (this.edgeDensity[e] > dens) dens = this.edgeDensity[e];
      const W = t >= cm.tActive ? workloadIndex(H, nCrit, dens, this.cfg) : 0;
      if (W > 1) cm.overloadTime += 1;
      if (W > cm.maxW) cm.maxW = W;
      cm.plannedCount = planned[m];
      cm.plannedReach = reachP;
      const S = cm.series;
      S.t.push(t);
      S.R.push(Rc[m]);
      S.H.push(H);
      S.I.push(Ic[m]);
      S.reached.push(cm.uniqueReached);
      S.W.push(Math.round(W * 100) / 100);
      S.crit.push(nCrit);
      S.dens.push(Math.round(dens * 100) / 100);
    }
  }

  /**
   * Staff estimate (s) from node `from` to each exit group: walking time (1.2 m/s) along the shortest
   * open route + the longest current wait (queue / capacity) at an arc of that route (as Model A).
   */
  private staffEstimates(from: number): number[] {
    const net = this.net;
    const nV = net.nodes.length;
    const dist = new Float64Array(nV).fill(Infinity);
    const prev = new Int32Array(nV).fill(-1);
    const h = new Heap();
    dist[from] = 0;
    h.push(0, from);
    while (h.size) {
      const d = h.topKey();
      const u = h.pop();
      if (d > dist[u]) continue;
      if (net.nodes[u].kind === 'sink') continue;
      for (const ai of net.out[u]) {
        const A = net.arcs[ai];
        const E = net.edges[A.edge];
        if (E.kind === 'rowExit' || this.closed.has(A.edge)) continue;
        const nd = d + E.length / 1.2;
        if (nd < dist[A.to]) {
          dist[A.to] = nd;
          prev[A.to] = ai;
          h.push(nd, A.to);
        }
      }
    }
    return EXIT_GROUPS.map((_, k) => {
      let best = Infinity;
      let node = -1;
      for (const s of net.sinksByGroup[k]) if (dist[s] < best) {
        best = dist[s];
        node = s;
      }
      if (node < 0) return Infinity;
      let wait = 0;
      for (const ai of this.pathTo(prev, node)) {
        const E = net.edges[net.arcs[ai].edge];
        if (E.isGate) wait = Math.max(wait, this.queues[ai].length / Math.max(0.05, E.capacity));
      }
      return best + wait;
    });
  }

  private rebalance(cm: (typeof this.cmTimes)[number], threshold: number) {
    const plan = this.cfg.crowdManagers.plan;
    const planned = new Set<number>();
    for (const z of cm.zones) {
      for (const [k, v] of Object.entries(plan)) if (k === z || k.startsWith(z + ':')) planned.add(EXIT_GROUPS.indexOf(v as any));
      if (!(z in plan)) planned.add(0);
    }
    const est = this.staffEstimates(cm.node);
    let changed = false;
    for (const p of planned) {
      if (p < 0) continue;
      const cur = cm.redirect.has(p) ? cm.redirect.get(p)! : p;
      let best = cur;
      for (let k = 0; k < est.length; k++) if (est[k] < est[best]) best = k;
      if (best !== cur && est[cur] - est[best] > threshold) {
        if (best === p) cm.redirect.delete(p);
        else cm.redirect.set(p, best);
        changed = true;
      } else if (cur !== p && est[p] <= est[cur] + 0.5 * threshold) {
        cm.redirect.delete(p);
        changed = true;
      }
    }
    if (changed) {
      cm.version++;
      this.redirections++;
    }
  }

  // ------------------------------------------------------------------ movement
  private enqueue(n: NetAgent, arc: number) {
    n.phase = PH.QUEUE;
    n.arc = arc;
    n.noRouteSince = -1;
    n.queueSince = this.t;
    this.queues[arc].push(n.a.id);
    const A = this.net.arcs[arc];
    if (this.net.edges[A.edge].kind !== 'rowExit') this.waiting[A.from]++;
    n.a.state = ST.MOVING;
  }

  private dequeue(n: NetAgent) {
    const q = this.queues[n.arc];
    const i = q.indexOf(n.a.id);
    if (i >= 0) q.splice(i, 1);
    const A = this.net.arcs[n.arc];
    if (this.net.edges[A.edge].kind !== 'rowExit') this.waiting[A.from]--;
  }

  /**
   * A person with no known usable exit: follows what others around do, notices signs, and after
   * 10 s finds the nearest open exit (signage / asking staff) with probability 0.2 per second.
   */
  private lookForExits(n: NetAgent) {
    const a = n.a;
    const sh = this.socialShares(n);
    sh.forEach((s, k) => {
      if (s > 0) a.knownExits |= 1 << k;
    });
    if (n.node >= 0) for (const gi of this.nearSigns[n.node]) a.knownExits |= 1 << gi;
    if (this.t - n.noRouteSince > 10 && this.rngRoute.random() < 0.2) {
      const r = this.search(n, [{ node: n.node, cost: 0 }], -1, -1);
      let best = -1;
      let bc = Infinity;
      EXIT_GROUPS.forEach((_, k) => {
        for (const s of this.net.sinksByGroup[k])
          if (r.dist[s] < bc) {
            bc = r.dist[s];
            best = k;
          }
      });
      if (best >= 0) a.knownExits |= 1 << best;
    }
  }

  /** no known route: leave the queue and wait at the node (retries in routineReplans) */
  private becomeLost(n: NetAgent) {
    if (n.phase === PH.QUEUE && n.arc >= 0) this.dequeue(n);
    n.phase = PH.QUEUE;
    n.arc = -1;
    if (n.noRouteSince < 0) n.noRouteSince = this.t;
    n.a.state = ST.QUEUING;
  }

  /** re-plan while waiting at node n.node; moves the agent to another queue if the plan changes */
  private replanInQueue(n: NetAgent, cause: 'node' | 'info' | 'event' | 'guidance') {
    if (n.phase !== PH.QUEUE || n.arc < 0) return;
    const A = this.net.arcs[n.arc];
    if (this.net.edges[A.edge].kind === 'rowExit') return;
    const old = n.arc;
    this.chooseExit(n, cause);
    const next = n.path[0];
    if (next === undefined) {
      // keep waiting in the current queue unless it is known to be closed
      if (this.knowsClosed(n, A.edge)) this.becomeLost(n);
      else if (n.noRouteSince < 0) n.noRouteSince = this.t;
      return;
    }
    n.noRouteSince = -1;
    if (next !== old) {
      this.dequeue(n);
      this.enqueue(n, next);
      n.a.state = ST.REROUTING;
    }
  }

  /** arrival at node v via arc (or from a row) */
  private arrive(n: NetAgent, v: number, viaArc: number) {
    const net = this.net;
    const a = n.a;
    n.node = v;
    if (viaArc >= 0) {
      const E = net.edges[net.arcs[viaArc].edge];
      if (E.exterior) {
        this.densityRec.cross(n.region, -1);
        n.region = -1;
        n.phase = PH.OUT;
        n.tLeft = this.t;
        n.exitEdge = E.idx;
        a.tLeftBuilding = this.t;
        a.exitLink = -1;
        a.state = a.wheelchair ? ST.AWAITING_ASSIST : ST.OUTSIDE;
        this.leftCount++;
        this.lastProgress = this.t;
        return;
      }
    }
    if (net.nodes[v].kind === 'sink') {
      this.densityRec.cross(n.region, -1);
      n.region = -1;
      n.phase = PH.OUT;
      n.tLeft = this.t;
      a.tLeftBuilding = this.t;
      a.state = ST.OUTSIDE;
      this.leftCount++;
      return;
    }
    // discovery of closures and exit signs near this node
    let info = false;
    for (const e of this.nearClosed[v]) info = this.learn(n, e) || info;
    const pSign = this.cfg.routing.noticeProb * (this.cfg.environment.darkness ? 0.6 : 1) * (1 - 0.5 * Math.min(1, this.cfg.environment.smoke));
    for (const gi of this.nearSigns[v])
      if (!(a.knownExits & (1 << gi)) && this.rngDyn.random() < pSign) {
        a.knownExits |= 1 << gi;
        info = true;
      }
    n.pathPos++;
    let next = n.path[n.pathPos];
    const w = this.cfg.routing.weights[a.type];
    const planBroken = next === undefined || this.knowsClosed(n, net.arcs[next].edge);
    if (planBroken || info || n.pendingReplan || this.rngRoute.random() < w.reeval * 0.5) {
      const guided = n.pendingReplan && n.pendingGuidance;
      n.pendingReplan = false;
      n.pendingGuidance = false;
      this.chooseExit(n, planBroken || info ? 'info' : guided ? 'guidance' : 'node');
      next = n.path[0];
      n.pathPos = 0;
    }
    if (next === undefined) {
      // no known route: wait here and look again (reported TRAPPED after 30 s)
      n.phase = PH.QUEUE;
      n.arc = -1;
      if (n.noRouteSince < 0) n.noRouteSince = this.t;
      a.state = ST.QUEUING;
      return;
    }
    // path arcs are indexed from pathPos
    n.path = n.path.slice(n.pathPos);
    n.pathPos = 0;
    this.enqueue(n, next);
  }

  private serve(dt: number) {
    const net = this.net;
    const fis = this.cfg.movement.fasterIsSlower;
    const u = this.cfg.movement.urgency;
    const relief = this.opt.storageRelief;
    for (let ai = 0; ai < net.arcs.length; ai++) {
      const A = net.arcs[ai];
      const E = net.edges[A.edge];
      const q = this.queues[ai];
      if (this.closed.has(A.edge)) {
        // a person who reaches a closed edge discovers it
        for (const id of [...q]) {
          const n = this.na[id];
          if (this.learn(n, A.edge)) this.replanInQueue(n, 'info');
        }
        continue;
      }
      let cap = E.capacity;
      if (this.responderArc[ai] && this.t >= this.cfg.stress.responders.fromTime) cap *= this.cfg.stress.responders.capacityFactor;
      // counterflow: when both directions are in use they share the edge's capacity by demand
      const o = this.oppArc[ai];
      if (o >= 0 && E.kind !== 'rowExit') {
        const dOpp = this.queues[o].length + this.transit[o];
        if (dOpp > 0) {
          const dMe = q.length + this.transit[ai];
          cap *= dMe / Math.max(1, dMe + dOpp);
        }
      }
      if (E.isGate && fis.enabled) {
        let imp = 0;
        for (const id of q) imp += this.agents[id].impatience;
        const pi = q.length ? (u * imp) / q.length : 0;
        const x = Math.max(0, (pi - fis.threshold) / (1 - fis.threshold));
        cap *= (1 + fis.gain * u) * (1 - fis.drop * x * x);
      }
      this.tokens[ai] = Math.min(1, this.tokens[ai] + cap * dt);
      if (q.length > this.queueMax[ai]) this.queueMax[ai] = q.length;
      const headNode = A.to;
      const storageOk = (n: NetAgent) =>
        net.nodes[headNode].kind !== 'junction' || this.waiting[headNode] + this.transit[ai] < net.nodes[headNode].storage || this.t - n.queueSince > relief;
      while (q.length && this.tokens[ai] >= 1 - 1e-9) {
        const n = this.na[q[0]];
        if (!storageOk(n)) break;
        q.shift();
        if (E.kind !== 'rowExit') this.waiting[A.from]--;
        this.tokens[ai] -= 1;
        this.passes[ai]++;
        const sec = Math.floor(this.t + 1e-9);
        let log = this.passLog.get(ai);
        if (!log) this.passLog.set(ai, (log = []));
        while (log.length <= sec) log.push(0);
        log[sec]++;
        const waited = this.t - n.queueSince;
        n.waitTotal += waited;
        this.waitSum[ai] += waited;
        this.traceHook?.({ agent: n.a.id, arc: ai, t: this.t });
        let tt = this.arcTime(n, ai);
        if (this.opt.densitySpeed && E.area > 0) {
          const rho = (this.transit[ai] + 1) / E.area;
          tt /= Math.max(0.15, 1 - Math.exp(-1.913 * (1 / Math.max(rho, 0.01) - 1 / 5.4)));
        }
        n.arc = ai;
        n.phase = PH.TRANSIT;
        n.remaining = tt;
        n.total = tt;
        n.a.state = ST.MOVING;
        n.lastArc = ai;
        this.transit[ai]++;
        this.lastProgress = this.t;
        // density regions crossed along this edge (counted when the person starts along it)
        const sg = this.segs[A.edge];
        if (sg.length) {
          const order = A.dir === 1 ? sg : [...sg].reverse();
          for (const g of order) {
            if (g.r !== n.region) this.densityRec.cross(n.region, g.r);
            n.region = g.r;
          }
        }
      }
      for (const id of q) {
        const m = this.na[id];
        if (this.t - m.queueSince > 1.5) m.a.state = m.a.state === ST.REROUTING && this.t - m.queueSince < 3 ? ST.REROUTING : ST.QUEUING;
      }
    }
  }

  private advance(dt: number) {
    const net = this.net;
    for (const n of this.na) {
      if (n.phase === PH.ROW) {
        n.remaining -= dt;
        if (n.remaining <= 0) {
          n.remaining = 0;
          // reached the row end: queue for the row-exit capacity
          this.enqueue(n, n.rowExitArc);
        }
      } else if (n.phase === PH.TRANSIT) {
        n.remaining -= dt;
        if (n.remaining <= 0) {
          const ai = n.arc;
          this.transit[ai]--;
          const A = net.arcs[ai];
          n.arc = -1;
          if (net.edges[A.edge].kind === 'rowExit') {
            // the path starts at the row end
            n.node = A.to;
            n.pathPos = -1;
            this.arrive(n, A.to, -1);
          } else this.arrive(n, A.to, ai);
        }
      }
    }
  }

  private routineReplans(dt: number) {
    for (const n of this.na) {
      if (n.phase !== PH.QUEUE) continue;
      if (n.arc < 0) {
        // no route: retry; report as trapped after 30 s
        if (this.t - n.noRouteSince > 30) {
          n.phase = PH.STUCK;
          n.a.state = ST.TRAPPED;
          continue;
        }
        if (this.rngRoute.random() < dt) {
          this.lookForExits(n);
          this.chooseExit(n, 'info');
          if (n.path.length) {
            n.noRouteSince = -1;
            this.enqueue(n, n.path[0]);
          }
        }
        continue;
      }
      const E = this.net.edges[this.net.arcs[n.arc].edge];
      if (E.kind === 'rowExit') continue;
      const w = this.cfg.routing.weights[n.a.type];
      if (this.t - n.queueSince > 2 && this.rngRoute.random() < 0.05 * (0.3 + w.reeval) * dt) this.replanInQueue(n, 'node');
    }
  }

  /** region of a person right now (transit: position along the edge; waiting: end of the last edge) */
  private regionNow(n: NetAgent): number {
    if (n.phase === PH.OUT || n.phase === PH.SEATED || n.phase === PH.ROW) return -1;
    const net = this.net;
    if (n.phase === PH.TRANSIT && n.arc >= 0) {
      const A = net.arcs[n.arc];
      const sg = this.segs[A.edge];
      if (!sg.length) return -1;
      const E = net.edges[A.edge];
      const f = n.total > 0 ? 1 - n.remaining / n.total : 1;
      const sPos = (A.dir === 1 ? f : 1 - f) * E.length;
      for (const g of sg) if (sPos <= g.s1 + 1e-9) return g.r;
      return sg[sg.length - 1].r;
    }
    if (n.arc >= 0 && net.edges[net.arcs[n.arc].edge].kind === 'rowExit') return -1;
    return n.region;
  }

  /** heat-map edge of a person (transit: its edge; waiting: the edge it came along, else the one it waits for) */
  private edgeNow(n: NetAgent): number {
    const net = this.net;
    if (n.phase === PH.TRANSIT && n.arc >= 0) return net.arcs[n.arc].edge;
    if (n.phase === PH.QUEUE || n.phase === PH.STUCK) {
      if (n.arc >= 0 && net.edges[net.arcs[n.arc].edge].kind === 'rowExit') return -1;
      if (n.lastArc >= 0) return net.arcs[n.lastArc].edge;
      if (n.arc >= 0) return net.arcs[n.arc].edge;
    }
    return -1;
  }

  private sampleDensity() {
    const net = this.net;
    const nR = this.densityRec.nR;
    const occ = new Int32Array(nR);
    const spd = new Float64Array(nR);
    const que = new Int32Array(nR);
    const eOcc = new Float64Array(net.edges.length);
    for (const n of this.na) {
      if (n.phase === PH.OUT || n.phase === PH.SEATED) continue;
      const e = this.edgeNow(n);
      if (e >= 0) eOcc[e]++;
      const r = this.regionNow(n);
      if (r < 0) continue;
      occ[r]++;
      if (n.phase === PH.TRANSIT && n.arc >= 0 && n.total > 0) spd[r] += net.edges[net.arcs[n.arc].edge].length / n.total;
      if (n.phase === PH.QUEUE) que[r]++;
    }
    const ref = this.cfg.analysis?.densityRef ?? 2;
    for (let e = 0; e < net.edges.length; e++) this.edgeDensity[e] = net.edges[e].area > 0 ? eOcc[e] / net.edges[e].area : 0;
    // individual exposure with the density of the person's edge (1 s steps)
    for (const n of this.na) {
      const e = this.edgeNow(n);
      const d = e >= 0 && net.edges[e].length >= 1.5 ? this.edgeDensity[e] : 0;
      n.a.densityHere = d;
      if (d > ref) {
        n.a.exposure += d - ref;
        n.a.timeAboveRef += 1;
      }
    }
    const heat = this.cfg.analysis?.keepSeries ? this.heatEdges.map((e) => eOcc[e]) : null;
    this.densityRec.sample(this.t, occ, spd, que, heat);
  }

  /** dynamic behaviour once per second (same rules as Model A's perceive; events for people in queues) */
  private perceive() {
    const A = this.cfg.adaptive;
    const base = this.cfg.alarm?.mode === 'voice' ? 0.35 : 0.2;
    const k = 1 - Math.exp(-1 / 10);
    const net = this.net;
    for (const n of this.na) {
      const a = n.a;
      if (n.phase === PH.OUT || n.phase === PH.STUCK || a.state === ST.UNAWARE) continue;
      let blockedKnown = false;
      if (n.known) for (const e of this.blockedEdges) if (n.known[e]) blockedKnown = true;
      const target = Math.min(1, base + (a.instructedCM ? 0.2 : 0) + (blockedKnown ? 0.3 : 0) + 0.15 * Math.min(1, a.densityHere / 3) + 0.15 * Math.min(1, n.waitTotal / 60));
      a.urgency += (target - a.urgency) * k;
      if (n.phase !== PH.QUEUE || n.arc < 0 || a.wheelchair) continue;
      if (net.edges[net.arcs[n.arc].edge].kind === 'rowExit') continue;
      a.delaySince += 1;
      if (a.cmSource >= 0 && n.exitGroup === a.cmGroup && a.delaySince > Math.max(30, 2 * a.expDelay + 20) && a.cmTime <= a.lastDecisionT && a.trustHitT !== a.lastDecisionT) {
        a.trustHitT = a.lastDecisionT;
        a.trust = Math.max(0.2, a.trust - A.trustLoss);
      }
      if (this.t < a.nextEventT) continue;
      let fire = a.delaySince > Math.max(A.waitExcessMin, A.waitExcessFactor * a.expDelay);
      if (!fire && A.congestionInfo !== 'none') fire = this.visibleQueueOnPath(n) > a.expDelay + Math.max(A.queueSurpriseMin, 0.5 * a.expDelay);
      if (!fire) continue;
      a.events++;
      a.nextEventT = this.t + A.eventCooldown;
      this.replanInQueue(n, 'event');
    }
  }

  /** queue delay visible from the person's node on the rest of its path */
  private visibleQueueOnPath(n: NetAgent): number {
    if (n.node < 0) return 0;
    const vis = this.cfg.adaptive.congestionInfo === 'global' ? null : new Set(this.visibleArcs[n.node]);
    let c = 0;
    for (let i = n.pathPos; i < n.path.length; i++) {
      const ai = n.path[i];
      if (vis && !vis.has(ai)) continue;
      const A = this.net.arcs[ai];
      if (vis && this.space[A.from] !== this.space[n.node] && this.space[A.to] !== this.space[n.node]) continue;
      const q = this.queues[ai].length;
      if (q > 0) c += q / Math.max(0.05, this.net.edges[this.net.arcs[ai].edge].capacity);
    }
    return c;
  }

  densityResult(): DensityResult {
    return this.densityRec.finish(
      this.agents.map((a) => a.exposure),
      this.agents.map((a) => a.timeAboveRef),
      'Model B: density of the edge the person is on (persons on the edge / edge area), edges >= 1.5 m, every 1 s',
    );
  }

  managerSummaries(): ManagerSummary[] {
    return summarizeManagers(this.cmTimes, !!this.cfg.analysis?.keepSeries);
  }

  private record() {
    if (this.densityRec) this.sampleDensity();
    if (this.cfg.adaptive?.agents && this.t > 0) this.perceive();
    let inside = 0;
    let moving = 0;
    let queuing = 0;
    let notStarted = 0;
    for (const n of this.na) {
      if (n.phase === PH.OUT) continue;
      inside++;
      if (n.phase === PH.SEATED) notStarted++;
      else if (n.phase === PH.QUEUE) queuing++;
      else if (n.phase === PH.ROW || n.phase === PH.TRANSIT) moving++;
    }
    this.series.leftBuilding.push(this.leftCount);
    this.series.inside.push(inside);
    this.series.safe.push(this.na.filter((n) => n.phase === PH.OUT && !n.a.wheelchair).length);
    this.series.moving.push(moving);
    this.series.queuing.push(queuing);
    this.series.notStarted.push(notStarted);
    // node densities (holding area) as a crowding proxy
    const thr = this.cfg.movement.highDensityThreshold;
    for (const N of this.net.nodes) {
      if (N.kind !== 'junction') continue;
      const w = this.waiting[N.idx];
      if (!w) continue;
      const area = N.storage / this.net.rates.rhoMax;
      const d = w / Math.max(1, area);
      if (d > this.peakDensity) {
        this.peakDensity = d;
        this.peakDensityWhere = N.id;
      }
      if (d > thr) this.densityExposure += w;
    }
  }

  step() {
    if (this.finished) return;
    const dt = this.opt.dt;
    this.premovement(dt);
    this.guidance();
    this.routineReplans(dt);
    this.serve(dt);
    this.advance(dt);
    this.t += dt;
    this.steps++;
    if (Math.floor(this.t + 1e-9) > Math.floor(this.t - dt + 1e-9)) this.record();
    const active = this.na.some((n) => n.phase !== PH.OUT && n.phase !== PH.STUCK);
    if (!active) this.finished = true;
    else if (this.t >= this.cfg.tMax) this.finished = true;
    else if (this.t - this.lastProgress > 120 && this.na.every((n) => n.phase !== PH.SEATED && n.phase !== PH.ROW)) {
      this.gridlock = true;
      this.finished = true;
    }
    if (this.finished) this.record();
  }

  run(): RunResult {
    while (!this.finished) this.step();
    return this.result();
  }

  /** Model-agnostic run result (same structure as Model A, so all statistics are shared). */
  result(): RunResult {
    const net = this.net;
    const N = this.agents.length;
    const left = this.na.filter((n) => n.phase === PH.OUT);
    const allLeft = left.length === N;
    const amb = this.na.filter((n) => !n.a.wheelchair);
    const ambLeft = amb.every((n) => n.phase === PH.OUT);
    const exitTimes = left.map((n) => n.tLeft).sort((a, b) => a - b);
    const starts = this.agents.map((a) => a.tStartMove).filter(Number.isFinite).sort((a, b) => a - b);
    const q = (s: number[], p: number) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : NaN);
    const mean = (s: number[]) => (s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN);
    const exitGroupUsage = Object.fromEntries(EXIT_GROUPS.map((g) => [g, 0])) as Record<(typeof EXIT_GROUPS)[number], number>;
    const exitDoorUsage: Record<string, number> = {};
    for (const n of left) {
      if (n.exitEdge < 0) continue;
      const E = net.edges[n.exitEdge];
      if (E.exitGroup >= 0) exitGroupUsage[EXIT_GROUPS[E.exitGroup]]++;
      exitDoorUsage[E.label] = (exitDoorUsage[E.label] ?? 0) + 1;
    }
    const gates: GateStat[] = [];
    const byEdge = new Map<number, GateStat>();
    for (let ai = 0; ai < net.arcs.length; ai++) {
      const A = net.arcs[ai];
      const E = net.edges[A.edge];
      if (!E.feature) continue;
      let gs = byEdge.get(E.idx);
      if (!gs) {
        gs = { id: E.id, label: E.label, kind: E.kind, capacity: E.capacity * (E.isGate ? net.rates.urgencyMult : 1), passes: 0, maxQueue: 0, totalWait: 0, meanWait: 0, maxPassesPerSecond: 0 };
        byEdge.set(E.idx, gs);
        gates.push(gs);
      }
      gs.passes += this.passes[ai];
      gs.maxQueue = Math.max(gs.maxQueue, this.queueMax[ai]);
      gs.totalWait += this.waitSum[ai];
      const log = this.passLog.get(ai) ?? [];
      gs.maxPassesPerSecond = Math.max(gs.maxPassesPerSecond, ...log, 0);
    }
    for (const g of gates) g.meanWait = g.passes ? g.totalWait / g.passes : 0;
    gates.sort((a, b) => b.totalWait - a.totalWait);
    const used = Object.values(exitGroupUsage).filter((v) => v > 0);
    const imb = used.length ? Math.max(...used) / (used.reduce((a, b) => a + b, 0) / used.length) : NaN;
    const trapped = this.na.filter((n) => n.phase === PH.STUCK).length;
    const tEvac = allLeft ? exitTimes[exitTimes.length - 1] : NaN;
    const ambTimes = left.filter((n) => !n.a.wheelchair).map((n) => n.tLeft);
    return {
      seed: this.seed,
      label: this.cfg.label,
      scenarioId: this.cfg.scenarioId,
      N,
      completed: allLeft,
      allLeftBuilding: allLeft,
      gridlock: this.gridlock,
      tEvac,
      tEvacAmbulatory: ambLeft ? Math.max(0, ...ambTimes) : NaN,
      tSafe: NaN,
      tSafeAll: NaN,
      tEnd: this.t,
      meanExit: mean(exitTimes),
      medianExit: q(exitTimes, 0.5),
      p90Exit: q(exitTimes, 0.9),
      p95Exit: q(exitTimes, 0.95),
      p99Exit: q(exitTimes, 0.99),
      ...tailMetrics(this.geo, this.agents, this.series.inside, (a) => this.na[a.id].waitTotal),
      meanStart: mean(starts),
      medianStart: q(starts, 0.5),
      p95Start: q(starts, 0.95),
      series: this.series,
      exitGroupUsage,
      exitDoorUsage,
      gates,
      peakDensity: this.peakDensity,
      peakDensityWhere: this.peakDensityWhere,
      highDensityExposure: this.densityExposure,
      totalReroutes: this.na.reduce((s, n) => s + n.reroutes, 0),
      reroutedAgents: this.na.filter((n) => n.reroutes > 0).length,
      unresolved: {
        inside: N - left.length,
        awaitingAssistance: this.na.filter((n) => n.a.wheelchair && n.phase === PH.OUT).length,
        trapped,
        notSafe: N - left.length,
      },
      exitImbalance: imb,
      density: this.densityResult(),
      managers: this.managerSummaries(),
      behaviour: behaviourSummary(this.agents, (a) => (this.na[a.id].exitEdge >= 0 ? net.edges[this.na[a.id].exitEdge].exitGroup : -1), this.cmTimes.reduce((acc, c) => acc + c.history.filter((h) => h.planned >= 0).length, 0)),
      wallTimeMs: Date.now() - this.wall0,
    };
  }

  /** mean time (s) agents spent waiting in queues */
  meanQueueTime(): number {
    return this.na.reduce((s, n) => s + n.waitTotal, 0) / Math.max(1, this.na.length);
  }

  liveStats() {
    let notStarted = 0;
    let moving = 0;
    let queuing = 0;
    let trapped = 0;
    for (const n of this.na) {
      if (n.phase === PH.SEATED) notStarted++;
      else if (n.phase === PH.QUEUE) queuing++;
      else if (n.phase === PH.ROW || n.phase === PH.TRANSIT) moving++;
      else if (n.phase === PH.STUCK) trapped++;
    }
    let worst = -1;
    let wq = 0;
    for (let ai = 0; ai < this.net.arcs.length; ai++) if (this.queues[ai].length > wq) {
      wq = this.queues[ai].length;
      worst = ai;
    }
    return {
      t: this.t,
      left: this.leftCount,
      inside: this.na.length - this.leftCount,
      notStarted,
      moving,
      queuing,
      trapped,
      worstQueue: worst >= 0 ? `${this.net.edges[this.net.arcs[worst].edge].label} (${wq})` : '-',
    };
  }
}

export function runNetworkSimulation(geo: GeometryData, cfg: SimConfig, seed: number, opt: Partial<NetSimOptions> = {}): { result: RunResult; sim: NetworkSimulation } {
  const sim = new NetworkSimulation(geo, cfg, seed, opt);
  const result = sim.run();
  return { result, sim };
}
