/**
 * Route choice with individual, local knowledge.
 *
 * At every decision (when an agent starts moving, at junctions with a type-dependent
 * re-evaluation probability, when it learns new information, or after waiting in a queue)
 * the agent runs a FORWARD Dijkstra search from its own position over the links it believes
 * open. The perceived cost of traversing link l is
 *
 *   c_i(l) = tau_l * 1.2/v0_i                       nominal time at the agent's speed
 *          + (wQ/wT) * q_l / C_l * nu(w_l)            visible queue at a gate (q_l persons, capacity C_l,
 *                                                     narrow-door factor nu = 1 + b * max(0, (2 - w)/2))
 *          + kappa_cf * n_opp(l) / lanes(l)           visible opposing stream
 *
 * A queue counts as visible when the gate is on the agent's floor within
 * r_vis + 0.5 m * q_l (the tail of a long queue is visible even if the door is not).
 * Links known to be blocked, prohibited links (elevator) and - for wheelchair users -
 * stairs are removed. Seat rows other than the agent's own are never used as passages.
 *
 * One search yields T_ig = min cost to any street destination of exit group g, which enters a
 * multinomial logit
 *   U_ig = -wT * T_ig/30 + wF * F_g + wS * S_ig + wG * G_ig + wI * 1[g = current] + Gumbel
 * (the queue term is inside T_ig through the (wQ/wT) weighting above). The agent then follows the
 * shortest path of its chosen group (stored as a node/link sequence) until the next re-plan.
 * Re-planning keeps the old path unless the new one is better by max(5 s, 10%) (route inertia).
 */
import type { Field } from '../geometry/NavigationGraph';
import { MinHeap, computeField } from '../geometry/NavigationGraph';
import { EXIT_GROUPS } from '../geometry/types';
import type { Agent } from './Agent';
import { REASON, ST } from './Agent';
import type { SimulationEngine } from './SimulationEngine';

interface FieldSet {
  groups: Field[];
  refuge: Field | null;
}

export class RouteSystem {
  private cache = new Map<string, FieldSet>();
  private readonly sim: SimulationEngine;
  readonly nGroups = EXIT_GROUPS.length;
  // scratch buffers for the forward search
  private dist: Float64Array;
  private predNode: Int32Array;
  private predAdj: Int32Array;
  private settled: Uint8Array;
  plansComputed = 0;
  private safeGroup: Int32Array;

  constructor(sim: SimulationEngine) {
    this.sim = sim;
    const n = sim.graph.nodes.length;
    this.dist = new Float64Array(n);
    this.predNode = new Int32Array(n);
    this.predAdj = new Int32Array(n);
    this.settled = new Uint8Array(n);
    this.safeGroup = Int32Array.from(sim.graph.nodes.map((nd) => (nd.exitGroup ? EXIT_GROUPS.indexOf(nd.exitGroup) : -1)));
  }

  // ---------------------------------------------------------------------------------
  // static (uncongested) fields - used for staff recommendations and group cohesion
  // ---------------------------------------------------------------------------------
  private key(a: Agent): string {
    return (a.wheelchair ? 'A|' : 'N|') + a.blockedSig;
  }

  fields(a: Agent): FieldSet {
    const k = this.key(a);
    let fs = this.cache.get(k);
    if (!fs) {
      const g = this.sim.graph;
      const set = new Set(a.knownBlocked);
      const acc = a.wheelchair;
      const bf = (li: number) => set.has(li) || g.links[li].prohibited || (acc && !g.links[li].accessible);
      fs = {
        groups: g.safeByGroup.map((targets) => computeField(g, targets, bf)),
        refuge: acc && g.refugeNodes.length ? computeField(g, g.refugeNodes, bf) : null,
      };
      this.cache.set(k, fs);
    }
    return fs;
  }

