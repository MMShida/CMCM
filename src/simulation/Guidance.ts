/**
 * Crowd Managers and LED guidance (Model A).
 *
 * Crowd Manager c becomes active at t_c ~ LogNormal(median, sigma) after the alarm and then
 * broadcasts by voice. Each second, an agent in reach who has not yet received the current
 * instruction hears it with probability 1 - exp(-h).
 * Hearing an instruction:
 *   - makes an unaware agent aware,
 *   - shortens the remaining response time by the factor cmFactor,
 *   - teaches the agent the recommended exit (and any obstruction/barrier the CM knows),
 *   - with probability p_comply the agent adopts the recommendation as guidance G in its exit utility.
 *
 * TWO MODES (cfg.adaptive.managers):
 *   false (previous model, unchanged): reach = straight-line distance <= R on the same floor
 *         (passes through walls); one version counter per AGENT, so a person who heard one
 *         manager does not hear another manager with the same version; Crowd Managers know the true
 *         queue at every gate when rebalancing (crowdManagers.rebalance).
 *   true  (adaptive, ManagerPolicy.ts): reach = same floor, straight line <= R AND either the same
 *         acoustic space (room: connected part of the building without crossing a door) or a walking
 *         distance through an open door <= reachFactor x R (walls block the voice); one version per (agent,
 *         manager), so a person can hear several managers; managers only know what they observed
 *         or received by radio; instructions follow the coordinated policy with minimum hold and
 *         hysteresis; compliance is p_comply x trust(t); contradictory instructions cost hesitation
 *         and trust; managers pass on the congestion they know (people's beliefs are updated).
 *
 * In both modes the bookkeeping of responsibility R_m(t), reach H_m(t), influence I_m(t) and
 * workload is recorded every second (it never changes behaviour or random draws). Influence rule:
 * person i counts in I_m(t) if i adopted m's instruction last (cmSource = m) and its current exit
 * choice equals that instruction.
 *
 * LED strips activate at t_LED; when an agent starts moving (or at activation if already
 * moving) it perceives the strip with probability p_see (fixed uniform uLEDsee) and complies
 * with probability p_comply (uLED). Disagreement between LED and Crowd Manager instructions
 * costs a hesitation delay and splits the guidance term.
 *
 * Pre-assigned exits (optional): before the emergency (pre-show announcement, seat card or
 * ticket) each attendee is told the exit of their seat block. With probability reachProb the
 * attendee remembers it (learns that exit); with probability complianceProb they also adopt it as
 * guidance from t = 0, i.e. BEFORE they start to move (Crowd Managers only reach people later).
 *
 * Queue rebalancing (legacy, optional): every `interval` s an active Crowd Manager estimates, for
 * each exit group, the time from its post = walking time + the longest wait (queue / capacity) at a
 * gate on the staff route (TRUE queues, i.e. perfect knowledge). If the planned group of the zones
 * it serves is worse than the best alternative by more than `threshold` s, the manager redirects.
 */
import type { Field } from '../geometry/NavigationGraph';
import { MinHeap } from '../geometry/NavigationGraph';
import type { CrowdManagerPost, ExitGroupId } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { Agent } from './Agent';
import { ST } from './Agent';
import type { ManagerState, PolicyEnv } from './ManagerPolicy';
import { ManagerPolicy, newManager, plannedGroups, reassign, workloadIndex } from './ManagerPolicy';
import { planExitIndex } from './Plan';
import { placementPosts } from './Placements';
import { RNG } from './Random';
import type { SimulationEngine } from './SimulationEngine';

export interface CrowdManagerRT extends ManagerState {
  post: CrowdManagerPost;
  lastCheck: number;
  /** walking distance (m) from the post to every navigation node (voice reach through the building) */
  dist: Float32Array;
  /** non-row links in the observation area (local density) */
  obsLinks: number[];
}

