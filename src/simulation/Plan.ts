/**
 * Exit plans at seat-block granularity.
 *
 * A plan maps keys to exit groups. Keys are tried from the most to the least specific:
 *
 *   ZONE:SIDE:BAND   e.g. ORCH_C_FRONT:W:F   (west half, front half of the zone's rows)
 *   ZONE:SIDE        e.g. ORCH_C_FRONT:W
 *   ZONE             e.g. ORCH_C_FRONT       (the original zone-level plan)
 *
 * SIDE is W for seats west of the centre line (x < 0) and E otherwise. BAND is F for the front
 * half of the zone's rows (counted from the stage / balcony rail) and B for the back half.
 * A zone-level plan (the default) behaves exactly as before.
 */
import type { ExitGroupId, GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { SimConfig } from './Params';
import type { Agent } from './Agent';

/** Give a social group a consistent planned destination without making anyone comply. */
export function guidanceSeat(cfg: SimConfig, agents: Agent[], groups: number[][], a: Agent): number {
  if (cfg.crowdManagers.groupPlan && !cfg.population.groupMeetOutside && a.group >= 0) {
    const leader = agents[groups[a.group]?.[0]];
    if (leader) return leader.seat;
  }
  return a.seat;
}

interface BlockIndex {
  /** keys per seat, most specific first */
  keys: string[][];
}

const cache = new WeakMap<GeometryData, BlockIndex>();

function blockIndex(geo: GeometryData): BlockIndex {
  let idx = cache.get(geo);
  if (idx) return idx;
  const lo = new Map<string, number>();
  const hi = new Map<string, number>();
  for (const s of geo.seats) {
    lo.set(s.zone, Math.min(lo.get(s.zone) ?? Infinity, s.rowIndex));
    hi.set(s.zone, Math.max(hi.get(s.zone) ?? -Infinity, s.rowIndex));
  }
  const keys = geo.seats.map((s) => {
    const side = s.x < 0 ? 'W' : 'E';
    const mid = ((lo.get(s.zone) ?? 0) + (hi.get(s.zone) ?? 0)) / 2;
    const band = s.rowIndex <= mid ? 'F' : 'B';
    return [`${s.zone}:${side}:${band}`, `${s.zone}:${side}`, s.zone];
  });
  idx = { keys };
  cache.set(geo, idx);
  return idx;
}

/** Block keys of a seat, most specific first. */
export function seatPlanKeys(geo: GeometryData, seat: number): string[] {
  return blockIndex(geo).keys[seat];
}

/** Exit group a plan assigns to a seat (FOYER if the plan does not mention the seat's zone). */
export function planExitName(plan: Record<string, string>, geo: GeometryData, seat: number): ExitGroupId {
  for (const k of blockIndex(geo).keys[seat]) {
    const v = plan[k];
    if (v && EXIT_GROUPS.includes(v as ExitGroupId)) return v as ExitGroupId;
  }
  return 'FOYER';
}

export function planExitIndex(plan: Record<string, string>, geo: GeometryData, seat: number): number {
  return EXIT_GROUPS.indexOf(planExitName(plan, geo, seat));
}

/** All blocks (ZONE:SIDE:BAND) present in the geometry, with their seat counts. */
export function planBlocks(geo: GeometryData): { key: string; zone: string; seats: number }[] {
  const idx = blockIndex(geo);
  const count = new Map<string, number>();
  idx.keys.forEach((k) => count.set(k[0], (count.get(k[0]) ?? 0) + 1));
  return [...count.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, seats]) => ({ key, zone: key.split(':')[0], seats }));
}

/** Expand a plan to one explicit entry per block (useful for optimisation and display). */
export function expandPlan(plan: Record<string, string>, geo: GeometryData): Record<string, ExitGroupId> {
  const out: Record<string, ExitGroupId> = {};
  const idx = blockIndex(geo);
  geo.seats.forEach((_, i) => {
    const k = idx.keys[i][0];
    if (!(k in out)) out[k] = planExitName(plan, geo, i);
  });
  return out;
}
