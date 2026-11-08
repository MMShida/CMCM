/**
 * Physical movement on the link network.
 *
 * Each link carries L lanes per travel direction (L = floor(width / laneWidth)).
 * Within a lane agents are ordered; a follower can never get closer to its
 * leader than the sum of their body radii (no overlap), and nobody passes the
 * end of a link without being admitted to the next one. Admission requires
 *   (1) the next link is physically open (blocked exits / barriers refuse entry),
 *   (2) a gate token if the next link is a door or stair entry (capacity C),
 *   (3) free space at the entrance of some lane of the next link.
 * Competing entrants at a node are served in a randomised zipper order
 * (alternating incoming links), with a priority bonus for impatient agents.
 *
 * Desired speed:  v_des = v0_i * terrain * env * f_Weidmann(rho_local)  (rows: min(v0, 0.45 m/s))
 * Relaxation:     v <- v + (v_des - v) * min(1, dt/tau)
 * Seat rows: passing a person who is still seated (or standing collecting belongings) is only
 * possible at the squeeze speed and makes that person aware of the evacuation.
 */
import type { NavGraph } from '../geometry/NavigationGraph';
import type { Agent } from './Agent';
import { ST } from './Agent';
import { weidmannFactor } from './Congestion';
import type { SimulationEngine } from './SimulationEngine';

export class MovementSystem {
  readonly sim: SimulationEngine;
  readonly g: NavGraph;
  /** lanes[link][dirIdx][lane] = agent ids sorted by sDir descending (head first) */
  readonly lanes: number[][][][];
  readonly linkCount: Int32Array;
  /** agents per link and travel direction (index 2*link + dirIdx) */
  readonly dirCount: Int32Array;
  /** physically closed links (blocked exits, barriers) */
  readonly closed: Uint8Array;
  readonly rowSeatS: Float64Array[];
  readonly rowSeatAgent: Int32Array[];
  readonly seatSlot: Int32Array; // agent -> index in rowSeatAgent of its row
  readonly lastServed: Int32Array;
  /** maximum number of persons on a link (both directions) */
  readonly occCap: Int32Array;
  private nodeReq: number[][];
  private reqNodes: number[] = [];
  private overshoot: Float64Array;
  private startPosition: Float64Array;
  private tmp = new Float64Array(2);

  constructor(sim: SimulationEngine) {
    this.sim = sim;
    this.g = sim.graph;
    const g = this.g;
    this.lanes = g.links.map((L) => [0, 1].map(() => Array.from({ length: L.lanes }, () => [] as number[])));
    this.linkCount = new Int32Array(g.links.length);
    this.dirCount = new Int32Array(2 * g.links.length);
    this.closed = new Uint8Array(g.links.length);
    this.lastServed = new Int32Array(g.nodes.length).fill(-1);
    const cap = sim.cfg.movement.maxDensity;
    this.occCap = Int32Array.from(g.links.map((L) => (L.isRow ? 1000 : Math.max(L.lanes, Math.floor(L.len * L.geomScale * L.width * cap)))));
    this.nodeReq = g.nodes.map(() => []);
    this.overshoot = new Float64Array(sim.agents.length);
    this.startPosition = new Float64Array(sim.agents.length);
    // seat occupancy along rows
    const seatsByLink: Map<number, { s: number; agent: number }[]> = new Map();
    for (const a of sim.agents) {
      const li = sim.seatLink[a.id];
      const seat = sim.geo.seats[a.seat];
      let arr = seatsByLink.get(li);
      if (!arr) seatsByLink.set(li, (arr = []));
      arr.push({ s: seat.s, agent: a.id });
    }
    this.rowSeatS = g.links.map(() => new Float64Array(0));
    this.rowSeatAgent = g.links.map(() => new Int32Array(0));
    this.seatSlot = new Int32Array(sim.agents.length).fill(-1);
    for (const [li, arr] of seatsByLink) {
      arr.sort((x, y) => x.s - y.s);
      this.rowSeatS[li] = Float64Array.from(arr.map((x) => x.s));
      this.rowSeatAgent[li] = Int32Array.from(arr.map((x) => x.agent));
      arr.forEach((x, k) => (this.seatSlot[x.agent] = k));
    }
  }

