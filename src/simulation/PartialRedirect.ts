/**
 * Partial, capacity-sized redirection by Crowd Managers who see the whole building
 * (adaptive.redirectMode = 'partial'; MODEL A ONLY - Model B keeps the zone rule).
 *
 * Premise (project decision): from their posts the managers see every queue, where everyone is and
 * where everyone is heading; they all know the same plan and the same state, so they agree. They
 * do not move a whole planned exit: every review (adaptive.decisionInterval) they move individual
 * people (a group leader with the group) whose OWN exit time is clearly earlier via another exit.
 *
 * Exit-time model (what the managers predict). Every bottleneck k (a gate, or a set of parallel
 * doors close together, see Guidance.setupResources) is a first-come-first-served fluid queue with
 * capacity c_k: everybody heading through k is put in arrival order (arrival = start delay + walk
 * at the crowd's current speed), departures d_i = max(a_i, d_{i-1}) + 1 / c_k. A person's exit time
 * along a route is chained door by door:
 *
 *   time = start;  for each bottleneck on the route: time = depart_k(time + walk to k);  exit = time + walk after
 *
 * with depart_k(a) = max(a, departure of the last person arriving before a) + w / c_k (w = 1 + group
 * members). The person is moved to the alternative with the earliest exit if it is earlier than
 * staying by more than adaptive.redirectMargin; the queues are then updated (removed from the old
 * route, inserted in the new one), so later decisions see the effect. People are considered from
 * the latest predicted exit down. For one exit with an empty alternative this moves
 * n* = (Q_a/c_a - dw) / (1/c_a + 1/c_b) people (tests/adaptive.test.ts).
 */

/** first-come-first-served fluid queue of one bottleneck */
export class FluidQueue {
  arr: number[] = [];
  ids: number[] = [];
  w: number[] = [];
  dep: number[] = [];
  constructor(public cap: number) {}

  add(a: number, id: number, w = 1) {
    this.arr.push(a);
    this.ids.push(id);
    this.w.push(w);
  }

  /** sort by arrival and compute departures */
  build() {
    const o = this.arr.map((_, i) => i).sort((x, y) => this.arr[x] - this.arr[y] || this.ids[x] - this.ids[y]);
    this.arr = o.map((i) => this.arr[i]);
    this.ids = o.map((i) => this.ids[i]);
    this.w = o.map((i) => this.w[i]);
    this.recompute();
  }

  private recompute() {
    let d = -Infinity;
    this.dep = new Array(this.arr.length);
    for (let i = 0; i < this.arr.length; i++) {
      d = Math.max(this.arr[i], d) + this.w[i] / this.cap;
      this.dep[i] = d;
    }
  }

  /**
   * departure of a person arriving at a (weight w), ignoring the entries of `self`; people arriving
   * at the same moment are ahead only if their id is below `tieBefore` (a person keeps their place)
   */
  departIf(a: number, w: number, self?: Set<number>, tieBefore = Infinity): number {
    // last entry (of somebody else) arriving no later than a
    let lo = 0;
    let hi = this.arr.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.arr[mid] <= a) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    while (idx >= 0 && ((self && self.has(this.ids[idx])) || (this.arr[idx] === a && this.ids[idx] >= tieBefore))) idx--;
    const before = idx >= 0 ? this.dep[idx] : -Infinity;
    return Math.max(a, before) + w / this.cap;
  }

  insert(a: number, id: number, w = 1) {
    let i = this.arr.length;
    while (i > 0 && this.arr[i - 1] > a) i--;
    this.arr.splice(i, 0, a);
    this.ids.splice(i, 0, id);
    this.w.splice(i, 0, w);
    this.recompute();
  }

  remove(ids: Set<number>) {
    let changed = false;
    for (let i = this.arr.length - 1; i >= 0; i--)
      if (ids.has(this.ids[i])) {
        this.arr.splice(i, 1);
        this.ids.splice(i, 1);
        this.w.splice(i, 1);
        changed = true;
      }
    if (changed) this.recompute();
  }
}

/** a route as the managers see it: bottlenecks with the walking time from the previous one */
export interface PlanRoute {
  to: number;
  stops: { k: number; walk: number }[];
  /** walking time after the last bottleneck until the person is out of the building */
  tail: number;
}

