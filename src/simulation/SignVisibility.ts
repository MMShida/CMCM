import type { GeometryData } from '../geometry/types';
import type { GuidanceSign, SimConfig } from './Params';
import { hardPanelIds } from './Barriers';

type Segment = { ax: number; ay: number; bx: number; by: number; floor: number };
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Includes touching an obstacle; ignores the observer/sign endpoint itself. */
export function blocksSight(x: number, y: number, sx: number, sy: number, w: Segment): boolean {
  const rx = sx - x, ry = sy - y, dx = w.bx - w.ax, dy = w.by - w.ay;
  const den = cross(rx, ry, dx, dy), qx = w.ax - x, qy = w.ay - y;
  if (Math.abs(den) < 1e-9) {
    if (Math.abs(cross(qx, qy, rx, ry)) > 1e-8) return false;
    const len2 = rx * rx + ry * ry;
    if (len2 < 1e-12) return false;
    const t0 = (qx * rx + qy * ry) / len2, t1 = ((w.bx - x) * rx + (w.by - y) * ry) / len2;
    return Math.max(t0, t1) > 1e-6 && Math.min(t0, t1) < 1 - 1e-6;
  }
  const t = cross(qx, qy, dx, dy) / den, u = cross(qx, qy, rx, ry) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u >= -1e-8 && u <= 1 + 1e-8;
}

/** Two-dimensional sign catchment approximation (Filippidis et al., 2021).
 * Walls/columns and opaque panels occlude; low ropes/rails do not. No height/crowd optics.
 * Each sign carries one fixed message, never an origin-dependent personalized instruction.
 */
export class SignVisibility {
  private segments: Segment[] = [];
  constructor(geo: GeometryData, private spatial: SimConfig['led']['spatial'], cfg: SimConfig) {
    if (!spatial?.occlusion) return;
    for (const wall of geo.walls) if (wall.kind === 'wall' || wall.kind === 'column') {
      for (let i = 1; i < wall.pts.length; i++) this.segments.push({ ax: wall.pts[i - 1][0], ay: wall.pts[i - 1][1], bx: wall.pts[i][0], by: wall.pts[i][1], floor: wall.floor });
    }
    for (const id of hardPanelIds(cfg)) {
      const link = geo.links.find((l) => l.id === id);
      if (!link) continue;
      const a = link.pts[0], b = link.pts[link.pts.length - 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      const nx = -(b[1] - a[1]) / length * link.width / 2, ny = (b[0] - a[0]) / length * link.width / 2;
      this.segments.push({ ax: x - nx, ay: y - ny, bx: x + nx, by: y + ny, floor: link.floor });
    }
  }

  nearest(x: number, y: number, floor: number): GuidanceSign | undefined {
    const s = this.spatial;
    if (!s) return;
    let best: GuidanceSign | undefined, distance = Infinity;
    for (const sign of s.signs) {
      const dx = x - sign.x, dy = y - sign.y, d = Math.hypot(dx, dy);
      if (floor !== sign.floor || d > s.range || d >= distance) continue;
      const radians = sign.facingDegrees * Math.PI / 180;
      if (d > 1e-9 && (dx * Math.cos(radians) + dy * Math.sin(radians)) / d < Math.cos(s.halfAngleDegrees * Math.PI / 180) - 1e-9) continue;
      if (s.occlusion && this.segments.some((w) => w.floor === floor && blocksSight(x, y, sign.x, sign.y, w))) continue;
      best = sign; distance = d;
    }
    return best;
  }
}