  laneOffset(li: number, lane: number, dir: number): number {
    const L = this.g.links[li];
    if (L.lanes <= 1) return 0;
    const w = Math.min(L.width, L.lanes * 0.75);
    const base = (lane + 0.5) * (w / L.lanes) - w / 2;
    return dir > 0 ? -base : base;
  }

  /** Insert agent at the tail (entrance) of a lane. */
  protected pushTail(li: number, dirIdx: number, lane: number, id: number) {
    this.lanes[li][dirIdx][lane].push(id);
    this.linkCount[li]++;
    this.dirCount[2 * li + dirIdx]++;
  }

  protected removeFromLane(a: Agent) {
    const arr = this.lanes[a.link][a.dir > 0 ? 0 : 1][a.lane];
    const k = arr.indexOf(a.id);
    if (k >= 0) arr.splice(k, 1);
    this.linkCount[a.link]--;
    this.dirCount[2 * a.link + (a.dir > 0 ? 0 : 1)]--;
  }

  /** Place an agent on a link at an arbitrary position (used for separated group members). */
  placeAt(a: Agent, li: number, dir: 1 | -1, sDir: number): boolean {
    const dirIdx = dir > 0 ? 0 : 1;
    const lanes = this.lanes[li][dirIdx];
    for (let lane = 0; lane < lanes.length; lane++) {
      const arr = lanes[lane];
      let ok = true;
      let pos = arr.length;
      for (let k = 0; k < arr.length; k++) {
        const b = this.sim.agents[arr[k]];
        if (Math.abs(b.sDir - sDir) < a.radius + b.radius + 0.05) {
          ok = false;
          break;
        }
        if (b.sDir < sDir && pos === arr.length) pos = k;
      }
      if (!ok) continue;
      arr.splice(pos, 0, a.id);
      this.linkCount[li]++;
      this.dirCount[2 * li + dirIdx]++;
      a.link = li;
      a.dir = dir;
      a.sDir = sDir;
      a.lane = lane;
      a.latOffset = this.laneOffset(li, lane, dir);
      return true;
    }
    return false;
  }

  /** Remove a stranded agent from its lane (it stays where it is, off the walking line). */
  stepAside(a: Agent) {
    if (a.link < 0) return;
    this.removeFromLane(a);
    a.link = -1;
    a.v = 0;
    a.x += 0.3;
  }

  /** Try to step from the seat into the row lane. */
  tryEnterRow(a: Agent): boolean {
    const sim = this.sim;
    const li = sim.seatLink[a.id];
    const L = this.g.links[li];
    const seat = sim.geo.seats[a.seat];
    const d = a.pendingRowDir;
    const dirIdx = d > 0 ? 0 : 1;
    const sDirSeat = d > 0 ? seat.s : L.len - seat.s;
    const arr = this.lanes[li][dirIdx][0];
    const yieldGap = a.typeCode === 4 ? 0.9 : a.typeCode === 5 ? 0.05 : 0.3;
    let pos = arr.length;
    for (let k = 0; k < arr.length; k++) {
      const b = sim.agents[arr[k]];
      const need = a.radius + b.radius;
      const ds = b.sDir - sDirSeat;
      if (ds >= 0 && ds < need) { sim.movementObserver?.block(a.id,'row-insertion-gap',sim.cfg.movement.dt,li); return false; } // someone right in front of the seat
      if (ds < 0 && -ds < need + yieldGap) { sim.movementObserver?.block(a.id,'row-insertion-yield',sim.cfg.movement.dt,li); return false; } // someone coming: let them pass
      if (ds < 0 && pos === arr.length) pos = k;
    }
    arr.splice(pos, 0, a.id);
    this.linkCount[li]++;
    this.dirCount[2 * li + dirIdx]++;
    a.link = li;
    a.dir = d;
    a.sDir = sDirSeat;
    a.lane = 0;
    a.v = 0;
    a.state = a.meetNode >= 0 ? ST.REUNITING : ST.MOVING;
    if (Number.isNaN(a.tStartMove)) a.tStartMove = sim.t;
    const slot = this.seatSlot[a.id];
    if (slot >= 0) this.rowSeatAgent[li][slot] = -1;
    a.lastNode = -1;
    sim.progress();
    return true;
  }

