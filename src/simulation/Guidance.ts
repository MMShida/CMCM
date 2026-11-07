/**
 * Crowd Managers and LED guidance.
 *
 * Crowd Manager c becomes active at t_c ~ LogNormal(median, sigma) after the alarm and then
 * broadcasts by voice to agents within radius R on the same floor. Each second, an agent in
 * range who has not yet received the instruction hears it with probability 1 - exp(-h).
 * Hearing an instruction:
 *   - makes an unaware agent aware,
 *   - shortens the remaining response time by the factor cmFactor,
 *   - teaches the agent the recommended exit (and any obstruction/barrier the CM knows),
 *   - with probability p_comply (fixed per agent: uCM < p) the agent adopts the
 *     recommendation as guidance G in its exit utility.
 * Dynamic Crowd Managers re-route their zone to the nearest open exit once they know an
 * exit is blocked (immediately, after an announcement delay, or never - discovery only).
 *
 * LED strips activate at t_LED; when an agent starts moving (or at activation if already
 * moving) it perceives the strip with probability p_see (fixed uniform uLEDsee) and complies
 * with probability p_comply (uLED). Disagreement between LED and Crowd Manager instructions
 * costs a hesitation delay and splits the guidance term.
 */
import type { CrowdManagerPost, ExitGroupId } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { Agent } from './Agent';
import { ST } from './Agent';
import { RNG } from './Random';
import type { SimulationEngine } from './SimulationEngine';

export interface CrowdManagerRT {
  post: CrowdManagerPost;
  tActive: number;
  knowsBlocked: boolean;
  /** version of the information broadcast (increments when blocked info arrives) */
  version: number;
}

export class GuidanceSystem {
  readonly cms: CrowdManagerRT[] = [];
  private acc = 0;
  private readonly sim: SimulationEngine;
  private readonly rng: RNG;
  private heardVersion: Int32Array;
  ledActive = false;

  constructor(sim: SimulationEngine) {
    this.sim = sim;
    this.rng = new RNG(sim.seed, 'guidance');
    const C = sim.cfg.crowdManagers;
    const n = C.count < 0 ? Math.ceil(sim.agents.length / 250) : C.count;
    const posts = sim.geo.crowdManagerPosts.filter((p) => !C.unavailable.includes(p.id));
    // draw activation times for all posts (CRN), use the first n available
    const act = sim.geo.crowdManagerPosts.map(() => this.rng.lognormalMedian(C.activationMedian, C.activationSigma));
    for (let i = 0; i < Math.min(n, posts.length); i++) {
      const idx = sim.geo.crowdManagerPosts.indexOf(posts[i]);
      this.cms.push({ post: posts[i], tActive: act[idx], knowsBlocked: false, version: 0 });
    }
    this.heardVersion = new Int32Array(sim.agents.length).fill(-1);
    if (sim.cfg.blocked.links.length && sim.cfg.blocked.knowledge === 'immediate') for (const cm of this.cms) cm.knowsBlocked = true;
  }

  /** Exit group a Crowd Manager recommends for an agent of a given zone. */
  recommend(a: Agent, knowsBlocked: boolean, dynamic: boolean, plan: Record<string, ExitGroupId>): number {
    const sim = this.sim;
    const zone = sim.geo.seats[a.seat].zone;
    const gName = plan[zone] ?? 'FOYER';
    let gi = EXIT_GROUPS.indexOf(gName);
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
    for (const cm of this.cms) {
      if (t < cm.tActive) continue;
      const R = C.radius * (sim.cfg.environment.smoke > 0.5 ? 0.7 : 1);
      sim.forEachNear(cm.post.x, cm.post.y, cm.post.floor, R, (a) => {
        if (a.done || !a.inside) return;
        if (this.heardVersion[a.id] >= cm.version) return;
        if (this.rng.random() > pHear) return;
        this.heardVersion[a.id] = cm.version;
        this.instruct(a, cm);
      });
    }
  }

  private instruct(a: Agent, cm: CrowdManagerRT) {
    const sim = this.sim;
    const C = sim.cfg.crowdManagers;
    const first = !a.instructedCM;
    a.instructedCM = true;
    if (a.state === ST.UNAWARE) sim.makeAware(a);
    if (first && (a.state === ST.AWARE || a.state === ST.UNAWARE)) a.tResponse = a.clock + Math.max(0, a.tResponse - a.clock) * sim.cfg.premovement.cmFactor;
    if (cm.knowsBlocked) for (const li of sim.blockedLinks) sim.routing.learnBlocked(a, li);
    for (const li of sim.barrierLinks) sim.routing.learnBlocked(a, li);
    const gi = this.recommend(a, cm.knowsBlocked, C.dynamic, C.plan);
    a.knownExits |= 1 << gi;
    if (a.uCM < C.complianceProb) {
      const prev = a.cmGroup;
      a.cmGroup = gi;
      if (a.ledGroup >= 0 && a.ledGroup !== gi && prev !== gi) a.hesitate += sim.cfg.led.conflictDelay;
    }
    if (a.state >= ST.MOVING && a.state <= ST.REUNITING) sim.routing.chooseExit(a, 'info');
  }

  /** LED perception when an agent starts to move. */
  ledPerceive(a: Agent) {
    const sim = this.sim;
    const L = sim.cfg.led;
    if (!L.enabled || !this.ledActive || a.ledSeen || a.wheelchair) return;
    a.ledSeen = true;
    const pSee = L.perceiveProb * (1 - 0.5 * Math.min(1, sim.cfg.environment.smoke));
    if (a.uLEDsee >= pSee) return;
    const zone = sim.geo.seats[a.seat].zone;
    let gi = EXIT_GROUPS.indexOf(L.plan[zone] ?? 'FOYER');
    if (L.dynamic && sim.blockedLinks.length) {
      // dynamic signage marks closed exits and points to the nearest open one
      for (const li of sim.blockedLinks) sim.routing.learnBlocked(a, li);
      gi = this.recommend(a, true, true, L.plan);
    }
    a.knownExits |= 1 << gi;
    if (a.uLED < L.complianceProb) {
      a.ledGroup = gi;
      if (a.cmGroup >= 0 && a.cmGroup !== gi) a.hesitate += L.conflictDelay;
    }
  }
}