export class GuidanceSystem {
  readonly cms: CrowdManagerRT[] = [];
  private acc = 0;
  private readonly sim: SimulationEngine;
  private readonly rng: RNG;
  private heardVersion: Int32Array;
  /** adaptive: version heard per (agent, manager) */
  private heardBy: Int32Array;
  private reachedEver: Uint8Array;
  private instructedEver: Uint8Array;
  private compliedEver: Uint8Array;
  private zoneIdx: Int32Array;
  private zoneMask: Uint8Array[];
  readonly adaptive: boolean;
  readonly policy: ManagerPolicy | null = null;
  private routeCache = new Map<string, { walk: number; gates: number[] } | null>();
  /** acoustic space (room) of every navigation node: components of the graph without door links */
  readonly space: Int32Array;
  ledActive = false;
  /** diagnostics: contradictory instructions (first 500) */
  readonly conflictLog: { t: number; agent: number; from: number; to: number; had: number; now: number; planned: number }[] = [];
  /** number of redirections made by queue rebalancing (diagnostics) */
  redirections = 0;

  constructor(sim: SimulationEngine) {
    this.sim = sim;
    this.rng = new RNG(sim.seed, 'guidance');
    const C = sim.cfg.crowdManagers;
    this.adaptive = !!sim.cfg.adaptive?.managers;
    const n = C.count < 0 ? Math.ceil(sim.agents.length / 250) : C.count;
    const all = sim.geo.crowdManagerPosts;
    const custom = placementPosts(sim.geo, C.placement);
    // draw activation times for all geometry posts (CRN); custom layouts use the i-th draw
    const act = all.map(() => this.rng.lognormalMedian(C.activationMedian, C.activationSigma));
    let chosen: { post: CrowdManagerPost; t: number }[];
    if (custom) chosen = custom.slice(0, n).map((p, i) => ({ post: p, t: act[i % act.length] }));
    else {
      // explicit post list (in priority order) or the geometry's default order
      const order = C.posts && C.posts.length ? C.posts.map((id) => all.find((p) => p.id === id)).filter((p): p is CrowdManagerPost => !!p) : all;
      const posts = order.filter((p) => !C.unavailable.includes(p.id));
      chosen = posts.slice(0, Math.min(n, posts.length)).map((p) => ({ post: p, t: act[all.indexOf(p)] }));
    }
    this.space = this.computeSpaces();
    const knows0 = sim.cfg.blocked.links.length > 0 && sim.cfg.blocked.knowledge === 'immediate';
    chosen.forEach(({ post, t }, i) => {
      const node = this.nearestNode(post);
      const base = newManager(i, post, node, t, plannedGroups(post.zones, C.plan), knows0);
      // coordination group = room (acoustic space) and floor of the post
      base.group = this.space[node] * 4 + (post.floor === 2 ? 2 : 1);
      const cm: CrowdManagerRT = Object.assign(base, { post, lastCheck: -Infinity, dist: this.walkDistances(node, post), obsLinks: [] as number[] });
      this.cms.push(cm);
    });
    // peers: same room and floor, voice areas overlap (posts <= 2 x radius apart)
    for (const a of this.cms)
      a.peers = this.cms.filter((b) => b !== a && b.group === a.group && Math.hypot(a.post.x - b.post.x, a.post.y - b.post.y) <= 2 * C.radius).map((b) => b.idx);
    this.heardVersion = new Int32Array(sim.agents.length).fill(-1);
    this.heardBy = new Int32Array(this.adaptive ? sim.agents.length * Math.max(1, this.cms.length) : 0).fill(-1);
    this.reachedEver = new Uint8Array(sim.agents.length * Math.max(1, this.cms.length));
    this.instructedEver = new Uint8Array(sim.agents.length * Math.max(1, this.cms.length));
    this.compliedEver = new Uint8Array(sim.agents.length * Math.max(1, this.cms.length));
    // zone membership (formal responsibility)
    const zones = [...new Set(sim.geo.seats.map((s) => s.zone))];
    this.zoneIdx = Int32Array.from(sim.agents, (a) => zones.indexOf(sim.geo.seats[a.seat].zone));
    this.zoneMask = this.cms.map((cm) => Uint8Array.from(zones, (z) => (cm.zones.includes(z) ? 1 : 0)));
    this.setupObservation();
    if (this.adaptive) {
      const env: PolicyEnv = {
        queueAt: (g) => sim.gates.queueNow[g],
        capOf: (g) => sim.gates.cap[g],
        closedGate: (g) => sim.movement.closed[g] === 1,
        route: (node, gi, knows) => this.route(node, gi, knows),
        groupCap: EXIT_GROUPS.map((_, gi) => sim.graph.links.reduce((s, L, li) => s + (L.exterior && L.exitGroup === gi && L.gate ? sim.gates.cap[li] : 0), 0)),
      };
      this.policy = new ManagerPolicy(sim.cfg, this.cms, env, sim.seed, 'cm-policy');
    }
    this.preassign();
  }

