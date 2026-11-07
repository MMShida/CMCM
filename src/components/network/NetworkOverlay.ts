/**
 * Canvas layer for the Model B/C network: edges drawn along their real polylines, nodes, and
 * optional flow widths (static max flow or time-expanded totals) and min-cut highlighting.
 */
import type { Floor } from '../../geometry/types';
import type { BuildingNetwork } from '../../network/NetworkGraph';

export interface NetworkDrawOptions {
  dark: boolean;
  /** edge ids in the minimum cut */
  cut?: Set<string>;
  /** absolute flow per edge (persons/s or persons) and its scale */
  flow?: number[];
  flowMax?: number;
  showNodes?: boolean;
  /** draw the row-exit (source) edges */
  showSources?: boolean;
  /** current queue length per edge (for labels) */
  queue?: number[];
}

const KIND_COLOR: Record<string, string> = {
  door: '#e34948',
  stair: '#d55181',
  corridor: '#eb6834',
  foyer: '#eb6834',
  walkway: '#6250d6',
  chain: '#2a78d6',
  aisle: '#2a78d6',
  crossAisle: '#2a78d6',
  passage: '#7a7a7a',
  portico: '#1baf7a',
  rowExit: '#9aa3ad',
};

function onFloor(net: BuildingNetwork, ei: number, floor: Floor): boolean {
  const E = net.edges[ei];
  if (E.isStair) return net.nodes[E.a].floor === floor || net.nodes[E.b].floor === floor;
  return E.floor === floor;
}

export function drawNetwork(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], floor: Floor, scale: number, net: BuildingNetwork, o: NetworkDrawOptions) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const fmax = o.flowMax ?? (o.flow ? Math.max(1e-9, ...o.flow.map(Math.abs)) : 1);
  for (const E of net.edges) {
    if (E.kind === 'rowExit' && !o.showSources) continue;
    if (!onFloor(net, E.idx, floor)) continue;
    const inCut = o.cut?.has(E.id);
    const f = o.flow ? Math.abs(o.flow[E.idx] ?? 0) : 0;
    let w = E.feature ? 2.2 : 1.4;
    if (o.flow) w = f > 1e-9 ? 1.2 + 7 * (f / fmax) : 0.8;
    ctx.strokeStyle = inCut ? (o.dark ? '#ff6b6b' : '#c62828') : (KIND_COLOR[E.kind] ?? '#888');
    ctx.globalAlpha = o.flow && f <= 1e-9 && !inCut ? 0.25 : inCut ? 1 : 0.75;
    ctx.lineWidth = inCut ? Math.max(w, 5) : w;
    ctx.beginPath();
    E.pts.forEach((p, i) => {
      const [sx, sy] = toScreen(p[0], p[1]);
      if (i) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (o.showNodes !== false) {
    for (const N of net.nodes) {
      if (N.floor !== floor) continue;
      const [sx, sy] = toScreen(N.x, N.y);
      if (N.kind === 'source') {
        if (!o.showSources) continue;
        const s = Math.max(3, Math.min(7, scale * 0.5));
        ctx.fillStyle = o.dark ? '#c8c6c0' : '#55524c';
        ctx.fillRect(sx - s, sy - s, 2 * s, 2 * s);
      } else if (N.kind === 'sink') {
        ctx.fillStyle = '#1baf7a';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(3, Math.min(7, scale * 0.45)), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = o.dark ? '#e6e4de' : '#2b2a27';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.2, Math.min(2.6, scale * 0.12)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (o.cut && o.cut.size && scale > 6) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = o.dark ? '#ff8a8a' : '#b71c1c';
    for (const E of net.edges) {
      if (!o.cut.has(E.id) || !onFloor(net, E.idx, floor)) continue;
      const p = E.pts[Math.floor(E.pts.length / 2)];
      const [sx, sy] = toScreen(p[0], p[1]);
      ctx.fillText(E.label, sx + 6, sy - 6);
    }
  }
  ctx.restore();
}
