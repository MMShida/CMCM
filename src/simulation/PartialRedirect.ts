/**
 * Partial, capacity-sized redirection by Crowd Managers who see the whole building
 * (adaptive.redirectMode = 'partial'; MODEL A ONLY - Model B keeps the zone rule).
 *
 * Premise (project decision): from their posts the managers see every queue and where everyone is
 * heading, they all know the same plan and the same state, so they agree. They do not move a
 * whole planned exit at once: every review (adaptive.decisionInterval) they move individual people
 * (a group leader with the group) to another exit when that person finishes clearly earlier there.
 *
 * Bottlenecks, not exits, decide: a "resource" is a set of parallel doors (all doors joining the
 * same two rooms, e.g. F1-F4 or FC1-FC3) or a single other gate (stair entry), with capacity c_k =
 * the sum of the gate capacities. Its clearing time T_k starts as (persons whose route crosses it)
 * / c_k. For a person with walking time walk and weight w (1 + group members):
 *
 *   stay           = max(walk_now, max_{k on current route} T_k)
 *   finish via b   = max_{k on route to b} ( max(T_k, walk_b) + w / c_k )   (walk_b if no gate)
 *   move to best b   if finish < stay - adaptive.redirectMargin
 *   then           T_k = max(T_k, walk_b) + w / c_k on the new route, T_k -= w / c_k on the old one.
 *
 * Shared hall doors therefore count once: sending people from the foyer to a portico through the
 * same auditorium doors gains nothing and is not done. For one exit with queue Q_a, capacity c_a
 * and an empty alternative (c_b, extra walk dw) the rule moves about
 *   n* = (Q_a/c_a - dw) / (1/c_a + 1/c_b)   people (tested in tests/adaptive.test.ts).
 * People are considered in order of decreasing 'stay' (the most delayed first), each at most once.
 * tryMove() delivers the instruction and reports whether the person adopted it (compliance x trust
 * and the person's own choice decide); the next review starts again from the real state.
 */

export interface Resource {
  /** clearing time (s) */
  T: number;
  /** capacity (persons/s) */
  cap: number;
}

export interface RedirectCandidate {
  /** resources on the current route and the walking time to the current exit */
  stayRes: number[];
  stayWalk: number;
  /** alternatives: exit group, resources on its route, walking time */
  alt: { to: number; res: number[]; walk: number }[];
  /** persons moved by this instruction (1 + group members following the leader) */
  w: number;
}

const stayTime = (res: Resource[], c: RedirectCandidate) => {
  let s = c.stayWalk;
  for (const k of c.stayRes) if (res[k].T > s) s = res[k].T;
  return s;
};

/** see the file comment; returns the number of instructions given (asked) and adopted (moved) */
export function balanceRedirects(
  res: Resource[],
  cands: RedirectCandidate[],
  margin: number,
  tryMove: (i: number, to: number) => boolean,
  maxAsk = Infinity,
): { asked: number; moved: number } {
  const order = cands.map((c, i) => [stayTime(res, c), i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  let asked = 0;
  let moved = 0;
  for (const [, i] of order) {
    if (asked >= maxAsk) break;
    const c = cands[i];
    const stay = stayTime(res, c);
    let best = -1;
    let bestF = Infinity;
    for (let j = 0; j < c.alt.length; j++) {
      const o = c.alt[j];
      if (!Number.isFinite(o.walk)) continue;
      let f = o.walk;
      for (const k of o.res) {
        const v = Math.max(res[k].T, o.walk) + c.w / res[k].cap;
        if (v > f) f = v;
      }
      if (f < bestF) {
        bestF = f;
        best = j;
      }
    }
    if (best < 0 || !(bestF < stay - margin)) continue;
    asked++;
    const o = c.alt[best];
    if (!tryMove(i, o.to)) continue;
    moved++;
    for (const k of c.stayRes) res[k].T = Math.max(0, res[k].T - c.w / res[k].cap);
    for (const k of o.res) res[k].T = Math.max(res[k].T, o.walk) + c.w / res[k].cap;
  }
  return { asked, moved };
}
