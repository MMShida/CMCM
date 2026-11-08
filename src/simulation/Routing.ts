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
 *
 * DYNAMIC BEHAVIOUR (cfg.adaptive.agents = true; docs/ADAPTIVE.md). Queues and aisle crowds are
 * visible only within the person's own room (component of the building without crossing a door)
 * or at the doors of that room - walls block the view (the previous model used straight-line
 * distance only). The same search additionally
 * records, for the best path to every node, the queue delay it OBSERVED (visible gates and aisle
 * crowds, in seconds) and whether any gate on it was visible. For exit group g:
 *   - if the EXIT DOOR of g is visible, the whole route is observed: the observation replaces the
 *     belief, B_ig = observed delay, learned now (confidence 1);
 *   - otherwise the unseen part comes from memory / communication with decay: the expected queue
 *     delay is max(observed, B_ig e^{-age/tau}) (no double counting: what is seen and what is
 *     remembered are not added), confidence c_ig = max(c0_g, e^{-age/tau}), c0 = 0.8 for the main
 *     entrance or familiar people, 0.5 otherwise; an observation larger than the belief updates it;
 *   U_ig(t) = -wT (1 + k u_i) T_ig/30 - wU (1 - c_ig) + wF (1 - k u_i) F_g + wS s_i S_ig
 *             + 3 wG (0.75 + 0.5 coop_i) G_ig + wI 1[g = current] + eps_ig
 *   P_i(g, t) = exp(U_ig) / sum_k exp(U_ik)   (eps_ig Gumbel: the persistent taste)
 * with u_i(t) urgency, s_i social susceptibility, coop_i cooperation tendency.
 * Anti-oscillation: a non-safety re-evaluation ('node', 'event', 'stuck') cannot change the exit
 * group within minCommit x (1 - u/2) s of the last change (closures, new instructions and the
 * first choice are exempt); the inertia term and the path-inertia rule add switching costs, and
 * returning within 30 s to the exit just abandoned costs the inertia penalty a second time.
 */
import type { Field } from '../geometry/NavigationGraph';
import { MinHeap, computeField } from '../geometry/NavigationGraph';
import { EXIT_GROUPS } from '../geometry/types';
import type { Agent } from './Agent';
import { REASON, ST } from './Agent';
import type { SimulationEngine } from './SimulationEngine';
import { ropeCost } from './Barriers';

/** persons per second through one walking lane at the reference speed (time-headway model, T = 0.7 s) */
const LANE_CAPACITY = 0.94;

