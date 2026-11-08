/**
 * Capacity-limited gates (doors, stair entries, access stairs).
 *
 * Each gate is a token bucket: tokens accumulate at the gate capacity C(t)
 * (persons/s) up to a burst of 1 token, and every person entering the gate
 * consumes one token. Hence for any interval of length T:
 *     passes(T) <= integral C dt + 1,
 * which is the hard door-throughput constraint checked by the tests.
 *
 *   C = q * w_eff * luggage * envSpeed * g(u, pi)
 *   w_eff = w - 2 b                      (doors, boundary layer b)
 *   w_eff = w - 2 b_s                    (stairs, handrail boundary layer b_s)
 *   w_eff = n_lanes * (w/n_lanes - 2 b_s) (stairs split into lanes by a barrier)
 *   g(u, pi) = (1 + gain*u) * (1 - drop * max(0, (pi - theta)/(1 - theta))^2)
 *   pi = u * (mean impatience of the agents queuing at the gate)
 *
 * g encodes "faster-is-faster" at moderate urgency and "faster-is-slower"
 * (clogging) when urgency and competitiveness are both extreme. It is a
 * testable hypothesis, switchable via config.movement.fasterIsSlower.enabled.
 */
import type { NavGraph } from '../geometry/NavigationGraph';
import type { SimConfig } from './Params';

export class GateSystem {
  readonly isGate: Uint8Array;
  readonly baseCap: Float64Array; // persons/s without urgency modifier
  readonly cap: Float64Array; // current capacity
  readonly tokens: Float64Array;
  readonly passes: Int32Array;
  /** passes recorded per whole second (for throughput verification) */
  readonly passLog: Map<number, number[]> = new Map();
  readonly queueNow: Int32Array;
  readonly queueMax: Int32Array;
  readonly waitSum: Float64Array;
  readonly impatienceSum: Float64Array;
  private readonly cfg: SimConfig;

  constructor(g: NavGraph, cfg: SimConfig) {
    this.cfg = cfg;
    const n = g.links.length;
    this.isGate = new Uint8Array(n);
    this.baseCap = new Float64Array(n);
    this.cap = new Float64Array(n);
    this.tokens = new Float64Array(n);
    this.passes = new Int32Array(n);
    this.queueNow = new Int32Array(n);
    this.queueMax = new Int32Array(n);
    this.waitSum = new Float64Array(n);
    this.impatienceSum = new Float64Array(n);
    const m = cfg.movement;
    const env = Math.min(1, effectiveSpeedFactor(cfg));
    for (const L of g.links) {
      if (!L.gate) continue;
      this.isGate[L.idx] = 1;
      let weff: number;
      let q: number;
      if (L.isStair) {
        weff = L.laneBarrier ? L.lanes * Math.max(0.3, L.width / L.lanes - 2 * m.boundaryLayerStair) : Math.max(0.4, L.width - 2 * m.boundaryLayerStair);
        q = m.stairFlow;
        if (L.floor <= 1 && (L.id.startsWith('PST_') || L.id.startsWith('MS_'))) q *= cfg.environment.outdoorStairFactor;
      } else {
        weff = Math.max(0.4, L.width - 2 * m.boundaryLayerDoor);
        q = m.doorFlow;
      }
      this.baseCap[L.idx] = q * weff * cfg.population.luggageFlowFactor * env;
      this.cap[L.idx] = this.baseCap[L.idx] * this.urgencyFactor(0);
      this.tokens[L.idx] = 1;
    }
  }

  /** g(u, pi): urgency/competitiveness modifier of the specific flow. */
  urgencyFactor(meanImpatience: number): number {
    const f = this.cfg.movement.fasterIsSlower;
    const u = this.cfg.movement.urgency;
    if (!f.enabled) return 1;
    const pi = u * meanImpatience;
    const x = Math.max(0, (pi - f.threshold) / (1 - f.threshold));
    return (1 + f.gain * u) * (1 - f.drop * x * x);
  }

  /** Refill token buckets; capacity responds to the impatience of the current queue. */
  refill(dt: number, t = 0) {
    const R = this.cfg.stress.responders;
    const respOn = !!R && this.responder.length > 0 && t >= R.fromTime;
    for (let i = 0; i < this.isGate.length; i++) {
      if (!this.isGate[i]) continue;
      const qn = this.queueNow[i];
      const meanImp = qn > 0 ? this.impatienceSum[i] / qn : 0;
      this.cap[i] = this.baseCap[i] * this.urgencyFactor(meanImp) * (respOn && this.responder[i] ? R.capacityFactor : 1);
      this.tokens[i] = Math.min(1, this.tokens[i] + this.cap[i] * dt);
    }
  }

  /** gates used by responders entering against the flow (stress.responders) */
  private responder: Uint8Array = new Uint8Array(0);
  setResponderLinks(idx: number[]) {
    this.responder = new Uint8Array(this.isGate.length);
    for (const i of idx) this.responder[i] = 1;
    if (!idx.length) this.responder = new Uint8Array(0);
  }

  canPass(li: number): boolean {
    return !this.isGate[li] || this.tokens[li] >= 1 - 1e-9;
  }

  consume(li: number, t: number) {
    this.passes[li]++;
    if (!this.isGate[li]) return;
    this.tokens[li] -= 1;
    const sec = Math.floor(t);
    let arr = this.passLog.get(li);
    if (!arr) {
      arr = [];
      this.passLog.set(li, arr);
    }
    while (arr.length <= sec) arr.push(0);
    arr[sec]++;
  }

  resetQueueCounts() {
    this.queueNow.fill(0);
    this.impatienceSum.fill(0);
  }

  /** Maximum capacity that can ever apply to a gate (for verification). */
  maxCap(li: number): number {
    const f = this.cfg.movement.fasterIsSlower;
    const mult = f.enabled ? 1 + f.gain * this.cfg.movement.urgency : 1;
    return this.baseCap[li] * mult;
  }
}

export function effectiveSpeedFactor(cfg: SimConfig): number {
  let f = cfg.environment.speedFactor;
  if (cfg.environment.darkness) f *= 0.85;
  f *= 1 - 0.4 * Math.min(1, Math.max(0, cfg.environment.smoke));
  return f;
}
