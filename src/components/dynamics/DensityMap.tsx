/**
 * Density heat map over the Bailey Hall layout: every walkable link (Model A) or network edge
 * (Model B) is drawn with its clear width and coloured by its density (persons/m^2) at the
 * selected time. Floor 1 (with the ground-level exits) on the left, the balcony on the right.
 * Sequential single-hue scale (light = empty, dark = dense); the scale is a display choice, not a
 * safety classification.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { GeometryData } from '../../geometry/types';
import type { HeatItem } from '../../simulation/DensityRegions';
import type { LivePost } from './runStore';

export const DENSITY_MAX = 5;

/** sequential orange ramp (one hue, light -> dark) */
export function heatColor(d: number, dark: boolean): string {
  const t = Math.max(0, Math.min(1, d / DENSITY_MAX));
  if (d <= 0.01) return dark ? 'rgba(150,150,150,0.25)' : 'rgba(120,120,120,0.22)';
  const lo = dark ? [92, 54, 30] : [253, 224, 196];
  const hi = dark ? [255, 170, 100] : [140, 36, 0];
  const c = lo.map((v, i) => Math.round(v + (hi[i] - v) * Math.pow(t, 0.8)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

interface Props {
  geo: GeometryData;
  items: HeatItem[];
  values: number[] | null;
  dark: boolean;
  /** region index to outline (-1 none) */
  highlight?: number;
  posts?: LivePost[];
  /** draw voice radius rings around posts (m) */
  ring?: number;
  height?: number;
  onPick?: (region: number) => void;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function DensityMap({ geo, items, values, dark, highlight = -1, posts, ring, height = 380, onPick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxes = useMemo(() => {
    const b: Record<number, Box> = { 1: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, 2: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
    for (const L of geo.links) {
      if (L.kind === 'row' && L.floor !== 2) continue;
      const f = L.floor === 2 ? 2 : 1;
      for (const [x, y] of L.pts) {
        b[f].x0 = Math.min(b[f].x0, x);
        b[f].y0 = Math.min(b[f].y0, y);
        b[f].x1 = Math.max(b[f].x1, x);
        b[f].y1 = Math.max(b[f].y1, y);
      }
    }
    return b;
  }, [geo]);
  const layout = useRef<{ f: number; ox: number; oy: number; s: number }[]>([]);
  const widthOf = useMemo(() => new Map(geo.links.map((l) => [l.id, l.width])), [geo]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = height;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--text-2').trim() || (dark ? '#bbb' : '#555');
    const wallC = dark ? 'rgba(220,220,220,0.55)' : 'rgba(40,40,40,0.55)';
    const half = w / 2;
    const L: { f: number; ox: number; oy: number; s: number }[] = [];
    [1, 2].forEach((f, k) => {
      const b = boxes[f];
      const pad = 12;
      const s = Math.min((half - 2 * pad) / (b.x1 - b.x0), (h - 2 * pad - 16) / (b.y1 - b.y0));
      const ox = k * half + (half - s * (b.x1 - b.x0)) / 2 - s * b.x0;
      const oy = 16 + pad - s * b.y0;
      L.push({ f, ox, oy, s });
      ctx.fillStyle = ink;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(f === 1 ? 'First floor + exits' : 'Balcony', k * half + 8, 12);
      // walls
      ctx.strokeStyle = wallC;
      ctx.lineWidth = 1;
      for (const W of geo.walls) {
        if ((W.floor === 2 ? 2 : 1) !== f || W.kind === 'column') continue;
        ctx.beginPath();
        W.pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + s * x, oy + s * y) : ctx.moveTo(ox + s * x, oy + s * y)));
        ctx.stroke();
      }
      // links
      items.forEach((it, i) => {
        if ((it.floor === 2 ? 2 : 1) !== f) return;
        const d = values ? values[i] ?? 0 : 0;
        ctx.strokeStyle = heatColor(d, dark);
        const Lw = widthOf.get(it.id) ?? Math.max(0.8, it.area / Math.max(0.5, polyLen(it.pts)));
        ctx.lineWidth = Math.max(2, s * Lw * 0.9);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        it.pts.forEach(([x, y], j) => (j ? ctx.lineTo(ox + s * x, oy + s * y) : ctx.moveTo(ox + s * x, oy + s * y)));
        ctx.stroke();
        if (highlight >= 0 && it.region === highlight) {
          ctx.strokeStyle = dark ? '#7fc4ff' : '#1259a8';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
      // managers
      for (const p of posts ?? []) {
        if ((p.floor === 2 ? 2 : 1) !== f) continue;
        const px = ox + s * p.x;
        const py = oy + s * p.y;
        if (ring) {
          ctx.strokeStyle = dark ? 'rgba(127,196,255,0.5)' : 'rgba(18,89,168,0.45)';
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, ring * s, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = p.active ? (p.W > 1 ? (dark ? '#ff8a80' : '#c62828') : dark ? '#7fc4ff' : '#1259a8') : '#999';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = ink;
        ctx.fillText(p.id, px + 7, py - 6);
      }
    });
    layout.current = L;
  }, [geo, items, values, dark, highlight, posts, ring, height, boxes, widthOf]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const k = sx < r.width / 2 ? 0 : 1;
    const Lk = layout.current[k];
    if (!Lk) return;
    const x = (sx - Lk.ox) / Lk.s;
    const y = (sy - Lk.oy) / Lk.s;
    let best = -1;
    let bd = 2.5;
    for (const it of items) {
      if ((it.floor === 2 ? 2 : 1) !== Lk.f || it.region < 0) continue;
      for (let j = 1; j < it.pts.length; j++) {
        const d = segDist(x, y, it.pts[j - 1], it.pts[j]);
        if (d < bd) {
          bd = d;
          best = it.region;
        }
      }
    }
    if (best >= 0) onPick(best);
  };

  return (
    <div>
      <canvas ref={ref} style={{ width: '100%', height, cursor: onPick ? 'pointer' : 'default' }} onClick={onClick} aria-label="Density heat map of Bailey Hall" />
      <div className="row small muted" style={{ margin: '4px 0' }}>
        <span>Density (persons/m²):</span>
        {[0, 1, 2, 3, 4, 5].map((v) => (
          <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 18, height: 10, background: heatColor(v === 0 ? 0 : v, dark), display: 'inline-block', borderRadius: 2 }} />
            {v === 5 ? '≥5' : v}
          </span>
        ))}
        {posts && <span>· ● Crowd Manager (red = workload index &gt; 1)</span>}
      </div>
    </div>
  );
}

function polyLen(pts: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

function segDist(x: number, y: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
