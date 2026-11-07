/**
 * Canvas rendering of the building, overlays and agents. Pure functions: the
 * simulation engine is never touched here (it only provides frame data).
 */
import type { NavGraph } from '../geometry/NavigationGraph';
import type { Floor, GeometryData, MapOverlay } from '../geometry/types';
import { STATE_COLOR } from '../simulation/Agent';
import { densityColor } from './util';

export interface View {
  cx: number;
  cy: number;
  scale: number; // px per metre
}

export interface Frame {
  n: number;
  x: Float32Array;
  y: Float32Array;
  floor: Uint8Array;
  state: Uint8Array;
  radius: Float32Array;
}

export interface Dyn {
  queue?: Int32Array; // per link
  closed?: Uint8Array; // per link (blocked exits and barriers)
  barrier?: Uint8Array;
  passes?: Int32Array;
  cms?: { x: number; y: number; floor: number; active: boolean; id: string }[];
  /** heat grids indexed by floor - 1 */
  heats?: ({ x0: number; y0: number; cell: number; nx: number; ny: number; data: ArrayLike<number> } | null)[];
  selected?: number;
  selectedPath?: [number, number, number][]; // x, y, floor
  ledOn?: boolean;
  ledLinks?: { pts: [number, number][]; floor: number }[];
}

export interface DrawOpts {
  floor: Floor;
  overlay: { img: HTMLImageElement; def: MapOverlay; opacity: number } | null;
  showLinks: boolean;
  showLabels: boolean;
  showSeats: boolean;
  showAgents: boolean;
  dark: boolean;
  highlightApprox?: boolean;
  selectedNode?: string | null;
  selectedLink?: string | null;
  title?: string;
}

export function worldToScreen(v: View, w: number, h: number, x: number, y: number): [number, number] {
  return [(x - v.cx) * v.scale + w / 2, (y - v.cy) * v.scale + h / 2];
}
export function screenToWorld(v: View, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - w / 2) / v.scale + v.cx, (sy - h / 2) / v.scale + v.cy];
}