  private nearestNode(p: CrowdManagerPost): number {
    const g = this.sim.graph;
    let best = 0;
    let bd = Infinity;
    g.nodes.forEach((n, i) => {
      if ((n.floor === 2 ? 2 : 1) !== (p.floor === 2 ? 2 : 1) || n.kind !== 'junction') return;
      if (!g.adj[i].some((e) => !g.links[e.link].isRow)) return;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private computeSpaces(): Int32Array {
    const g = this.sim.graph;
    const parent = Int32Array.from(g.nodes, (_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    for (const L of g.links) {
      if (L.kind === 'door' || L.prohibited || L.exterior) continue;
      const ra = find(L.a);
      const rb = find(L.b);
      if (ra !== rb) parent[ra] = rb;
    }
    return Int32Array.from(g.nodes, (_, i) => find(i));
  }

  /** acoustic space of an agent's position */
  spaceOf(a: Agent): number {
    const g = this.sim.graph;
    const li = a.link >= 0 ? a.link : this.sim.seatLink[a.id];
    const L = g.links[li];
    if (L.kind === 'door' && a.link >= 0) return this.space[a.dir > 0 ? L.b : L.a];
    return this.space[L.a];
  }

  /** walking distance (m) from the post through the building (rows included, elevator excluded) */
  private walkDistances(node: number, p: CrowdManagerPost): Float32Array {
    const g = this.sim.graph;
    const d = new Float32Array(g.nodes.length).fill(Infinity);
    const n0 = g.nodes[node];
    d[node] = Math.hypot(n0.x - p.x, n0.y - p.y);
    const h = new MinHeap();
    h.push(d[node], node);
    while (h.size) {
      const [k, u] = h.pop();
      if (k > d[u]) continue;
      for (const e of g.adj[u]) {
        const L = g.links[e.link];
        if (L.prohibited) continue;
        const nd = k + L.len;
        if (nd < d[e.other]) {
          d[e.other] = nd;
          h.push(nd, e.other);
        }
      }
    }
    return d;
  }

  /** walking distance from manager cm to agent a */
  walkDistance(cm: CrowdManagerRT, a: Agent): number {
    const sim = this.sim;
    const g = sim.graph;
    if (a.link < 0) {
      const L = g.links[sim.seatLink[a.id]];
      const s = sim.geo.seats[a.seat].s;
      return Math.min(cm.dist[L.a] + s, cm.dist[L.b] + L.len - s);
    }
    const L = g.links[a.link];
    const s = a.dir > 0 ? a.sDir : L.len - a.sDir;
    return Math.min(cm.dist[L.a] + s, cm.dist[L.b] + Math.max(0, L.len - s));
  }

  private setupObservation() {
    const sim = this.sim;
    const g = sim.graph;
    const A = sim.cfg.adaptive;
    const R = A?.observeRange ?? 18;
    const f = A?.reachFactor ?? 1.4;
    for (const cm of this.cms) {
      const fl = cm.post.floor === 2 ? 2 : 1;
      g.links.forEach((L, li) => {
        if (L.isRow || L.prohibited) return;
        const n = g.nodes[L.a];
        if (sim.nodeFloorDisp[L.a] !== fl) return;
        if (Math.hypot(n.x - cm.post.x, n.y - cm.post.y) > R) return;
        const sameRoom = this.space[L.a] === this.space[cm.node] || this.space[L.b] === this.space[cm.node];
        if (!sameRoom && cm.dist[L.a] > f * R) return;
        cm.obsLinks.push(li);
        if (L.gate) cm.obsGates.push(li);
      });
    }
  }

  /** staff route (walk time at 1.2 m/s and the gates on it) from node to exit group gi */
  route(node: number, gi: number, knowsBlocked: boolean): { walk: number; gates: number[] } | null {
    const key = `${node}|${gi}|${knowsBlocked ? 1 : 0}`;
    if (this.routeCache.has(key)) return this.routeCache.get(key)!;
    const sim = this.sim;
    const g = sim.graph;
    const f: Field = (knowsBlocked ? sim.staffFields(false) : sim.nominalFields())[gi];
    let out: { walk: number; gates: number[] } | null = null;
    if (Number.isFinite(f.dist[node])) {
      const gates: number[] = [];
      let u = node;
      for (let guard = 0; guard < 400; guard++) {
        const k = f.next[u];
        if (k < 0) break;
        const e = g.adj[u][k];
        const L = g.links[e.link];
        if (L.gate) gates.push(e.link);
        if (L.exterior) break;
        u = e.other;
      }
      out = { walk: f.dist[node], gates };
    }
    this.routeCache.set(key, out);
    return out;
  }

  /** Pre-assigned exits: drawn from a separate random stream so the audience itself is unchanged (CRN). */
  private preassign() {
    const sim = this.sim;
    const P = sim.cfg.preassign;
    if (!P || !P.enabled) return;
    const rng = new RNG(sim.seed, 'preassign');
    for (const a of sim.agents) {
      const uReach = rng.random();
      const uComply = rng.random();
      if (a.wheelchair || uReach >= P.reachProb) continue;
      const gi = planExitIndex(P.plan, sim.geo, a.seat);
      a.knownExits |= 1 << gi;
      if (uComply < P.complianceProb) a.assignGroup = gi;
    }
  }

  /** Exit group a Crowd Manager recommends for an agent (seat block plan, redirections, blocked exits). */
  recommend(a: Agent, knowsBlocked: boolean, dynamic: boolean, plan: Record<string, ExitGroupId>, cm: CrowdManagerRT | null = null): number {
    const sim = this.sim;
    let gi = planExitIndex(plan, sim.geo, a.seat);
    if (cm && cm.redirect.has(gi)) gi = cm.redirect.get(gi)!;
    if (knowsBlocked && dynamic) {
      // the staff member knows the true state of the building: pick the cheapest open exit
      // if the planned one is unreachable or much worse
      const f = sim.staffFields(a.wheelchair);
      const pos = sim.routing.estimateFrom(a, f[gi]);
      if (!Number.isFinite(pos.cost) || sim.staffPlanBlocked(gi)) {
        let best = -1;
        let bestC = Infinity;
        for (let k = 0; k < f.length; k++) {
          const c = sim.routing.estimateFrom(a, f[k]).cost;
          if (c < bestC) {
            bestC = c;
            best = k;
          }
        }
        if (best >= 0) gi = best;
      }
    }
    return gi;
  }

  step(dt: number) {
    const sim = this.sim;
    const t = sim.t;
    const B = sim.cfg.blocked;
    if (B.links.length && B.knowledge === 'announced' && t >= B.announceDelay) {
      for (const cm of this.cms)
        if (!cm.knowsBlocked) {
          cm.knowsBlocked = true;
          cm.version++;
        }
    }
    // LED activation
    const L = sim.cfg.led;
    if (L.enabled && !this.ledActive && t >= L.activationTime) {
      this.ledActive = true;
      for (const a of sim.agents) if (a.state >= ST.MOVING && a.state <= ST.REUNITING) this.ledPerceive(a);
    }
    this.acc += dt;
    if (this.acc < 1 - 1e-9) return;
    this.acc = 0;
    const C = sim.cfg.crowdManagers;
    const pHear = 1 - Math.exp(-C.hearRate);
    const R = C.radius * (sim.cfg.environment.smoke > 0.5 ? 0.7 : 1);
    if (this.policy) {
      this.policy.step(t);
      if (sim.cfg.adaptive.reassign === 'whenClear' && reassign(this.cms, t, (x, y) => (x as CrowdManagerRT).dist[y.node], C.plan)) this.refreshZoneMasks();
      for (let i = 0; i < this.cms.length; i++) this.adaptiveBroadcast(this.cms[i], i, R, pHear);
    } else {
      const RB = C.rebalance;
      for (const cm of this.cms) {
        if (t < cm.tActive) continue;
        if (RB && RB.enabled && t - cm.lastCheck >= RB.interval - 1e-9) {
          cm.lastCheck = t;
          this.rebalance(cm, RB.threshold);
        }
        sim.forEachNear(cm.post.x, cm.post.y, cm.post.floor, R, (a) => {
          if (a.done || !a.inside) return;
          if (this.heardVersion[a.id] >= cm.version) return;
          if (this.rng.random() > pHear) return;
          this.heardVersion[a.id] = cm.version;
          this.instruct(a, cm);
        });
      }
    }
    this.record(t, R);
  }

  private refreshZoneMasks() {
    const zones = [...new Set(this.sim.geo.seats.map((s) => s.zone))];
    this.zoneMask = this.cms.map((cm) => Uint8Array.from(zones, (z) => (cm.zones.includes(z) ? 1 : 0)));
  }

  /** adaptive reach: same floor, straight line <= R, and same room or through a door within reachFactor x R on foot */
  inReach(cm: CrowdManagerRT, a: Agent, R: number): boolean {
    if ((a.floor === 2 ? 2 : 1) !== (cm.post.floor === 2 ? 2 : 1)) return false;
    if (Math.hypot(a.x - cm.post.x, a.y - cm.post.y) > R) return false;
    return this.topoOk(cm, a, R);
  }

  /** the part of the reach rule that depends on the building (walls): same room or near an open door */
  topoOk(cm: CrowdManagerRT, a: Agent, R: number): boolean {
    if (this.spaceOf(a) === this.space[cm.node]) return true;
    return this.walkDistance(cm, a) <= (this.sim.cfg.adaptive?.reachFactor ?? 1.4) * R;
  }

  private adaptiveBroadcast(cm: CrowdManagerRT, mi: number, R: number, pHear: number) {
    const sim = this.sim;
    if (sim.t < cm.tActive) return;
    const nCM = this.cms.length;
    sim.forEachNear(cm.post.x, cm.post.y, cm.post.floor, R, (a) => {
      if (a.done || !a.inside) return;
      if (!this.topoOk(cm, a, R)) return;
      // people around pass on closures they know about
      if (!cm.knowsBlocked && sim.blockedLinks.length && a.knownBlocked.some((li) => sim.blockedLinks.includes(li)) && this.rng.random() < 0.5) {
        cm.knowsBlocked = true;
        cm.version++;
        cm.reviewNow = true;
      }
      const every = sim.cfg.adaptive.hearEvery !== false;
      const k = a.id * nCM + mi;
      if (every ? this.heardBy[k] >= cm.version : this.heardVersion[a.id] >= cm.version) return;
      if (this.rng.random() > pHear) return;
      if (every) this.heardBy[k] = cm.version;
      else this.heardVersion[a.id] = cm.version;
      this.instructAdaptive(a, cm);
    });
  }

  /** previous model's instruction (unchanged behaviour; bookkeeping only added) */
  private instruct(a: Agent, cm: CrowdManagerRT) {
    const sim = this.sim;
    const C = sim.cfg.crowdManagers;
    const first = !a.instructedCM;
    a.instructedCM = true;
    if (a.state === ST.UNAWARE) sim.makeAware(a);
    if (first && (a.state === ST.AWARE || a.state === ST.UNAWARE)) a.tResponse = a.clock + Math.max(0, a.tResponse - a.clock) * sim.cfg.premovement.cmFactor;
    let learned = false;
    if (cm.knowsBlocked) for (const li of sim.blockedLinks) learned = sim.routing.learnBlocked(a, li) || learned;
    for (const li of sim.barrierLinks) learned = sim.routing.learnBlocked(a, li) || learned;
    const gi = this.recommend(a, cm.knowsBlocked, C.dynamic, C.plan, cm);
    a.knownExits |= 1 << gi;
    this.countInstructed(a, cm);
    if (!this.topoOk(cm, a, C.radius * (sim.cfg.environment.smoke > 0.5 ? 0.7 : 1))) cm.throughWall++;
    const prevTarget = a.targetGroup;
    let complied = false;
    if (a.uCM < C.complianceProb) {
      const prev = a.cmGroup;
      a.cmGroup = gi;
      a.cmSource = cm.idx;
      a.cmTime = sim.t;
      complied = true;
      if (a.ledGroup >= 0 && a.ledGroup !== gi && prev !== gi) a.hesitate += sim.cfg.led.conflictDelay;
    }
    // an instruction re-plans like a routine decision (route inertia, no U-turn); only newly
    // learned closures force an unconditional re-plan (prevents back-and-forth walking)
    if (a.state >= ST.MOVING && a.state <= ST.REUNITING) sim.routing.chooseExit(a, learned ? 'info' : 'node');
    if (complied) this.countComplied(a, cm, prevTarget, gi);
  }

  /** adaptive instruction: trust-dependent compliance, conflicts, congestion information */
  private instructAdaptive(a: Agent, cm: CrowdManagerRT) {
    const sim = this.sim;
    const C = sim.cfg.crowdManagers;
    const A = sim.cfg.adaptive;
    const t = sim.t;
    const first = !a.instructedCM;
    a.instructedCM = true;
    if (a.state === ST.UNAWARE) sim.makeAware(a);
    if (first && (a.state === ST.AWARE || a.state === ST.UNAWARE)) a.tResponse = a.clock + Math.max(0, a.tResponse - a.clock) * sim.cfg.premovement.cmFactor;
    let learned = false;
    if (cm.knowsBlocked) for (const li of sim.blockedLinks) learned = sim.routing.learnBlocked(a, li) || learned;
    for (const li of sim.barrierLinks) learned = sim.routing.learnBlocked(a, li) || learned;
    const gi = this.recommend(a, cm.knowsBlocked, C.dynamic, C.plan, cm);
    a.knownExits |= 1 << gi;
    a.urgency = Math.max(a.urgency, 0.5);
    this.countInstructed(a, cm);
    // congestion the manager knows about becomes the person's belief (with its age)
    if (A.shareCongestion && A.congestionInfo !== 'none' && this.policy) {
      const gw = this.policy.groupWaits(cm);
      for (let g = 0; g < gw.length; g++) {
        if (!Number.isFinite(gw[g].w)) continue;
        if (!Number.isNaN(a.beliefT[g]) && a.beliefT[g] > gw[g].t) continue; // own newer information wins
        a.belief[g] = gw[g].w;
        a.beliefT[g] = gw[g].t;
      }
    }
    // contradiction with a recent instruction from another manager
    if (a.cmGroup >= 0 && a.cmSource >= 0 && a.cmSource !== cm.idx) {
      if (a.cmGroup !== gi && t - a.cmTime < 60) {
        if (this.conflictLog.length < 500) this.conflictLog.push({ t, agent: a.id, from: a.cmSource, to: cm.idx, had: a.cmGroup, now: gi, planned: planExitIndex(C.plan, sim.geo, a.seat) });
        a.conflicts++;
        cm.conflicts++;
        this.cms[a.cmSource].conflicts++;
        a.hesitate += A.conflictDelay;
        a.trust = Math.max(0.2, a.trust - 0.5 * A.trustLoss);
      } else if (a.cmGroup === gi) a.trust = Math.min(1.2, a.trust + A.trustGain);
    }
    const prevTarget = a.targetGroup;
    let complied = false;
    if (a.uCM < C.complianceProb * a.trust) {
      const prev = a.cmGroup;
      a.cmGroup = gi;
      a.cmSource = cm.idx;
      a.cmTime = t;
      complied = true;
      if (a.ledGroup >= 0 && a.ledGroup !== gi && prev !== gi) a.hesitate += sim.cfg.led.conflictDelay;
    }
    // a new instruction is new relevant information: re-evaluate (bypasses the commitment interval,
    // keeps route inertia and the no-U-turn rule); newly learned closures force a re-plan
    if (a.state >= ST.MOVING && a.state <= ST.REUNITING) {
      a.pendingNext = -1;
      sim.routing.chooseExit(a, learned ? 'info' : 'guidance');
    }
    if (complied) this.countComplied(a, cm, prevTarget, gi);
  }

  private countInstructed(a: Agent, cm: CrowdManagerRT) {
    const k = a.id * this.cms.length + cm.idx;
    if (!this.instructedEver[k]) {
      this.instructedEver[k] = 1;
      cm.instructed++;
    }
  }

  private countComplied(a: Agent, cm: CrowdManagerRT, prevTarget: number, gi: number) {
    const k = a.id * this.cms.length + cm.idx;
    if (!this.compliedEver[k]) {
      this.compliedEver[k] = 1;
      cm.complied++;
    }
    if (prevTarget >= 0 && prevTarget !== gi && a.targetGroup === gi) cm.changed++;
  }

  /** R / H / I / workload bookkeeping, once per second (no random draws, no behaviour change) */
  private record(t: number, R: number) {
    const sim = this.sim;
    const nCM = this.cms.length;
    if (!nCM) return;
    const plan = sim.cfg.crowdManagers.plan;
    const Rc = new Int32Array(nCM);
    const Ic = new Int32Array(nCM);
    const planned = this.cms.map(() => new Map<number, number>());
    for (const a of sim.agents) {
      if (a.done || !a.inside) continue;
      const z = this.zoneIdx[a.id];
      for (let m = 0; m < nCM; m++)
        if (z >= 0 && this.zoneMask[m][z]) {
          Rc[m]++;
          const p = planExitIndex(plan, sim.geo, a.seat);
          planned[m].set(p, (planned[m].get(p) ?? 0) + 1);
        }
      if (a.cmSource >= 0 && a.cmGroup >= 0 && a.targetGroup === a.cmGroup) Ic[a.cmSource]++;
    }
    const crit = sim.cfg.adaptive?.criticalWait ?? 30;
    for (let m = 0; m < nCM; m++) {
      const cm = this.cms[m];
      let H = 0;
      const reachP = new Map<number, number>();
      if (t >= cm.tActive) {
        sim.forEachNear(cm.post.x, cm.post.y, cm.post.floor, R, (a) => {
          if (a.done || !a.inside) return;
          if (this.adaptive && !this.topoOk(cm, a, R)) return;
          H++;
          const pp = planExitIndex(plan, sim.geo, a.seat);
          reachP.set(pp, (reachP.get(pp) ?? 0) + 1);
          const k = a.id * nCM + m;
          if (!this.reachedEver[k]) {
            this.reachedEver[k] = 1;
            cm.uniqueReached++;
          }
        });
      }
      let nCrit = 0;
      for (const gt of cm.obsGates) if (sim.gates.queueNow[gt] / Math.max(0.2, sim.gates.cap[gt]) > crit) nCrit++;
      let dens = 0;
      for (const li of cm.obsLinks) {
        const L = sim.graph.links[li];
        if (L.len < 1.5) continue;
        const d = sim.movement.linkCount[li] / (L.len * L.width);
        if (d > dens) dens = d;
      }
      const W = t >= cm.tActive ? workloadIndex(H, nCrit, dens, sim.cfg) : 0;
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
   * Staff estimate (s) of reaching exit group gi from node n: nominal walking time along the staff
   * route plus the longest current wait (queue / capacity) at any gate on that route.
   */
  staffEstimate(n: number, gi: number): number {
    const sim = this.sim;
    const g = sim.graph;
    const f = sim.staffFields(false)[gi];
    if (!Number.isFinite(f.dist[n])) return Infinity;
    let u = n;
    let wait = 0;
    for (let guard = 0; guard < 400; guard++) {
      const k = f.next[u];
      if (k < 0) break;
      const e = g.adj[u][k];
      const L = g.links[e.link];
      if (L.gate) wait = Math.max(wait, sim.gates.queueNow[e.link] / Math.max(0.2, sim.gates.cap[e.link]));
      if (L.exterior) break;
      u = e.other;
    }
    return f.dist[n] + wait;
  }

  private rebalance(cm: CrowdManagerRT, threshold: number) {
    const sim = this.sim;
    const plan = sim.cfg.crowdManagers.plan;
    // exit groups this manager's zones are planned to
    const planned = new Set<number>();
    for (const z of cm.post.zones) {
      for (const [k, v] of Object.entries(plan)) if (k === z || k.startsWith(z + ':')) planned.add(EXIT_GROUPS.indexOf(v));
      if (!(z in plan)) planned.add(0);
    }
    const est = EXIT_GROUPS.map((_, gi) => (sim.staffPlanBlocked(gi) && !cm.knowsBlocked ? Infinity : this.staffEstimate(cm.node, gi)));
    let changed = false;
    for (const p of planned) {
      if (p < 0) continue;
      const cur = cm.redirect.has(p) ? cm.redirect.get(p)! : p;
      let best = cur;
      for (let gi = 0; gi < est.length; gi++) if (est[gi] < est[best]) best = gi;
      if (best !== cur && est[cur] - est[best] > threshold) {
        if (best === p) cm.redirect.delete(p);
        else cm.redirect.set(p, best);
        cm.history.push({ t: sim.t, planned: p, from: cur, to: best, reason: `rebalance (true queues): ${Math.round(est[cur] - est[best])} s better` });
        changed = true;
      } else if (cur !== p && est[p] <= est[cur] + 0.5 * threshold) {
        // the planned exit is competitive again: return to the plan
        cm.redirect.delete(p);
        cm.history.push({ t: sim.t, planned: p, from: cur, to: p, reason: 'rebalance: planned exit competitive again' });
        changed = true;
      }
    }
    if (changed) {
      cm.version++;
      this.redirections++;
    }
  }

  /** LED perception when an agent starts to move. */
  ledPerceive(a: Agent) {
    const sim = this.sim;
    const L = sim.cfg.led;
    if (!L.enabled || !this.ledActive || a.ledSeen || a.wheelchair) return;
    a.ledSeen = true;
    const pSee = L.perceiveProb * (1 - 0.5 * Math.min(1, sim.cfg.environment.smoke));
    if (a.uLEDsee >= pSee) return;
    let gi = planExitIndex(L.plan, sim.geo, a.seat);
    if (L.dynamic && sim.blockedLinks.length) {
      // dynamic signage marks closed exits and points to the nearest open one
      for (const li of sim.blockedLinks) sim.routing.learnBlocked(a, li);
      gi = this.recommend(a, true, true, L.plan, null);
    }
    a.knownExits |= 1 << gi;
    if (a.uLED < L.complianceProb) {
      a.ledGroup = gi;
      if (a.cmGroup >= 0 && a.cmGroup !== gi) a.hesitate += L.conflictDelay;
    }
  }
}