  /** Is someone still seated / standing in place within [s0, s1] (absolute) on a row? */
  private seatedBlocker(li: number, s0: number, s1: number, self: number): number {
    const S = this.rowSeatS[li];
    const Ag = this.rowSeatAgent[li];
    for (let k = 0; k < S.length; k++) {
      const s = S[k];
      if (s < s0) continue;
      if (s > s1) break;
      const id = Ag[k];
      if (id >= 0 && id !== self) return id;
    }
    return -1;
  }

  step(dt: number) {
    const sim = this.sim;
    const g = this.g;
    const A = sim.agents;
    const cfg = sim.cfg;
    const M = cfg.movement;
    const dens = sim.density;
    const gates = sim.gates;
    const env = sim.envSpeed;
    const relax = cfg.simplification?.instantAcceleration ? 1 : Math.min(1, dt / M.tau);
    const useWeidmann = M.speedModel === 'weidmann';
    const synchronousHeadway = !!cfg.numerics?.synchronousHeadway;
    if (synchronousHeadway) for (const a of A) this.startPosition[a.id] = a.sDir;

    // ---- 1. density bins --------------------------------------------------
    dens.clearList(this.prevActive);
    this.prevActive.length = 0;
    for (let li = 0; li < g.links.length; li++) if (this.linkCount[li] > 0) this.prevActive.push(li);
    for (let li = 0; li < g.links.length; li++) {
      if (this.linkCount[li] === 0) continue;
      const L = g.links[li];
      for (let d = 0; d < 2; d++) {
        const lanes = this.lanes[li][d];
        for (let ln = 0; ln < lanes.length; ln++) {
          const arr = lanes[ln];
          for (let k = 0; k < arr.length; k++) {
            const a = A[arr[k]];
            dens.add(li, d === 0 ? a.sDir : L.len - a.sDir, d === 0 ? 1 : -1);
          }
        }
      }
    }
    gates.refill(dt, sim.t);
    gates.resetQueueCounts();

    // ---- 2. longitudinal movement (leader first) ------------------------------
    for (let li = 0; li < g.links.length; li++) {
      if (this.linkCount[li] === 0) continue;
      const L = g.links[li];
      const isRow = L.isRow;
      let terrain = 1;
      for (let d = 0; d < 2; d++) {
        const dirSign = d === 0 ? 1 : -1;
        const lanes = this.lanes[li][d];
        for (let ln = 0; ln < lanes.length; ln++) {
          const arr = lanes[ln];
          let leader: Agent | null = null;
          for (let k = 0; k < arr.length; k++) {
            const a = A[arr[k]];
            const sAbs = dirSign > 0 ? a.sDir : L.len - a.sDir;
            if (a.state === ST.FALLEN) {
              a.fallTimer -= dt;
              a.v = 0;
              if (a.fallTimer <= 0) {
                a.state = ST.MOVING;
                a.v0 *= 0.85;
              }
              leader = a;
              continue;
            }
            // desired speed
            let vd = a.v0 * env;
            if (L.isStair) {
              const up = (L.drop > 0 && dirSign < 0) || (L.drop < 0 && dirSign > 0);
              terrain = up ? a.stairRatioUp : a.stairRatio;
              if (L.outdoorStair) terrain *= cfg.environment.outdoorStairFactor;
              vd *= terrain;
            }
            if (isRow) {
              sim.movementObserver?.limit(a.id,'row-cap',vd,Math.min(vd,M.rowSpeed),dt,li);
              vd = Math.min(vd, M.rowSpeed);
              const look = 0.38;
              const s0 = dirSign > 0 ? sAbs + 0.05 : sAbs - look;
              const s1 = dirSign > 0 ? sAbs + look : sAbs - 0.05;
              const blk = this.seatedBlocker(li, s0, s1, a.id);
              if (blk >= 0 && !cfg.simplification?.clearRows) {
                sim.movementObserver?.limit(a.id,'seated-squeeze',vd,Math.min(vd,M.squeezeSpeed),dt,li);
                vd = Math.min(vd, M.squeezeSpeed);
                sim.cueByPassing(blk);
              }
            } else if (useWeidmann) {
              const rho = dens.densityAhead(li, sAbs, dirSign, M.counterflowFriction);
              a.densityHere = rho;
              vd *= weidmannFactor(rho, M.weidmannGamma, M.weidmannRhoMax);
            } else {
              // headway model: area density only used for counterflow friction and metrics
              const rho = dens.densityAhead(li, sAbs, dirSign, 1);
              a.densityHere = rho;
              const opp = dens.densityAhead(li, sAbs, dirSign, 1) - dens.densityAhead(li, sAbs, dirSign, 0);
              if (opp > 0) { sim.movementObserver?.limit(a.id,'counterflow',vd,vd/(1+M.counterflowFriction*opp),dt,li); vd /= 1 + M.counterflowFriction * opp; }
            }
            // group cohesion (cap refreshed every 0.5 s)
            if (a.group >= 0) {
              if (sim.cohesionTick) a.groupCap = sim.groupSpeedCap(a);
              if (a.groupCap < vd) { sim.movementObserver?.limit(a.id,a.groupCap<=0.300001?'group-cohesion':'group-pace',vd,a.groupCap,dt,li); vd = a.groupCap; }
            }
            if (a.hesitate > 0) {
              a.hesitate -= dt;
              sim.movementObserver?.limit(a.id,'hesitation',vd,Math.min(vd,0.15),dt,li);
              vd = Math.min(vd, 0.15);
            }
            if (a.state < ST.MOVING) vd = 0; // standing on a link but not yet started (separated members)
            const vFree = vd;
            let blockedBy = -1;
            // following model: v <= (h - d_min) / T  (h = distance to the leader in the lane)
            if (leader && !useWeidmann) {
              const dmin = a.radius + leader.radius;
              const leaderS = synchronousHeadway ? this.startPosition[leader.id] : leader.sDir;
              const vh = (leaderS - a.sDir - dmin) / M.timeHeadway;
              if (vh < vd) {
                sim.movementObserver?.limit(a.id,'following-headway',vd,Math.max(0,vh),dt,li);
                vd = Math.max(0, vh);
                if (vd < 0.3 * vFree) blockedBy = leader.id;
              }
            }
            a.vDes = vFree;
            let v = a.v + (vd - a.v) * relax;
            if (v > vd) v = vd; // braking is immediate (no overlap)
            if (v < 0) v = 0;
            sim.movementObserver?.limit(a.id,'acceleration',vd,v,dt,li);
            let sNew = a.sDir + v * dt;
            if (leader) {
              const maxS = leader.sDir - (a.radius + leader.radius);
              if (sNew > maxS) {
                sNew = Math.max(a.sDir, maxS);
                blockedBy = leader.id;
              }
            }
            let atEnd = false;
            if (sNew >= L.len) {
              this.overshoot[a.id] = sNew - L.len;
              sNew = L.len;
              atEnd = true;
            }
            const moved = sNew - a.sDir;
            a.v = moved / dt;
            a.sDir = sNew;
            if (moved > 1e-4) sim.progress();
            // queue state (relative to the free desired speed)
            const slow = a.v < 0.3 * vFree || (atEnd && a.v < 0.05);
            if (slow && vFree > 0.05) a.blockedTime += dt;
            else a.blockedTime = 0;
            if (a.state === ST.MOVING || a.state === ST.QUEUING || a.state === ST.REROUTING || a.state === ST.ASSISTING) {
              if (a.blockedTime > 0.6) a.state = leader && leader.state === ST.FALLEN && a.typeCode === 4 ? ST.ASSISTING : ST.QUEUING;
              else a.state = a.rerouteFlash > 0 ? ST.REROUTING : ST.MOVING;
            }
            if (blockedBy >= 0) {
              const lw = A[blockedBy].waitTarget;
              a.waitTarget = lw >= 0 ? lw : -1;
            } else if (!atEnd) a.waitTarget = -1;
            if (a.blockedTime > 0.6 && a.waitTarget >= 0 && gates.isGate[a.waitTarget]) {
              gates.queueNow[a.waitTarget]++;
              gates.impatienceSum[a.waitTarget] += a.impatience;
              gates.waitSum[a.waitTarget] += dt;
              a.waitTotal += dt;
            }
            // falls (stress test, simplified)
            if (sim.cfg.stress.falls && L.isStair && a.v > 0.2) {
              const rho = a.densityHere;
              const p = sim.cfg.stress.fallRate * dt * Math.max(0, rho - 0.5) * a.v;
              if (sim.rngDyn.random() < p) sim.fall(a);
            }
            if (atEnd) this.request(a, dirSign > 0 ? L.b : L.a);
            leader = a;
          }
        }
      }
    }

    // ---- 3. transitions at nodes ------------------------------------------------
    for (const n of this.reqNodes) {
      const req = this.nodeReq[n];
      if (req.length > 1) {
        const last = this.lastServed[n];
        const urg = M.urgency;
        const pri = req.map((id) => {
          const a = A[id];
          return sim.rngDyn.random() * 0.6 + (a.link !== last ? 0.4 : 0) + urg * a.impatience * 0.3 - (a.typeCode === 4 ? 0.15 : 0);
        });
        const order = req.map((_, k) => k).sort((x, y) => pri[y] - pri[x]);
        const sorted = cfg.simplification?.fifoMerges
          ? [...req].sort((x,y)=>A[y].blockedTime-A[x].blockedTime || x-y)
          : order.map((k) => req[k]);
        for (const id of sorted) this.attempt(A[id], n, dt);
      } else if (req.length === 1) this.attempt(A[req[0]], n, dt);
      req.length = 0;
    }
    this.reqNodes.length = 0;

    // ---- 4. lane changes on multi-lane links -------------------------------------
    for (let li = 0; li < g.links.length; li++) {
      if (this.linkCount[li] < 2) continue;
      const L = g.links[li];
      if (L.lanes < 2) continue;
      for (let d = 0; d < 2; d++) {
        const lanes = this.lanes[li][d];
        for (let ln = 0; ln < lanes.length; ln++) {
          const arr = lanes[ln];
          for (let k = 1; k < arr.length; k++) {
            const a = A[arr[k]];
            if (a.blockedTime < 0.4 || a.state === ST.FALLEN) continue;
            // lane-change attempt rate 1.5 (0.5 + impatience) per second (dt-independent)
            if (sim.rngDyn.random() > Math.min(1, 1.5 * (0.5 + a.impatience) * dt)) continue;
            const target = ln + (sim.rngDyn.random() < 0.5 ? -1 : 1);
            if (target < 0 || target >= this.allowedLanes(li, d)) continue;
            const tl = lanes[target];
            let pos = tl.length;
            let ok = true;
            const myAhead = A[arr[k - 1]];
            for (let q = 0; q < tl.length; q++) {
              const b = A[tl[q]];
              const ds = b.sDir - a.sDir;
              if (ds >= 0 && ds < a.radius + b.radius + 0.15) ok = false;
              if (ds < 0 && -ds < a.radius + b.radius) ok = false;
              if (!ok) break;
              if (ds < 0 && pos === tl.length) pos = q;
            }
            if (!ok) continue;
            // only worth it if the target lane gives more room ahead
            const aheadT = pos > 0 ? A[tl[pos - 1]].sDir : Infinity;
            if (aheadT - a.sDir <= myAhead.sDir - a.sDir + 0.2) continue;
            arr.splice(k, 1);
            tl.splice(pos, 0, a.id);
            a.lane = target;
            k--;
          }
        }
      }
    }
  }