/** auditorium doors D1-D9, foyer connections FC1-FC3 and orchestra access stairs: a -> b leads out */
export const OUTWARD_ONLY = /^(D\d|FC\d|OST_[A-Z]+)$/;

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
  /** adaptive: queue delay observed along the best path to each node, and visible gates on it */
  private obsDelay: Float64Array;
  private obsGates: Int32Array;
  /** adaptive: the exterior door at the end of the best path to each node was visible */
  private obsExit: Uint8Array;
  plansComputed = 0;
  private safeGroup: Int32Array;
  /** links used outward only by evacuees (auditorium doors, foyer connections, orchestra access stairs; a -> b is outward) */
  private outwardOnly: Uint8Array;
  /** exit group of the node just outside an exterior door (-1 for all other nodes) */
  private outsideGroup: Int32Array;
  /** nominal outdoor cost (s) from such a node to the street destination of its group */
  private outsideRest: Float64Array;

  constructor(sim: SimulationEngine) {
    this.sim = sim;
    const g = sim.graph;
    const n = g.nodes.length;
    this.dist = new Float64Array(n);
    this.predNode = new Int32Array(n);
    this.predAdj = new Int32Array(n);
    this.settled = new Uint8Array(n);
    this.obsDelay = new Float64Array(n);
    this.obsGates = new Int32Array(n);
    this.obsExit = new Uint8Array(n);
    this.safeGroup = Int32Array.from(g.nodes.map((nd) => (nd.exitGroup ? EXIT_GROUPS.indexOf(nd.exitGroup) : -1)));
    this.outwardOnly = Uint8Array.from(g.links.map((L) => (OUTWARD_ONLY.test(L.id) ? 1 : 0)));
    this.outsideGroup = new Int32Array(n).fill(-1);
    this.outsideRest = new Float64Array(n);
    const streetFields = g.safeByGroup.map((targets) => computeField(g, targets, (li) => g.links[li].prohibited));
    for (const L of g.links) {
      if (!L.exterior || L.exitGroup < 0) continue;
      this.outsideGroup[L.b] = L.exitGroup;
      const rest = streetFields[L.exitGroup].dist[L.b];
      this.outsideRest[L.b] = Number.isFinite(rest) ? rest : 0;
    }
  }

  /**
   * An agent still inside the building treats the node just beyond an exterior door as its goal
   * (the problem's definition of leaving the building, and the sink of Models B and C). The outdoor
   * remainder to the street enters the cost with weight routing.outdoorWeight.
   */
  private doorIsGoal(a: Agent): boolean {
    return a.inside && !a.wheelchair && a.meetNode < 0;
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
    const adaptive = !!cfg.adaptive?.agents;
    const info = adaptive ? cfg.adaptive.congestionInfo : 'local';
    // congestion information level (adaptive sensitivity): 'none' ignores queues, 'global' sees all (idealised)
    const qw = info === 'none' ? 0 : Math.min(4, w.queue / Math.max(0.2, w.time));
    const vis = info === 'global' ? Infinity : sim.visibilityRange;
    const anyFloor = info === 'global';
    const od = this.obsDelay;
    const og = this.obsGates;
    // adaptive: visibility needs the same room (walls block the view)
    const space = adaptive && info === 'local' ? sim.guidance.space : null;
    const mySpace = space ? sim.guidance.spaceOf(a) : -1;
    const oe = this.obsExit;
    if (adaptive) {
      od.fill(0);
      og.fill(0);
      oe.fill(0);
    }
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
    const doorGoal = this.doorIsGoal(a);
    const outW = cfg.routing.outdoorWeight;
    const aisleQ = info === 'none' ? 0 : cfg.routing.aisleQueueWeight ?? 0;
    const noReentry = cfg.routing.noReentry !== false;
    // node at which turning back onto the link just walked counts as a U-turn
    const uturnNode = fromNode !== null ? fromNode : a.link >= 0 ? (a.dir > 0 ? g.links[a.link].b : g.links[a.link].a) : -1;
    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (settled[u]) continue;
      settled[u] = 1;
      const nu = g.nodes[u];
      if (doorGoal && this.outsideGroup[u] >= 0) {
        const gi = this.outsideGroup[u];
        if (d < cost[gi]) {
          if (!Number.isFinite(cost[gi])) found++;
          cost[gi] = d;
          target[gi] = u;
          if (found >= need) break;
        }
        continue; // absorbing for agents still inside
      }
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
        if (L.isRow) {
          // Imanishi & Sano (2019): seatway use was observed in theatre drills. This is an
          // optional Model A sensitivity, not a change to widths, speeds or seated blockers.
          if (!cfg.crowdManagers.vacatedRowGuidance || a.cmGroup < 0 || a.wheelchair) continue;
          if (g.nodes[L.a].kind === 'deadEnd' || g.nodes[L.b].kind === 'deadEnd') continue;
          if (mv.rowSeatAgent[e.link].some(id => id >= 0)) continue;
          if (mv.dirCount[2 * e.link + (e.dir > 0 ? 1 : 0)] > 0) continue;
          if (Math.hypot(nu.x-a.x, nu.y-a.y) > vis || (space && space[u] !== mySpace)) continue;
        }
        if (u === uturnNode && e.link === noUturn) continue; // no spontaneous U-turn
        if (a.meetNode < 0 && g.climbs(e.link, e.dir)) continue; // evacuees do not climb a storey
        if (noReentry && a.meetNode < 0 && e.dir < 0 && this.outwardOnly[e.link]) continue; // no going back into the hall / orchestra
        if (known.length && known.includes(e.link)) continue;
        if (a.wheelchair && !L.accessible) continue;
        const v = e.other;
        if (settled[v]) continue;
        let c = g.nominalCost(e.link, e.dir, false) * ts;
        if (L.isRow) c = L.len / Math.max(0.05, Math.min(cfg.movement.rowSpeed, a.v0));
        c += ropeCost(cfg, L.id);
        let seen = 0;
        let delay = 0;
        if (L.gate) {
          const q = sim.gates.queueNow[e.link];
          const visible = (anyFloor || sim.nodeFloorDisp[u] === a.floor) && Math.hypot(nu.x - a.x, nu.y - a.y) <= vis + 0.5 * q && (!space || space[L.a] === mySpace || space[L.b] === mySpace);
          if (q > 0 && visible) {
            const capL = Math.max(0.2, sim.gates.cap[e.link]);
            c += (qw * q * (1 + narrowB * Math.max(0, (2 - L.width) / 2))) / capL;
            delay = q / capL;
          }
          if (visible && info !== 'none') seen = 1;
        }
        if (L.width < 2.6) {
          const opp = mv.dirCount[2 * e.link + (e.dir > 0 ? 1 : 0)];
          if (opp > 0) c += (cfPen * opp) / Math.max(1, L.lanes);
        }
        // visible crowd inside aisles / cross-aisles / passages: people walking or standing the same
        // way ahead delay you by about n / (lanes x lane capacity); seen like a gate queue
        if (aisleQ > 0 && !L.gate && (L.kind === 'aisle' || L.kind === 'crossAisle' || L.kind === 'passage')) {
          const dIdx = e.dir > 0 ? 0 : 1;
          const same = mv.dirCount[2 * e.link + dIdx];
          // lanes actually available to this direction (half of them when people come the other way)
          if (same > 1 && (anyFloor || sim.nodeFloorDisp[u] === a.floor) && Math.hypot(nu.x - a.x, nu.y - a.y) <= vis && (!space || space[u] === mySpace)) {
            c += (aisleQ * qw * same) / (mv.allowedLanes(e.link, dIdx) * LANE_CAPACITY);
            delay += same / (mv.allowedLanes(e.link, dIdx) * LANE_CAPACITY);
          }
        }
        if (doorGoal && this.outsideGroup[v] >= 0) c += outW * this.outsideRest[v] * ts;
        const nd = d + c;
        if (nd < dist[v]) {
          dist[v] = nd;
          predNode[v] = u;
          predAdj[v] = k;
          if (adaptive) {
            od[v] = od[u] + delay;
            og[v] = og[u] + seen;
            oe[v] = oe[u] | (seen && L.exterior ? 1 : 0);
          }
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
    const doorGoal = this.doorIsGoal(a);
    for (let i = a.pathPos; i < a.pathNodes.length; i++) {
      const e = g.adj[a.pathNodes[i]][a.pathAdj[i]];
      if (a.knownBlocked.includes(e.link)) return Infinity;
      c += g.nominalCost(e.link, e.dir, false) * ts;
      c += ropeCost(sim.cfg, g.links[e.link].id);
      if (g.links[e.link].gate) {
        const q = sim.gates.queueNow[e.link];
        if (q > 0) c += q / Math.max(0.2, sim.gates.cap[e.link]);
      }
      if (doorGoal && this.outsideGroup[e.other] >= 0) c += sim.cfg.routing.outdoorWeight * this.outsideRest[e.other] * ts;
      const L = g.links[e.link];
      if ((sim.cfg.routing.aisleQueueWeight ?? 0) > 0 && !L.gate && (L.kind === 'aisle' || L.kind === 'crossAisle' || L.kind === 'passage')) {
        const dIdx = e.dir > 0 ? 0 : 1;
        const same = sim.movement.dirCount[2 * e.link + dIdx];
        if (same > 1) c += (sim.cfg.routing.aisleQueueWeight * same) / (sim.movement.allowedLanes(e.link, dIdx) * LANE_CAPACITY);
      }
    }
    return c;
  }

  /**
   * Strategic + tactical decision. Picks the exit group (multinomial logit) and the path.
   * `cause`: 'start' (leaving the seat), 'node' (routine re-evaluation), 'info' (new information).
   */
  chooseExit(a: Agent, cause: 'start' | 'node' | 'info' | 'stuck' | 'event' | 'guidance', atNode: number | null = null): boolean {
    const sim = this.sim;
    const g0 = sim.graph;
    const prev = a.targetGroup;
    // an event after a long wait in a jam may turn the person round (as 'stuck')
    if (cause === 'event' && a.delaySince > 20) cause = 'stuck';
    // reuniting members walk to the meeting node
    if (a.meetNode >= 0) {
      const r = this.search(a, atNode);
      if (Number.isFinite(r.meetCost)) this.setPath(a, this.extractPath(a.meetNode));
      else a.pathValid = false;
      return false;
    }
    // routine re-evaluations never reverse onto the link just walked (prevents oscillation)
    const uturn = a.link >= 0 && cause !== 'info' && cause !== 'stuck' && !g0.links[a.link].isRow ? a.link : -1;
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
    if (a.group >= 0 && !a.groupLeader && !sim.groupBroken[a.group] && !sim.cfg.population.groupMeetOutside) {
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
    // dynamic behaviour: beliefs, confidence, urgency, susceptibility, cooperation
    const AD = sim.cfg.adaptive;
    const adaptive = !!AD?.agents;
    const expected = new Array(nG).fill(0);
    const conf: number[] = adaptive ? new Array(nG).fill(NaN) : [];
    const ku = adaptive ? AD.urgencyEffect * a.urgency : 0;
    for (let gi = 0; gi < nG; gi++) {
      terms.push([0, 0, 0, 0, 0]);
      if ((a.knownExits & (1 << gi)) === 0) continue;
      let T = r.cost[gi];
      if (!Number.isFinite(T)) continue;
      known++;
      let unc = 0;
      if (adaptive) {
        const tg = r.target[gi];
        const c0 = gi === 0 || a.familiar ? 0.8 : 0.5;
        const obs = this.obsDelay[tg];
        if (AD.congestionInfo !== 'none' && this.obsExit[tg]) {
          // the whole route is in sight: the observation replaces the belief
          a.belief[gi] = obs;
          a.beliefT[gi] = sim.t;
          conf[gi] = 1;
          expected[gi] = obs;
        } else {
          const age = sim.t - a.beliefT[gi];
          const fresh = Number.isFinite(age) && AD.congestionInfo !== 'none' ? Math.exp(-Math.max(0, age) / AD.memoryTau) : 0;
          const remembered = fresh > 0 ? a.belief[gi] * fresh : 0;
          // seen and remembered delays are not added: the larger one is expected
          T += Math.max(0, remembered - obs);
          conf[gi] = Math.max(c0, fresh);
          expected[gi] = Math.max(obs, remembered);
          if (AD.congestionInfo !== 'none' && this.obsGates[tg] > 0 && obs > remembered) {
            a.belief[gi] = obs;
            a.beliefT[gi] = sim.t;
          }
        }
        unc = -AD.uncertaintyWeight * (1 - conf[gi]);
      }
      const F = gi === 0 ? 1 : 0;
      const S = adaptive ? social[gi] * a.socialSus : social[gi];
      const cmOk = a.cmGroup === gi;
      const ledOk = a.ledGroup === gi;
      const asOk = a.assignGroup === gi;
      // guidance = share of the adopted instructions (Crowd Manager, LED, pre-assignment) pointing to gi
      const nSrc = (a.cmGroup >= 0 ? 1 : 0) + (a.ledGroup >= 0 ? 1 : 0) + (a.assignGroup >= 0 ? 1 : 0);
      const G = nSrc ? ((cmOk ? 1 : 0) + (ledOk ? 1 : 0) + (asOk ? 1 : 0)) / nSrc : 0;
      gSrc[gi] = cmOk ? REASON.CM : ledOk ? REASON.LED : asOk ? REASON.ASSIGNED : 0;
      const I = gi === prev ? 1 : 0;
      const gw = adaptive ? 0.75 + 0.5 * a.coop : 1;
      // hysteresis: going back within 30 s to the exit just abandoned costs the switching penalty again
      if (adaptive && gi === a.prevExit && gi !== prev && sim.t - a.prevSwitchT < 30) unc -= w.inertia;
      const t = [-w.time * (1 + ku) * (T / 30), w.familiarity * (1 - ku) * F, w.social * S, w.guidance * 3 * gw * G, w.inertia * I];
      terms[gi] = t;
      util[gi] = t[0] + t[1] + t[2] + t[3] + t[4] + unc;
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
      const v = util[gi] + (sim.cfg.routing.persistentTaste !== false && a.taste.length ? a.taste[gi] : sim.rngRoute.gumbel());
      if (v > bestV) {
        bestV = v;
        best = gi;
      }
    }
    if (adaptive) {
      // minimum commitment: routine / event reviews may not change the exit group too soon
      const commit = AD.minCommit * (1 - 0.5 * a.urgency);
      if (prev >= 0 && best !== prev && Number.isFinite(util[prev]) && (cause === 'node' || cause === 'event' || cause === 'stuck') && sim.t - a.lastSwitchT < commit) best = prev;
      if (best !== prev) a.lastSwitchT = sim.t;
      a.lastDecisionT = sim.t;
      a.expDelay = expected[best];
      a.delaySince = 0;
      a.confidence = conf.map((c) => (Number.isFinite(c) ? Math.round(c * 100) / 100 : NaN));
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
      if ((cause === 'event' || cause === 'stuck') && adaptive && prev >= 0 && prev !== best) a.reason = REASON.WAIT_EXCEEDED;
    }
    this.adoptPath(a, best, r, cause);
    if (prev >= 0 && prev !== best) {
      a.reroutes++;
      a.exitSwitches++;
      if (best === a.prevExit && sim.t - a.prevSwitchT < 30) a.flipFlops++;
      a.prevExit = prev;
      a.prevSwitchT = sim.t;
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
    if ((cause === 'node' || cause === 'stuck' || cause === 'event' || cause === 'guidance') && a.pathValid && a.pathGroup === gi) {
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

  /**
   * Queue delay (s) the agent can currently see on the rest of its planned path (visible gate
   * queues and aisle crowds, same rules as the search). Used for the 'worse than expected' event.
   */
  visibleQueueOnPath(a: Agent): number {
    if (!a.pathValid) return 0;
    const sim = this.sim;
    const g = sim.graph;
    const info = sim.cfg.adaptive?.congestionInfo ?? 'local';
    if (info === 'none') return 0;
    const vis = info === 'global' ? Infinity : sim.visibilityRange;
    const space = info === 'local' ? sim.guidance.space : null;
    const mySpace = space ? sim.guidance.spaceOf(a) : -1;
    let c = 0;
    for (let i = a.pathPos; i < a.pathNodes.length; i++) {
      const u = a.pathNodes[i];
      const nu = g.nodes[u];
      if (info !== 'global' && (sim.nodeFloorDisp[u] !== a.floor || Math.hypot(nu.x - a.x, nu.y - a.y) > vis + 20)) continue;
      const e = g.adj[u][a.pathAdj[i]];
      const L = g.links[e.link];
      if (space && space[L.a] !== mySpace && space[L.b] !== mySpace) continue;
      const d = Math.hypot(nu.x - a.x, nu.y - a.y);
      if (L.gate) {
        const q = sim.gates.queueNow[e.link];
        if (q > 0 && d <= vis + 0.5 * q) c += q / Math.max(0.2, sim.gates.cap[e.link]);
      } else if (L.kind === 'aisle' || L.kind === 'crossAisle' || L.kind === 'passage') {
        const dIdx = e.dir > 0 ? 0 : 1;
        const same = sim.movement.dirCount[2 * e.link + dIdx];
        if (same > 1 && d <= vis) c += same / (sim.movement.allowedLanes(e.link, dIdx) * LANE_CAPACITY);
      }
    }
    return c;
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
        // A completed indoor route has no continuation to street level. Its zero
        // remaining cost must not defeat replanning through the inertia threshold.
        if (i < 0 && this.sim.cfg.numerics?.replanMissingPath) a.pathValid = false;
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