  learnBlocked(a: Agent, li: number): boolean {
    if (a.knownBlocked.includes(li)) return false;
    a.knownBlocked.push(li);
    a.knownBlocked.sort((x, y) => x - y);
    a.blockedSig = a.knownBlocked.join(',');
    a.pathValid = false;
    return true;
  }

  private timeScale(a: Agent): number {
    return 1.2 / Math.max(0.3, a.v0);
  }

  /** Static estimate (s) from the agent's position to the targets of field f. */
  estimateFrom(a: Agent, f: Field): { cost: number; node: number; rowDir: 1 | -1 } {
    const sim = this.sim;
    const g = sim.graph;
    const ts = this.timeScale(a);
    if (a.link < 0) {
      const seat = sim.geo.seats[a.seat];
      const L = g.links[sim.seatLink[a.id]];
      const rowV = Math.min(sim.cfg.movement.rowSpeed, a.v0);
      const ca = g.nodes[L.a].kind === 'deadEnd' ? Infinity : seat.s / rowV + f.dist[L.a] * ts;
      const cb = g.nodes[L.b].kind === 'deadEnd' ? Infinity : (L.len - seat.s) / rowV + f.dist[L.b] * ts;
      return ca <= cb ? { cost: ca, node: L.a, rowDir: -1 } : { cost: cb, node: L.b, rowDir: 1 };
    }
    const L = g.links[a.link];
    const toNode = a.dir > 0 ? L.b : L.a;
    return { cost: Math.max(0, L.len - a.sDir) / Math.max(0.3, a.v0) + f.dist[toNode] * ts, node: toNode, rowDir: a.dir };
  }

  /** Static remaining cost to the agent's current target (for group cohesion). */
  staticRemaining(a: Agent, node: number): number {
    if (a.wheelchair) {
      const f = this.fields(a).refuge;
      return f ? f.dist[node] : Infinity;
    }
    if (a.targetGroup < 0) return Infinity;
    return this.fields(a).groups[a.targetGroup].dist[node];
  }