export interface RedirectCandidate {
  /** person id (the leader) and the ids of the group members moving with them */
  ids: number[];
  /** time until the person starts / continues walking (s from now) */
  start: number;
  stay: PlanRoute;
  alt: PlanRoute[];
}

/** predicted exit time (s from now) along a route; `self` = the person's own queue entries */
export function exitTime(qs: FluidQueue[], r: PlanRoute, start: number, w: number, self?: Set<number>, tieBefore = Infinity, own?: Set<number>): number {
  let time = start;
  // the person keeps their place only in the queues they are already in (own); elsewhere they join at the back of their arrival time
  for (const s of r.stops) time = qs[s.k].departIf(time + s.walk, w, self, own && own.has(s.k) ? tieBefore : Infinity);
  return time + r.tail;
}

/** unchained arrival times at the bottlenecks of a route (how everybody's load is entered) */
export function arrivals(r: PlanRoute, start: number): number[] {
  const out: number[] = [];
  let time = start;
  for (const s of r.stops) {
    time += s.walk;
    out.push(time);
  }
  return out;
}

/**
 * Builds everybody's load at the bottlenecks. Pass 1 uses unchained arrivals (walk only); each
 * further pass chains them through the queues of the previous pass (arrival at the next bottleneck
 * = own departure from the previous one + walk), so people held back at an upstream door do not
 * appear to arrive early at the doors behind it. Returns the queues of the last pass.
 */
export function buildLoad(caps: number[], people: { id: number; start: number; route: PlanRoute }[], passes = 2): FluidQueue[] {
  let qs = caps.map((c) => new FluidQueue(c));
  for (const p of people) arrivals(p.route, p.start).forEach((a, n) => qs[p.route.stops[n].k].add(a, p.id, 1));
  for (const q of qs) q.build();
  for (let pass = 1; pass < passes; pass++) {
    const next = caps.map((c) => new FluidQueue(c));
    for (const p of people) {
      const self = new Set([p.id]);
      let time = p.start;
      for (const st of p.route.stops) {
        const a = time + st.walk;
        next[st.k].add(a, p.id, 1);
        time = qs[st.k].departIf(a, 1, self, p.id);
      }
    }
    for (const q of next) q.build();
    qs = next;
  }
  return qs;
}

/** see the file comment; returns the number of instructions given (asked) and adopted (moved) */
export function balanceRedirects(
  qs: FluidQueue[],
  cands: RedirectCandidate[],
  margin: number,
  tryMove: (i: number, to: number, finish: number, stay: number) => boolean,
  maxAsk = Infinity,
): { asked: number; moved: number } {
  const self = cands.map((c) => new Set(c.ids));
  const tie = cands.map((c) => Math.min(...c.ids));
  const own = cands.map((c) => new Set(c.stay.stops.map((s) => s.k)));
  const stayOf = (i: number) => exitTime(qs, cands[i].stay, cands[i].start, cands[i].ids.length, self[i], tie[i], own[i]);
  const order = cands.map((_, i) => [stayOf(i), i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  let asked = 0;
  let moved = 0;
  for (const [, i] of order) {
    if (asked >= maxAsk) break;
    const c = cands[i];
    const w = c.ids.length;
    const stay = stayOf(i);
    let best = -1;
    let bestF = Infinity;
    for (let j = 0; j < c.alt.length; j++) {
      const f = exitTime(qs, c.alt[j], c.start, w, self[i], tie[i], own[i]);
      if (f < bestF) {
        bestF = f;
        best = j;
      }
    }
    if (best < 0 || !(bestF < stay - margin)) continue;
    asked++;
    const o = c.alt[best];
    if (!tryMove(i, o.to, bestF, stay)) continue;
    moved++;
    for (const s of c.stay.stops) qs[s.k].remove(self[i]);
    // chained arrivals along the new route (own departure from each bottleneck + walk)
    let time = c.start;
    for (const s of o.stops) {
      const a = time + s.walk;
      time = qs[s.k].departIf(a, w);
      qs[s.k].insert(a, c.ids[0], w);
    }
  }
  return { asked, moved };
}
