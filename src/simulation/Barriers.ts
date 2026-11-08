import type { SimConfig } from './Params';

/** A rope discourages crossing; a panel closes a route. Neither raises capacity. */
export function hardPanelIds(c: SimConfig): string[] {
  return c.barriers.filter((id) => c.barrierTypes?.[id] !== 'soft-rope');
}
export function ropeCost(c: SimConfig, id: string): number {
  return c.barrierTypes?.[id] === 'soft-rope' && c.barriers.includes(id) ? Math.max(0, c.ropePenalty ?? 15) : 0;
}