  // ---------------------------------------------------------------------------------
  // forward search with perceived congestion
  // ---------------------------------------------------------------------------------
  /**
   * Runs the forward search. Returns per-group best cost and target node; the
   * predecessor arrays stay valid until the next call.
   */
  private search(a: Agent, fromNode: number | null, noUturn = -1): { cost: Float64Array; target: Int32Array; meetCost: number } {
    const sim = this.sim;
    const g = sim.graph;
    const n = g.nodes.length;
    const dist = this.dist;
    const predNode = this.predNode;
    const predAdj = this.predAdj;
    const settled = this.settled;
    dist.fill(Infinity);
    settled.fill(0);
    predNode.fill(-1);
    predAdj.fill(-1);
    const heap = new MinHeap();
    const ts = this.timeScale(a);
    const cfg = sim.cfg;
    const w = cfg.routing.weights[a.type];
    const qw = Math.min(4, w.queue / Math.max(0.2, w.time));
    const vis = sim.visibilityRange;
    const cfPen = cfg.routing.counterflowPenalty;
    const narrowB = cfg.routing.narrowDoorBoost;
    const known = a.knownBlocked;
    const mv = sim.movement;
    // sources
    if (fromNode !== null) {
      dist[fromNode] = 0;
      heap.push(0, fromNode);
    } else if (a.link < 0) {
      const seat = sim.geo.seats[a.seat];
      const L = g.links[sim.seatLink[a.id]];
      const rowV = Math.min(cfg.movement.rowSpeed, a.v0);
      if (g.nodes[L.a].kind !== 'deadEnd') {
        dist[L.a] = seat.s / rowV;
        heap.push(dist[L.a], L.a);
      }
      if (g.nodes[L.b].kind !== 'deadEnd') {
        const c = (L.len - seat.s) / rowV;
        if (c < dist[L.b]) {
          dist[L.b] = c;
          heap.push(c, L.b);
        }
      }
    } else {
      const L = g.links[a.link];
      const to = a.dir > 0 ? L.b : L.a;
      dist[to] = Math.max(0, L.len - a.sDir) / Math.max(0.3, a.v0);
      heap.push(dist[to], to);
    }
    const cost = new Float64Array(this.nGroups).fill(Infinity);
    const target = new Int32Array(this.nGroups).fill(-1);
    let meetCost = Infinity;
    let found = 0;
    // early exit: every exit group reached (first pop = minimum), or the special target
    const need = a.meetNode >= 0 || a.wheelchair ? 1 : this.nGroups;
    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (settled[u]) continue;
      settled[u] = 1;
      const nu = g.nodes[u];
      if (nu.kind === 'safe') {
        const gi = this.safeGroup[u];
        if (d < cost[gi]) {
          if (!Number.isFinite(cost[gi]) && !a.wheelchair && a.meetNode < 0) found++;
          cost[gi] = d;
          target[gi] = u;
          if (found >= need) break;
        }
        continue;
      }
      if (nu.kind === 'refuge') {
        if (a.wheelchair && d < cost[0]) {
          cost[0] = d;
          target[0] = u;
          break;
        }
        continue;
      }
      if (u === a.meetNode && d < meetCost) {
        meetCost = d;
        break;
      }
      const adj = g.adj[u];
      for (let k = 0; k < adj.length; k++) {
        const e = adj[k];
        const L = g.links[e.link];
        if (L.isRow) continue;
        if (u === fromNode && e.link === noUturn) continue; // no spontaneous U-turn
        if (a.meetNode < 0 && g.climbs(e.link, e.dir)) continue; // evacuees do not climb a storey
        if (known.length && known.includes(e.link)) continue;
        if (a.wheelchair && !L.accessible) continue;
        const v = e.other;
        if (settled[v]) continue;
        let c = g.nominalCost(e.link, e.dir, false) * ts;
        if (L.gate) {
          const q = sim.gates.queueNow[e.link];
          if (q > 0 && sim.nodeFloorDisp[u] === a.floor && Math.hypot(nu.x - a.x, nu.y - a.y) <= vis + 0.5 * q) {
            const capL = Math.max(0.2, sim.gates.cap[e.link]);
            c += (qw * q * (1 + narrowB * Math.max(0, (2 - L.width) / 2))) / capL;
          }
        }
        if (L.width < 2.6) {
          const opp = mv.dirCount[2 * e.link + (e.dir > 0 ? 1 : 0)];
          if (opp > 0) c += (cfPen * opp) / Math.max(1, L.lanes);
        }
        const nd = d + c;
        if (nd < dist[v]) {
          dist[v] = nd;
          predNode[v] = u;
          predAdj[v] = k;
          heap.push(nd, v);
        }
      }
    }
    this.plansComputed++;
    return { cost, target, meetCost };
  }

  /** Reconstruct the path (node sequence + adjacency indices) to `target` from the last search. */
  private extractPath(target: number): { nodes: number[]; adj: number[] } {
    const nodes: number[] = [];
    const adj: number[] = [];
    let v = target;
    let guard = 0;
    while (v >= 0 && this.predNode[v] >= 0 && guard++ < 10000) {
      const u = this.predNode[v];
      nodes.push(u);
      adj.push(this.predAdj[v]);
      v = u;
    }
    nodes.reverse();
    adj.reverse();
    return { nodes, adj };
  }

  /** Remaining perceived cost of the agent's current path (for route inertia). */
  private currentPathCost(a: Agent): number {
    if (!a.pathValid) return Infinity;
    const sim = this.sim;
    const g = sim.graph;
    const ts = this.timeScale(a);
    let c = 0;
    for (let i = a.pathPos; i < a.pathNodes.length; i++) {
      const e = g.adj[a.pathNodes[i]][a.pathAdj[i]];
      if (a.knownBlocked.includes(e.link)) return Infinity;
      c += g.nominalCost(e.link, e.dir, false) * ts;
      if (g.links[e.link].gate) {
        const q = sim.gates.queueNow[e.link];
        if (q > 0) c += q / Math.max(0.2, sim.gates.cap[e.link]);
      }
    }
    return c;
  }

  /**
   * Strategic + tactical decision. Picks the exit group (multinomial logit) and the path.
   * `cause`: 'start' (leaving the seat), 'node' (routine re-evaluation), 'info' (new information).
   */
  chooseExit(a: Agent, cause: 'start' | 'node' | 'info', atNode: number | null = null): boolean {
    const sim = this.sim;
    const prev = a.targetGroup;
    // reuniting members walk to the meeting node
    if (a.meetNode >= 0) {
      const r = this.search(a, atNode);
      if (Number.isFinite(r.meetCost)) this.setPath(a, this.extractPath(a.meetNode));
      else a.pathValid = false;
      return false;
    }
    // routine re-evaluations never reverse onto the link just walked (prevents oscillation)
    const uturn = atNode !== null && a.link >= 0 && cause !== 'info' ? a.link : -1;
    let r = this.search(a, atNode, uturn);
    if (uturn >= 0 && !r.cost.some((c) => Number.isFinite(c))) r = this.search(a, atNode);
    if (a.wheelchair) {
      a.targetGroup = 0;
      a.reason = REASON.ACCESSIBLE;
      if (r.target[0] >= 0) this.setPath(a, this.extractPath(r.target[0]));
      else a.pathValid = false;
      return false;
    }
    const nG = this.nGroups;
    // group members follow their leader's choice if they can reach it
    if (a.group >= 0 && !a.groupLeader && !sim.groupBroken[a.group]) {
      const leader = sim.agents[sim.groups[a.group][0]];
      const lg = leader.targetGroup;
      if (lg >= 0 && !leader.done && (a.knownExits & (1 << lg)) && Number.isFinite(r.cost[lg])) {
        a.targetGroup = lg;
        a.reason = REASON.GROUP;
        this.adoptPath(a, lg, r, cause);
        return prev !== lg && prev >= 0;
      }
    }
    const w = sim.cfg.routing.weights[a.type];
    const social = sim.socialShares(a);
    const util: number[] = new Array(nG).fill(-Infinity);
    const terms: number[][] = [];
    const gSrc: number[] = new Array(nG).fill(0);
    let known = 0;
    for (let gi = 0; gi < nG; gi++) {
      terms.push([0, 0, 0, 0, 0]);
      if ((a.knownExits & (1 << gi)) === 0) continue;
      const T = r.cost[gi];
      if (!Number.isFinite(T)) continue;
      known++;
      const F = gi === 0 ? 1 : 0;
      const S = social[gi];
      const cmOk = a.cmGroup === gi;
      const ledOk = a.ledGroup === gi;
      let G = 0;
      if (cmOk && ledOk) G = 1;
      else if (cmOk) G = a.ledGroup >= 0 ? 0.5 : 1;
      else if (ledOk) G = a.cmGroup >= 0 ? 0.5 : 1;
      gSrc[gi] = cmOk ? REASON.CM : ledOk ? REASON.LED : 0;
      const I = gi === prev ? 1 : 0;
      const t = [-w.time * (T / 30), w.familiarity * F, w.social * S, w.guidance * 3 * G, w.inertia * I];
      terms[gi] = t;
      util[gi] = t[0] + t[1] + t[2] + t[3] + t[4];
    }
    a.utilities = util.map((u) => (Number.isFinite(u) ? Math.round(u * 100) / 100 : NaN));
    a.groupCosts = Array.from(r.cost, (c) => (Number.isFinite(c) ? Math.round(c) : NaN));
    if (known === 0) {
      a.targetGroup = -1;
      a.pathValid = false;
      return false;
    }
    let best = -1;
    let bestV = -Infinity;
    for (let gi = 0; gi < nG; gi++) {
      if (!Number.isFinite(util[gi])) continue;
      const v = util[gi] + sim.rngRoute.gumbel();
      if (v > bestV) {
        bestV = v;
        best = gi;
      }
    }
    a.targetGroup = best;
    if (known === 1) a.reason = REASON.ONLY_KNOWN;
    else if (prev !== best || cause === 'start' || a.reason === REASON.NONE) {
      // explanation: utility term with the largest advantage over the mean of the alternatives
      const names = [REASON.SHORTEST, REASON.HABIT, REASON.SOCIAL, -1];
      let bestTerm = 0;
      let bestAdv = -Infinity;
      for (let k = 0; k < 4; k++) {
        let mean = 0;
        let cnt = 0;
        for (let gi = 0; gi < nG; gi++) {
          if (gi === best || !Number.isFinite(util[gi])) continue;
          mean += terms[gi][k];
          cnt++;
        }
        const adv = terms[best][k] - (cnt ? mean / cnt : 0);
        if (adv > bestAdv) {
          bestAdv = adv;
          bestTerm = k;
        }
      }
      a.reason = bestTerm === 3 ? gSrc[best] || REASON.CM : names[bestTerm];
      if (bestTerm === 0 && sim.gates.queueNow.length && cause !== 'start' && prev === best) a.reason = REASON.QUEUE;
      if (cause === 'info' && prev >= 0 && prev !== best) a.reason = REASON.BLOCKED;
    }
    this.adoptPath(a, best, r, cause);
    if (prev >= 0 && prev !== best) {
      a.reroutes++;
      a.rerouteFlash = 3;
      return true;
    }
    return false;
  }

  private adoptPath(a: Agent, gi: number, r: { cost: Float64Array; target: Int32Array }, cause: string) {
    if (r.target[gi] < 0) {
      a.pathValid = false;
      return;
    }
    const newCost = r.cost[gi];
    if (cause === 'node' && a.pathValid && a.pathGroup === gi) {
      const old = this.currentPathCost(a);
      if (Number.isFinite(old) && newCost > old - Math.max(8, 0.15 * old)) return; // keep current path (inertia)
      a.reroutes++;
      a.rerouteFlash = 2;
      if (a.reason !== REASON.CM && a.reason !== REASON.LED) a.reason = REASON.QUEUE;
    }
    this.setPath(a, this.extractPath(r.target[gi]));
    a.pathGroup = gi;
  }

  private setPath(a: Agent, p: { nodes: number[]; adj: number[] }) {
    a.pathNodes = p.nodes;
    a.pathAdj = p.adj;
    a.pathPos = 0;
    a.pathValid = p.nodes.length > 0;
    // seated agents: first node of the path tells which row end to use
    if (a.link < 0 && a.pathValid) {
      const L = this.sim.graph.links[this.sim.seatLink[a.id]];
      a.pendingRowDir = p.nodes[0] === L.a ? -1 : 1;
    }
  }

  /** Next link (adjacency index at `node`) along the agent's path; re-plans if necessary. */
  nextLink(a: Agent, node: number, _cameFrom: number): number {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (a.pathValid) {
        // locate node in path (normally at pathPos)
        let i = a.pathPos;
        if (a.pathNodes[i] !== node) {
          i = a.pathNodes.indexOf(node, Math.max(0, a.pathPos - 1));
        }
        if (i >= 0) {
          const k = a.pathAdj[i];
          const e = this.sim.graph.adj[node][k];
          if (!a.knownBlocked.includes(e.link)) {
            a.pathPos = i + 1;
            return k;
          }
        }
      }
      // off-path or invalid: re-plan from this node (as a routine decision: no U-turn)
      this.chooseExit(a, a.pathValid ? 'node' : 'info', node);
      if (!a.pathValid) return -1;
    }
    return -1;
  }

  isActive(a: Agent): boolean {
    return a.state !== ST.EXITED && a.state !== ST.AWAITING_ASSIST;
  }
}