  private prevActive: number[] = [];

  private request(a: Agent, node: number) {
    const req = this.nodeReq[node];
    if (req.length === 0) this.reqNodes.push(node);
    req.push(a.id);
  }

  /** Choose the lane of link li (direction dirIdx) with the largest entry gap. */
  /**
   * Lanes a direction may use: all of them, or - when people walk the other way on the
   * same link - only the walker's own half (each direction keeps to its left-hand stripe,
   * so opposing circles never overlap).
   */
  allowedLanes(li: number, dirIdx: number): number {
    const n = this.g.links[li].lanes;
    return this.dirCount[2 * li + (1 - dirIdx)] > 0 ? Math.max(1, Math.ceil(n / 2)) : n;
  }

  /**
   * Is someone at the far end of link li walking towards us who wants to enter our link?
   * Then the two squeeze past each other and the occupancy cap is waived (prevents
   * head-on deadlocks in narrow aisles).
   */
  private opposingSwap(li: number, dirIdx: number, fromLink: number): boolean {
    const L = this.g.links[li];
    const opp = this.lanes[li][1 - dirIdx];
    for (const arr of opp) {
      if (!arr.length) continue;
      const head = this.sim.agents[arr[0]];
      if (head.sDir >= L.len - 0.05 && head.pendingNext >= 0) {
        const n = head.dir > 0 ? L.b : L.a;
        const e = this.g.adj[n][head.pendingNext];
        if (e && e.link === fromLink) return true;
      }
    }
    return false;
  }