const LINK_COLOR: Record<string, string> = {
  row: 'rgba(120,150,120,0.35)',
  aisle: 'rgba(42,120,214,0.45)',
  crossAisle: 'rgba(42,120,214,0.45)',
  walkway: 'rgba(98,80,214,0.45)',
  corridor: 'rgba(235,104,52,0.45)',
  foyer: 'rgba(235,104,52,0.45)',
  door: 'rgba(227,73,72,0.9)',
  stair: 'rgba(213,81,129,0.85)',
  landing: 'rgba(235,104,52,0.45)',
  portico: 'rgba(27,175,122,0.5)',
  outdoor: 'rgba(120,120,120,0.5)',
  passage: 'rgba(80,80,80,0.5)',
};

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, view: View, geo: GeometryData, graph: NavGraph, o: DrawOpts, frame: Frame | null, dyn: Dyn) {
  const S = view.scale;
  const tx = (x: number) => (x - view.cx) * S + w / 2;
  const ty = (y: number) => (y - view.cy) * S + h / 2;
  const ink = o.dark ? '#e8e6e1' : '#1d1d1b';
  const muted = o.dark ? '#8f8d86' : '#77756f';
  ctx.save();
  ctx.fillStyle = o.dark ? '#151514' : '#fbfbf9';
  ctx.fillRect(0, 0, w, h);

  // ---- architectural overlay --------------------------------------------------
  if (o.overlay && o.overlay.opacity > 0) {
    const d = o.overlay.def;
    const th = (d.rotationDeg * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const a11 = S * c * d.metresPerPxX;
    const a12 = -S * s * d.metresPerPxY;
    const a21 = S * s * d.metresPerPxX;
    const a22 = S * c * d.metresPerPxY;
    // world = w0 + R D (p - p0) -> screen
    const ox = tx(d.worldOrigin[0]) - (a11 * d.pxOrigin[0] + a12 * d.pxOrigin[1]);
    const oy = ty(d.worldOrigin[1]) - (a21 * d.pxOrigin[0] + a22 * d.pxOrigin[1]);
    ctx.save();
    ctx.globalAlpha = o.overlay.opacity;
    const base = ctx.getTransform();
    ctx.transform(a11, a21, a12, a22, ox, oy);
    void base;
    ctx.drawImage(o.dark ? invertedImage(o.overlay.img) : o.overlay.img, 0, 0);
    ctx.restore();
  }

  // ---- heat map -------------------------------------------------------------------
  const H = dyn.heats?.[o.floor - 1];
  if (H) {
    const cs = H.cell * S;
    for (let j = 0; j < H.ny; j++)
      for (let i = 0; i < H.nx; i++) {
        const v = H.data[j * H.nx + i];
        if (v < 0.4) continue;
        ctx.fillStyle = densityColor(v, 0.8);
        ctx.fillRect(tx(H.x0 + i * H.cell), ty(H.y0 + j * H.cell), cs + 0.5, cs + 0.5);
      }
  }

  // ---- links (walkable network) -------------------------------------------------
  ctx.lineCap = 'round';
  for (const L of graph.links) {
    if (!L.drawFloors.includes(o.floor)) continue;
    const otherFloor = L.floor !== o.floor && !(L.floor === 0 && o.floor === 1);
    const isSel = o.selectedLink === L.id;
    if (!o.showLinks && !isSel && L.kind !== 'stair' && L.kind !== 'door') continue;
    if (L.isRow && !o.showLinks && !isSel) continue;
    ctx.strokeStyle = isSel ? '#ff00aa' : L.prohibited ? 'rgba(150,150,150,0.5)' : LINK_COLOR[L.kind];
    if (o.highlightApprox && geo.links[L.idx].approx) ctx.strokeStyle = 'rgba(237,161,0,0.95)';
    const wpx = L.kind === 'door' ? 3 : L.isStair ? Math.max(2, L.width * S) : Math.max(1, Math.min(L.width * S * 0.35, 30));
    ctx.lineWidth = isSel ? Math.max(3, wpx) : L.isRow ? 1 : wpx;
    ctx.globalAlpha = (otherFloor ? 0.35 : 1) * (L.isStair && !isSel ? 0.22 : 1);
    if (L.prohibited) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(tx(L.xs[0]), ty(L.ys[0]));
    for (let i = 1; i < L.xs.length; i++) ctx.lineTo(tx(L.xs[i]), ty(L.ys[i]));
    ctx.stroke();
    ctx.setLineDash([]);
    // stair treads
    if (L.isStair && S > 6) {
      ctx.strokeStyle = o.dark ? 'rgba(232,230,225,0.35)' : 'rgba(29,29,27,0.3)';
      ctx.lineWidth = 1;
      const len = L.cum[L.cum.length - 1];
      for (let s = 0.3; s < len; s += 0.3) {
        const k = segAt(L.cum, s);
        const t = (s - L.cum[k - 1]) / (L.cum[k] - L.cum[k - 1] || 1);
        const x = L.xs[k - 1] + (L.xs[k] - L.xs[k - 1]) * t;
        const y = L.ys[k - 1] + (L.ys[k] - L.ys[k - 1]) * t;
        const dx = L.xs[k] - L.xs[k - 1];
        const dy = L.ys[k] - L.ys[k - 1];
        const n = Math.hypot(dx, dy) || 1;
        const hw = (L.width / 2) * S;
        ctx.beginPath();
        ctx.moveTo(tx(x) - (dy / n) * hw, ty(y) + (dx / n) * hw);
        ctx.lineTo(tx(x) + (dy / n) * hw, ty(y) - (dx / n) * hw);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- walls ------------------------------------------------------------------------
  for (const wl of geo.walls) {
    if (wl.floor !== o.floor) continue;
    ctx.strokeStyle = wl.kind === 'outline' ? muted : wl.kind === 'rail' ? '#2a78d6' : wl.kind === 'barrier' ? (o.dark ? '#c9a27a' : '#7a5230') : ink;
    ctx.lineWidth = wl.kind === 'outline' ? 1 : wl.kind === 'column' ? 1.5 : wl.kind === 'stage' ? 2 : 2.5;
    if (wl.kind === 'outline') ctx.setLineDash([3, 3]);
    ctx.beginPath();
    wl.pts.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y))));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- seats -------------------------------------------------------------------------
  if (o.showSeats && S > 5) {
    ctx.fillStyle = o.dark ? 'rgba(200,200,190,0.18)' : 'rgba(60,60,50,0.14)';
    const sz = Math.max(1.5, 0.36 * S);
    for (const s of geo.seats) {
      const f = s.level === 'balcony' ? 2 : 1;
      if (f !== o.floor) continue;
      ctx.fillRect(tx(s.x) - sz / 2, ty(s.y) - sz / 2, sz, sz);
      if (s.wheelchair) {
        ctx.strokeStyle = '#d4145a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tx(s.x) - sz, ty(s.y) - sz, 2 * sz, 2 * sz);
      }
    }
  }

  // ---- elevators (prohibited) ---------------------------------------------------------
  for (const n of geo.nodes) {
    if (n.kind !== 'elevator' || (n.floor === 2 ? 2 : 1) !== o.floor) continue;
    const x = tx(n.x);
    const y = ty(n.y);
    const r = Math.max(5, 0.8 * S);
    ctx.strokeStyle = '#e34948';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  // ---- closed links / barriers ------------------------------------------------------
  if (dyn.closed) {
    for (const L of graph.links) {
      if (!dyn.closed[L.idx] || !L.drawFloors.includes(o.floor)) continue;
      const m = Math.floor(L.xs.length / 2);
      const x = tx((L.xs[0] + L.xs[L.xs.length - 1]) / 2);
      const y = ty((L.ys[0] + L.ys[L.ys.length - 1]) / 2);
      const isBarrier = dyn.barrier?.[L.idx];
      const r = Math.max(6, (L.width / 2 + 0.3) * S);
      ctx.strokeStyle = isBarrier ? '#eda100' : '#e34948';
      ctx.lineWidth = Math.max(3, 0.35 * S);
      const dx = L.xs[Math.min(L.xs.length - 1, m + 1)] - L.xs[Math.max(0, m - 1)];
      const dy = L.ys[Math.min(L.ys.length - 1, m + 1)] - L.ys[Math.max(0, m - 1)];
      const n = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      if (isBarrier) {
        ctx.moveTo(x - (dy / n) * r, y + (dx / n) * r);
        ctx.lineTo(x + (dy / n) * r, y - (dx / n) * r);
      } else {
        ctx.moveTo(x - r * 0.7, y - r * 0.7);
        ctx.lineTo(x + r * 0.7, y + r * 0.7);
        ctx.moveTo(x + r * 0.7, y - r * 0.7);
        ctx.lineTo(x - r * 0.7, y + r * 0.7);
      }
      ctx.stroke();
    }
  }

  // ---- LED strips ---------------------------------------------------------------------
  if (dyn.ledOn && dyn.ledLinks) {
    ctx.strokeStyle = 'rgba(27,175,122,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 6]);
    for (const l of dyn.ledLinks) {
      if (l.floor !== o.floor) continue;
      ctx.beginPath();
      l.pts.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y))));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ---- agents -------------------------------------------------------------------------
  if (frame && o.showAgents) {
    const byState: number[][] = [];
    for (let i = 0; i < frame.n; i++) {
      if (frame.floor[i] !== o.floor) continue;
      const st = frame.state[i];
      if (st === 11) continue; // safe: removed from the interior map
      (byState[st] ??= []).push(i);
    }
    for (let st = 0; st < byState.length; st++) {
      const list = byState[st];
      if (!list) continue;
      ctx.fillStyle = STATE_COLOR[st];
      ctx.beginPath();
      for (const i of list) {
        const x = tx(frame.x[i]);
        const y = ty(frame.y[i]);
        const r = Math.max(1.6, frame.radius[i] * S * 0.95);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    if (S > 9) {
      ctx.strokeStyle = o.dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < frame.n; i++) {
        if (frame.floor[i] !== o.floor || frame.state[i] === 11) continue;
        ctx.beginPath();
        ctx.arc(tx(frame.x[i]), ty(frame.y[i]), Math.max(1.6, frame.radius[i] * S * 0.95), 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    if (dyn.selected !== undefined && dyn.selected >= 0 && frame.floor[dyn.selected] === o.floor) {
      const i = dyn.selected;
      ctx.strokeStyle = '#ff00aa';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(tx(frame.x[i]), ty(frame.y[i]), Math.max(6, frame.radius[i] * S * 2), 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  if (dyn.selectedPath && dyn.selectedPath.length > 1) {
    ctx.strokeStyle = 'rgba(255,0,170,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const P = dyn.selectedPath;
    for (let i = 1; i < P.length; i++) {
      if (P[i - 1][2] !== o.floor || P[i][2] !== o.floor) continue;
      ctx.moveTo(tx(P[i - 1][0]), ty(P[i - 1][1]));
      ctx.lineTo(tx(P[i][0]), ty(P[i][1]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- queues at gates ------------------------------------------------------------------
  if (dyn.queue) {
    ctx.font = `${Math.max(10, Math.min(14, 0.9 * S))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const L of graph.links) {
      const q = dyn.queue[L.idx];
      if (!L.gate || q < 3) continue;
      const nd = graph.nodes[L.a];
      if ((nd.floor === 2 ? 2 : 1) !== o.floor) continue;
      const x = tx(nd.x);
      const y = ty(nd.y);
      const r = Math.min(26, 6 + Math.sqrt(q) * 2.2);
      ctx.fillStyle = 'rgba(227,73,72,0.22)';
      ctx.strokeStyle = 'rgba(227,73,72,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillText(String(q), x, y);
    }
  }

  // ---- exit usage counters ---------------------------------------------------------------
  if (dyn.passes) {
    ctx.font = `600 ${Math.max(10, Math.min(13, 0.8 * S))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const L of graph.links) {
      if (!L.exterior || !L.drawFloors.includes(o.floor)) continue;
      const p = dyn.passes[L.idx];
      if (!p) continue;
      const nb = graph.nodes[L.b];
      ctx.fillStyle = '#1baf7a';
      ctx.fillText(`${p}`, tx(nb.x), ty(nb.y) + 14);
    }
  }

  // ---- Crowd Managers --------------------------------------------------------------------
  if (dyn.cms) {
    for (const c of dyn.cms) {
      if (c.floor !== o.floor) continue;
      drawStar(ctx, tx(c.x), ty(c.y), Math.max(6, 0.7 * S), c.active ? '#eda100' : 'rgba(150,150,150,0.8)', ink);
      if (o.showLabels) {
        ctx.fillStyle = ink;
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(c.id, tx(c.x) + 8, ty(c.y) - 8);
      }
    }
  }

  // ---- node selection (editor) ----------------------------------------------------------
  if (o.selectedNode) {
    const n = geo.nodes.find((nd) => nd.id === o.selectedNode);
    if (n) {
      ctx.strokeStyle = '#ff00aa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx(n.x), ty(n.y), 7, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  // ---- labels ----------------------------------------------------------------------------
  if (o.showLabels) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lb of geo.labels) {
      if (lb.floor !== o.floor) continue;
      const size = (lb.size ?? 0.6) * S;
      if (size < 7) continue;
      ctx.font = `${lb.size && lb.size >= 0.8 ? '600 ' : ''}${Math.min(22, size)}px system-ui, sans-serif`;
      ctx.fillStyle = lb.size && lb.size >= 0.8 ? muted : ink;
      ctx.fillText(lb.text, tx(lb.x), ty(lb.y));
    }
  }
  if (o.title) {
    ctx.fillStyle = muted;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(o.title, 10, 8);
  }
  ctx.restore();
}

const inverted = new WeakMap<HTMLImageElement, HTMLCanvasElement>();
/** dark mode: a cached, colour-inverted copy of a plan image (no per-frame filters) */
function invertedImage(img: HTMLImageElement): CanvasImageSource {
  let c = inverted.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    try {
      const d = x.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = 235 - d.data[i] * 0.85;
        d.data[i + 1] = 235 - d.data[i + 1] * 0.85;
        d.data[i + 2] = 235 - d.data[i + 2] * 0.85;
      }
      x.putImageData(d, 0, 0);
    } catch {
      /* tainted canvas: fall back to the original image */
    }
    inverted.set(img, c);
  }
  return c;
}

function segAt(cum: Float64Array, s: number): number {
  let k = 1;
  while (k < cum.length - 1 && cum[k] < s) k++;
  return k;
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + rr * Math.cos(a);
    const py = y + rr * Math.sin(a);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function fitView(floor: Floor, w: number, h: number): View {
  const bounds = floor === 2 ? { x0: -25, x1: 25, y0: -20, y1: 22 } : { x0: -26, x1: 26, y0: -21, y1: 40 };
  const scale = Math.min(w / (bounds.x1 - bounds.x0), h / (bounds.y1 - bounds.y0)) * 0.96;
  return { cx: (bounds.x0 + bounds.x1) / 2, cy: (bounds.y0 + bounds.y1) / 2, scale };
}
