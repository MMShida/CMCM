import type { SimConfig } from './Params';

/** A rope discourages crossing; a panel closes a route. Neither raises capacity. */
export function hardPanelIds(c: SimConfig): string[] {
  return c.barriers.filter((id) => c.barrierTypes?.[id] !== 'soft-rope');
}
export function ropeCost(c: SimConfig, id: string): number {
  return c.barrierTypes?.[id] === 'soft-rope' && c.barriers.includes(id) ? Math.max(0, c.ropePenalty ?? 15) : 0;
}

/** A-Lite+ transparent installations may close a link without occluding signs. */
export function opaquePanelIds(c: SimConfig): string[] {
  return hardPanelIds(c).filter(id => !c.plus?.barriers.some(b=>b.enabled&&b.slot===id&&b.type!=='opaque-panel'));
}