  private pickLane(li: number, dirIdx: number, a: Agent): { lane: number; gap: number } {
    const lanes = this.lanes[li][dirIdx];
    let best = -1;
    let bestScore = -Infinity;
    let bestGap = -1;
    const A = this.sim.agents;
    // total occupancy cap (both directions): no more than occCap persons per m^2 of floor
    const occ = this.linkCount[li];
    if (occ >= this.occCap[li] && (occ > this.occCap[li] || !this.opposingSwap(li, dirIdx, a.link))) return { lane: -1, gap: -1 };
    const nAllowed = this.allowedLanes(li, dirIdx);
    for (let ln = 0; ln < nAllowed; ln++) {
      const arr = lanes[ln];
      let gap = Infinity;
      if (arr.length) {
        const tail = A[arr[arr.length - 1]];
        gap = tail.sDir - (tail.radius + a.radius);
      }
      // last resort against gridlock: after 20 s blocked, squeeze in where there is most room
      if (gap < 0 && a.blockedTime > 20) gap = 0.01 + gap * 1e-3;
      if (gap < 0) continue;
      const off = this.laneOffset(li, ln, dirIdx === 0 ? 1 : -1);
      const score = Math.min(gap, 3) - 0.3 * Math.abs(off - a.latOffset);
      if (score > bestScore) {
        bestScore = score;
        best = ln;
        bestGap = gap;
      }
    }
    return { lane: best, gap: bestGap };
  }

