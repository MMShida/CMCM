/**
 * Pre-movement behaviour: a stochastic state machine per agent
 *
 *   UNAWARE --(recognition)--> AWARE --(response)--> PREPARING --(belongings)--> WAITING --> MOVING
 *
 * Intrinsic phase durations are lognormal (sampled in Population.ts). Social influence acts
 * through the fraction phi_i(t) of the agent's seated neighbours (radius r_n) who are standing
 * or moving:
 *   - the phase clock runs at rate 1 + kappa * phi_i(t):  dc/dt = 1 + kappa*phi,
 *     and the phase ends when c >= tau_phase (so phi = 0 recovers the lognormal);
 *   - an UNAWARE agent additionally becomes aware with hazard lambda = lambda_s * phi_i(t)
 *     (seeing neighbours stand up is itself a cue);
 *   - being squeezed past in a row makes a seated agent aware immediately.
 * Group members wait (WAITING) until every member is ready, then leave together.
 */
import { ST } from './Agent';
import type { SimulationEngine } from './SimulationEngine';

export function updateSocialPhi(sim: SimulationEngine) {
  const A = sim.agents;
  for (const a of A) {
    if (a.state > ST.WAITING || a.link >= 0) continue;
    const nb = a.neighbours;
    if (nb.length === 0) {
      a.socialPhi = 0;
      continue;
    }
    let s = 0;
    for (let k = 0; k < nb.length; k++) {
      const st = A[nb[k]].state;
      if (st >= ST.MOVING) s += 1;
      else if (st >= ST.PREPARING) s += 0.5;
    }
    a.socialPhi = s / nb.length;
  }
}

export function updatePremovement(sim: SimulationEngine, dt: number) {
  const A = sim.agents;
  const P = sim.cfg.premovement;
  const kappa = P.socialKappa;
  for (const a of A) {
    const st = a.state;
    if (st > ST.PREPARING) continue;
    if (st === ST.UNAWARE) {
      a.clock += dt * (1 + kappa * a.socialPhi);
      if (a.clock >= a.tRecognition || (a.socialPhi > 0 && sim.rngDyn.random() < P.socialAwareRate * a.socialPhi * dt)) sim.makeAware(a);
    } else if (st === ST.AWARE) {
      if (a.hesitate > 0) {
        a.hesitate -= dt;
        continue;
      }
      a.clock += dt * (1 + kappa * a.socialPhi);
      if (a.clock >= a.tResponse) {
        a.state = ST.PREPARING;
        a.clock = 0;
      }
    } else if (st === ST.PREPARING) {
      a.clock += dt;
      if (a.clock >= a.tPrepare) sim.becomeReady(a);
    }
  }
}
