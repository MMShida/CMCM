/**
 * Shared physical assumptions used by BOTH engines (detailed agent-based Model A and
 * network Model B/C), so that the two models see the same doors, widths and capacities.
 *
 *   gate (door / stair entry / access point)   C = q * w_eff * luggage * env      [Model A GateSystem]
 *        nominal urgency multiplier            g(u, 0) = 1 + gain * u              (faster-is-faster part)
 *   walkway lane (headway model)               J = v / (d_min + v * T)             per lane, lanes = floor(w/0.6 + 0.2)
 *   stair lane                                 J = v_s / (d_min + v_s * T),  v_s = v * stairRatio
 *   seat-row end                               J_row = v_row / (d_min + v_row * T)
 *   storage (holding capacity)                 S = rho_max * area   (rho_max = 4.5 p/m^2, Model A's occupancy cap)
 *
 * Every number comes from SimConfig (src/simulation/Params.ts), which is the single shared
 * configuration of both models; nothing here is a new physical value.
 */
import type { LinkGeom, NavGraph } from '../geometry/NavigationGraph';
import type { SimConfig } from '../simulation/Params';
import { GateSystem, effectiveSpeedFactor } from '../simulation/QueueSystem';

export function laneFlow(v: number, dmin: number, T: number): number {
  return v / (dmin + v * T);
}

export interface PhysicalRates {
  /** persons/s per walking lane on level ground */
  walkLane: number;
  /** persons/s per lane on stairs */
  stairLane: number;
  /** persons/s out of one seat-row end */
  rowEnd: number;
  /** representative free walking speed (m/s), incl. environment factor */
  vRep: number;
  /** representative stair speed (m/s along the slope) */
  vStairRep: number;
  /** nominal urgency multiplier on gate capacity, g(u, pi = 0) */
  urgencyMult: number;
  rhoMax: number;
}

export function physicalRates(cfg: SimConfig): PhysicalRates {
  const env = effectiveSpeedFactor(cfg);
  const dmin = 2 * cfg.population.radiusMean;
  const T = cfg.movement.timeHeadway;
  const v = cfg.population.speedMean * env;
  const vs = v * cfg.population.stairRatio;
  const f = cfg.movement.fasterIsSlower;
  return {
    walkLane: laneFlow(v, dmin, T),
    stairLane: laneFlow(vs, dmin, T),
    rowEnd: laneFlow(cfg.movement.rowSpeed * env, dmin, T),
    vRep: v,
    vStairRep: vs,
    urgencyMult: f.enabled ? 1 + f.gain * cfg.movement.urgency : 1,
    rhoMax: cfg.movement.maxDensity,
  };
}

/**
 * Capacity (persons/s) of a detailed link under the shared rules.
 * Gates use Model A's token-bucket capacity (without the urgency multiplier, which the
 * caller applies), other links the headway lane flow.
 */
export function linkCapacity(L: LinkGeom, gates: GateSystem, r: PhysicalRates): number {
  if (L.gate) return gates.baseCap[L.idx];
  return L.lanes * (L.isStair ? r.stairLane : r.walkLane);
}

export function gateSystemFor(g: NavGraph, cfg: SimConfig): GateSystem {
  return new GateSystem(g, { ...cfg, movement: { ...cfg.movement, urgency: 0 } });
}