  /** Attempt to move agent a (at the end of its link) through node n. */
  private attempt(a: Agent, n: number, dt: number): boolean {
    const sim = this.sim;
    const g = this.g;
    const node = g.nodes[n];
    const cur = a.link;
    const curL = g.links[cur];
    if (a.lastNode !== n) {
      a.lastNode = n;
      a.pendingNext = -1;
      sim.onArrive(a, n, cur);
      if (a.done) return true;
    }
    if (node.kind === 'safe') {
      this.removeFromLane(a);
      sim.markSafe(a, n);
      this.lastServed[n] = cur;
      return true;
    }
    if (node.kind === 'refuge') {
      this.removeFromLane(a);
      sim.markAwaitingAssist(a, n);
      return true;
    }
    if (a.holdAtNode) {
      a.waitTarget = -1;
      sim.movementObserver?.block(a.id,'group-hold',dt,cur);
      return false;
    }
    let k = a.pendingNext;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (k < 0) k = sim.routing.nextLink(a, n, cur);
      if (k < 0) {
        sim.movementObserver?.block(a.id,'no-route',dt,cur);
        sim.noRoute(a, n, dt);
        a.pendingNext = -1;
        return false;
      }
      const e = g.adj[n][k];
      if (this.closed[e.link]) {
        // physical discovery of an obstruction
        sim.discoverBlocked(a, e.link, n);
        k = -1;
        continue;
      }
      break;
    }
    if (k < 0) return false;
    a.pendingNext = k;
    a.noRouteTime = 0;
    if (a.state === ST.TRAPPED) a.state = ST.MOVING;
    const e = g.adj[n][k];
    const NL = g.links[e.link];
    if (NL.gate && !sim.gates.canPass(e.link)) {
      sim.movementObserver?.block(a.id,'gate-service',dt,e.link);
      a.waitTarget = e.link;
      sim.reconsiderWhileWaiting(a, n);
      return false;
    }
    const dirIdx = e.dir > 0 ? 0 : 1;
    const { lane, gap } = this.pickLane(e.link, dirIdx, a);
    if (lane < 0) {
      sim.movementObserver?.block(a.id,this.linkCount[e.link]>=this.occCap[e.link]?'storage':'lane-entry-gap',dt,e.link);
      a.waitTarget = NL.gate ? e.link : this.tailWaitTarget(e.link, dirIdx);
      sim.reconsiderWhileWaiting(a, n);
      return false;
    }
    // ---- commit ----
    this.removeFromLane(a);
    if (NL.gate) sim.gates.consume(e.link, sim.t);
    else sim.gates.passes[e.link]++;
    a.link = e.link;
    a.dir = e.dir;
    a.sDir = Math.max(0, Math.min(this.overshoot[a.id], gap));
    if (sim.cfg.numerics?.preserveTransitVelocity) {
      // Movement on the new link belongs to this same step. The legacy code
      // retained only the old-link displacement, causing a spurious deceleration.
      // Short links retain at most their length; another admission needs a new step.
      a.sDir = Math.min(a.sDir, NL.len);
      a.v += a.sDir / dt;
    }
    a.lane = lane;
    this.pushTail(e.link, dirIdx, lane, a.id);
    a.pendingNext = -1;
    a.waitTarget = -1;
    this.lastServed[n] = cur;
    if (NL.exterior) a.exitLink = e.link;
    sim.movementObserver?.transition(a.id,cur,e.link,a.v,a.sDir,dt);
    sim.recordTraversal(a, cur, e.link);
    sim.progress();
    void curL;
    return true;
  }

  private tailWaitTarget(li: number, dirIdx: number): number {
    const lanes = this.lanes[li][dirIdx];
    for (const arr of lanes) {
      if (!arr.length) continue;
      const t = this.sim.agents[arr[arr.length - 1]];
      if (t.waitTarget >= 0) return t.waitTarget;
    }
    return -1;
  }

  /** Update xy positions (and display floor) for all agents on links. */
  updatePositions(dt: number) {
    const sim = this.sim;
    const g = this.g;
    const A = sim.agents;
    const out = this.tmp;
    const ease = Math.min(1, dt / 0.35);
    for (let li = 0; li < g.links.length; li++) {
      if (this.linkCount[li] === 0) continue;
      const L = g.links[li];
      const fa = sim.nodeFloorDisp[L.a];
      const fb = sim.nodeFloorDisp[L.b];
      for (let d = 0; d < 2; d++) {
        const lanes = this.lanes[li][d];
        for (let ln = 0; ln < lanes.length; ln++) {
          const arr = lanes[ln];
          for (let k = 0; k < arr.length; k++) {
            const a = A[arr[k]];
            const sAbs = d === 0 ? a.sDir : L.len - a.sDir;
            const target = this.laneOffset(li, ln, d === 0 ? 1 : -1);
            a.latOffset += (target - a.latOffset) * ease;
            a.segHint = g.pointAt(li, sAbs, a.latOffset, out, a.segHint);
            a.x = out[0];
            a.y = out[1];
            a.floor = fa === fb ? fa : sAbs / L.len < 0.5 ? fa : fb;
          }
        }
      }
    }
  }
}
