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
 */
import type { GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { Agent } from '../simulation/Agent';
import { ST } from '../simulation/Agent';
import type { GateStat, RunResult } from '../simulation/Metrics';
import type { SimConfig } from '../simulation/Params';
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
  private readonly cmTimes: { x: number; y: number; floor: number; t: number; id: string; knows: boolean; version: number }[];
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
    const posts = geo.crowdManagerPosts.filter((p) => !C.unavailable.includes(p.id));
    const act = geo.crowdManagerPosts.map(() => this.rngGuide.lognormalMedian(C.activationMedian, C.activationSigma));
    this.cmTimes = posts.slice(0, Math.min(nCM, posts.length)).map((p) => ({
      x: p.x,
      y: p.y,
      floor: p.floor,
      t: act[geo.crowdManagerPosts.indexOf(p)],
      id: p.id,
      knows: cfg.blocked.links.length > 0 && cfg.blocked.knowledge === 'immediate',
      version: 0,
    }));
    this.heard = new Int32Array(this.agents.length).fill(-1);
    for (const n of this.na) {
      const a = n.a;
      n.node = net.sourceOfZone.get(geo.seats[a.seat].zone) ?? -1;
      n.vEff = a.v0;
      if (cfg.blocked.links.length && cfg.blocked.knowledge === 'immediate') for (const e of this.blockedEdges) this.learn(n, e);
    }
    // groups move at the pace of their slowest member
    for (const g of this.groups) {
      const v = Math.min(...g.map((i) => this.agents[i].v0));
      for (const i of g) this.na[i].vEff = v;
    }
    this.record();
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
    const qw = w.queue / Math.max(0.1, w.time);
    const vis = viewNode >= 0 ? new Set(this.visibleArcs[viewNode]) : null;
    const boost = this.cfg.routing.narrowDoorBoost;
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
        let c = this.arcTime(n, ai);
        if (vis && vis.has(ai)) {
          const q = this.queues[ai].length;
          if (q > 0) {
            const cap = Math.max(0.05, E.capacity);
            const narrow = 1 + boost * Math.max(0, (2 - E.width) / 2);
            c += qw * (q / cap) * (E.isGate ? narrow : 1);
          }
        }
        const nd = d + c;
        if (nd < dist[A.to]) {
          dist[A.to] = nd;
          prev[A.to] = ai;
          h.push(nd, A.to);
        }
      }
    }
    return { dist, prev };
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
  chooseExit(n: NetAgent, cause: 'start' | 'node' | 'info'): boolean {
    const net = this.net;
    const a = n.a;
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
    const uturn = !fromSeat && cause !== 'info' && lastEdge >= 0 ? net.arcs.findIndex((A) => A.edge === lastEdge && A.from === n.node) : -1;
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
    } else if (a.group >= 0 && !a.groupLeader && this.na[this.groups[a.group][0]].exitGroup >= 0 && Number.isFinite(costs[this.na[this.groups[a.group][0]].exitGroup].cost)) {
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
      for (let k = 0; k < EXIT_GROUPS.length; k++) {
        if (!(a.knownExits & (1 << k))) continue;
        const T = costs[k].cost;
        if (!Number.isFinite(T)) continue;
        const cmOk = a.cmGroup === k;
        const ledOk = a.ledGroup === k;
        let G = 0;
        if (cmOk && ledOk) G = 1;
        else if (cmOk) G = a.ledGroup >= 0 ? 0.5 : 1;
        else if (ledOk) G = a.cmGroup >= 0 ? 0.5 : 1;
        const u = -w.time * (T / 30) + w.familiarity * (k === 0 ? 1 : 0) + w.social * social[k] + w.guidance * 3 * G + w.inertia * (k === prevGroup ? 1 : 0);
        const v = u + this.rngRoute.gumbel();
        if (v > bestV) {
          bestV = v;
          best = k;
        }
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
    if (a.group >= 0 && !a.separated) {
      a.state = ST.WAITING;
      this.groupReadyCount[a.group]++;
      const members = this.groups[a.group];
      if (this.groupReadyCount[a.group] < members.length) return;
      // everybody ready: leader first, then the others (they adopt the leader's exit)
      for (const i of members) this.depart(this.na[i]);
      return;
    }
    this.depart(n);
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
  private recommend(n: NetAgent, knows: boolean, dynamic: boolean, plan: Record<string, string>): number {
    const zone = this.geo.seats[n.a.seat].zone;
    let gi = EXIT_GROUPS.indexOf((plan[zone] ?? 'FOYER') as any);
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
    if (cm.knows) for (const e of this.blockedEdges) info = this.learn(n, e) || info;
    for (const e of this.barrierEdges) info = this.learn(n, e) || info;
    const gi = this.recommend(n, cm.knows, C.dynamic, C.plan);
    a.knownExits |= 1 << gi;
    if (a.uCM < C.complianceProb) {
      const prev = a.cmGroup;
      a.cmGroup = gi;
      if (a.ledGroup >= 0 && a.ledGroup !== gi && prev !== gi) a.hesitate += this.cfg.led.conflictDelay;
    }
    if (n.phase === PH.QUEUE && n.arc >= 0 && this.net.edges[this.net.arcs[n.arc].edge].kind !== 'rowExit') this.replanInQueue(n, 'info');
    else if (n.phase === PH.TRANSIT || n.phase === PH.ROW || n.phase === PH.QUEUE) n.pendingReplan = true;
    void info;
  }

  private ledPerceive(n: NetAgent) {
    const a = n.a;
    const L = this.cfg.led;
    if (!L.enabled || !this.ledActive || a.ledSeen || a.wheelchair) return;
    a.ledSeen = true;
    const pSee = L.perceiveProb * (1 - 0.5 * Math.min(1, this.cfg.environment.smoke));
    if (a.uLEDsee >= pSee) return;
    let gi = EXIT_GROUPS.indexOf((L.plan[this.geo.seats[a.seat].zone] ?? 'FOYER') as any);
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
        if (!cm.knows) {
          cm.knows = true;
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
    const C = this.cfg.crowdManagers;
    const pHear = 1 - Math.exp(-C.hearRate);
    const R = C.radius * (this.cfg.environment.smoke > 0.5 ? 0.7 : 1);
    for (const cm of this.cmTimes) {
      if (t < cm.t) continue;
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
  private replanInQueue(n: NetAgent, cause: 'node' | 'info') {
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
      n.pendingReplan = false;
      this.chooseExit(n, planBroken || info ? 'info' : 'node');
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

  private record() {
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
      tEnd: this.t,
      meanExit: mean(exitTimes),
      medianExit: q(exitTimes, 0.5),
      p95Exit: q(exitTimes, 0.95),
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
