/**
 * Lightweight SVG charts (no external library). Single y-axis everywhere,
 * recessive grid, 2px lines, hover tooltips, legends for >= 2 series.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { quantileSorted } from '../simulation/MonteCarlo';
import { fmt } from './util';

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const el = tip ? (
    <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
      {tip.content}
    </div>
  ) : null;
  return { tip: el, setTip };
}

function niceTicks(min: number, max: number, n = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min || 0, (min || 0) + 1];
  const span = max - min;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const M = { l: 48, r: 14, t: 10, b: 34 };

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  band?: { lo: number[]; hi: number[] };
  dashed?: boolean;
}

export function LineChart({ series, xLabel, yLabel, height = 220, refX, yMax }: { series: LineSeries[]; xLabel: string; yLabel: string; height?: number; refX?: number; yMax?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { tip, setTip } = useTip();
  const [hx, setHx] = useState<number | null>(null);
  const W = 560;
  const H = height;
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const ymax = yMax ?? Math.max(1, ...series.flatMap((s) => [...s.values, ...(s.band?.hi ?? [])]).filter(Number.isFinite));
  const xmax = Math.max(n - 1, refX ? refX * 1.05 : 0);
  const X = (i: number) => M.l + (i / Math.max(1, xmax)) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - M.l) / (W - M.l - M.r)) * xmax);
    if (i < 0 || i >= n) return setTip(null);
    setHx(i);
    const wr = wrap.current!.getBoundingClientRect();
    setTip({
      x: e.clientX - wr.left,
      y: e.clientY - wr.top,
      content: (
        <>
          <b>t = {i} s</b>
          {series.map((s) => (
            <div key={s.name}>
              <span className="swatch" style={{ background: s.color }} /> {s.name}: {fmt(s.values[i] ?? NaN, 0)}
            </div>
          ))}
        </>
      ),
    });
  };
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => (setTip(null), setHx(null))}>
        {niceTicks(0, ymax).map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} className="grid" />
            <text x={M.l - 6} y={Y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {niceTicks(0, xmax, 7).map((t) => (
          <text key={t} x={X(t)} y={H - M.b + 14} className="tick" textAnchor="middle">
            {t}
          </text>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} className="axis" />
        {refX !== undefined && (
          <g>
            <line x1={X(refX)} x2={X(refX)} y1={M.t} y2={H - M.b} className="ref" />
            <text x={X(refX) + 4} y={M.t + 10} className="tick">
              {refX} s benchmark
            </text>
          </g>
        )}
        {series.map((s) => s.band && <path key={`b${s.name}`} d={`${path(s.band.hi)}L${X(s.band.lo.length - 1)},${Y(s.band.lo[s.band.lo.length - 1])}${s.band.lo.map((v, i) => `L${X(s.band!.lo.length - 1 - i)},${Y(s.band!.lo[s.band!.lo.length - 1 - i])}`).join('')}Z`} fill={s.color} opacity={0.15} />)}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />
        ))}
        {hx !== null && <line x1={X(hx)} x2={X(hx)} y1={M.t} y2={H - M.b} className="crosshair" />}
        <text x={(M.l + W - M.r) / 2} y={H - 4} className="axis-label" textAnchor="middle">
          {xLabel}
        </text>
        <text x={12} y={(H - M.b) / 2} className="axis-label" textAnchor="middle" transform={`rotate(-90 12 ${(H - M.b) / 2})`}>
          {yLabel}
        </text>
      </svg>
      {series.length > 1 && <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />}
      {tip}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.name}>
          <span className="swatch" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

export function Histogram({ values, xLabel, refX, color = '#2a78d6', bins = 24 }: { values: number[]; xLabel: string; refX?: number; color?: string; bins?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { tip, setTip } = useTip();
  const v = values.filter(Number.isFinite);
  const W = 560;
  const H = 200;
  const lo = Math.min(...v, refX ?? Infinity);
  const hi = Math.max(...v, refX ?? -Infinity);
  const span = Math.max(1, hi - lo);
  const bw = span / bins;
  const counts = new Array(bins).fill(0);
  for (const x of v) counts[Math.min(bins - 1, Math.floor((x - lo) / bw))]++;
  const cmax = Math.max(1, ...counts);
  const X = (x: number) => M.l + ((x - lo) / span) * (W - M.l - M.r);
  const Y = (c: number) => H - M.b - (c / cmax) * (H - M.t - M.b);
  if (!v.length) return <div className="empty">No finished runs.</div>;
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setTip(null)}>
        {niceTicks(0, cmax, 4).map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} className="grid" />
            <text x={M.l - 6} y={Y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {counts.map((c, i) => (
          <rect
            key={i}
            x={X(lo + i * bw) + 1}
            y={Y(c)}
            width={Math.max(1, X(lo + (i + 1) * bw) - X(lo + i * bw) - 2)}
            height={H - M.b - Y(c)}
            rx={2}
            fill={color}
            onMouseMove={(e) => {
              const wr = wrap.current!.getBoundingClientRect();
              setTip({ x: e.clientX - wr.left, y: e.clientY - wr.top, content: <>{fmt(lo + i * bw, 0)}-{fmt(lo + (i + 1) * bw, 0)} s: <b>{c}</b> runs</> });
            }}
          />
        ))}
        {niceTicks(lo, hi, 6).map((t) => (
          <text key={t} x={X(t)} y={H - M.b + 14} className="tick" textAnchor="middle">
            {t}
          </text>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} className="axis" />
        {refX !== undefined && <line x1={X(refX)} x2={X(refX)} y1={M.t} y2={H - M.b} className="ref" />}
        <text x={(M.l + W - M.r) / 2} y={H - 4} className="axis-label" textAnchor="middle">
          {xLabel}
        </text>
        <text x={12} y={(H - M.b) / 2} className="axis-label" textAnchor="middle" transform={`rotate(-90 12 ${(H - M.b) / 2})`}>
          runs
        </text>
      </svg>
      {tip}
    </div>
  );
}

export function BoxPlot({ items, xLabel, refX }: { items: { label: string; values: number[]; color: string }[]; xLabel: string; refX?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { tip, setTip } = useTip();
  const stats = useMemo(
    () =>
      items.map((it) => {
        const s = it.values.filter(Number.isFinite).sort((a, b) => a - b);
        return { ...it, s, p5: quantileSorted(s, 0.05), q1: quantileSorted(s, 0.25), med: quantileSorted(s, 0.5), q3: quantileSorted(s, 0.75), p95: quantileSorted(s, 0.95), mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length) };
      }),
    [items],
  );
  const all = stats.flatMap((s) => s.s);
  if (!all.length) return <div className="empty">No data.</div>;
  const lo = Math.min(...all, refX ?? Infinity) * 0.95;
  const hi = Math.max(...all, refX ?? -Infinity) * 1.02;
  const W = 560;
  const rowH = 28;
  const L = 170;
  const H = stats.length * rowH + 40;
  const X = (x: number) => L + ((x - lo) / (hi - lo)) * (W - L - M.r);
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setTip(null)}>
        {niceTicks(lo, hi, 6).map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={6} y2={H - 30} className="grid" />
            <text x={X(t)} y={H - 16} className="tick" textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {refX !== undefined && <line x1={X(refX)} x2={X(refX)} y1={6} y2={H - 30} className="ref" />}
        {stats.map((s, k) => {
          const y = 14 + k * rowH;
          return (
            <g
              key={s.label}
              onMouseMove={(e) => {
                const wr = wrap.current!.getBoundingClientRect();
                setTip({
                  x: e.clientX - wr.left,
                  y: e.clientY - wr.top,
                  content: (
                    <>
                      <b>{s.label}</b>
                      <div>p5 {fmt(s.p5)} | Q1 {fmt(s.q1)} | median {fmt(s.med)} | Q3 {fmt(s.q3)} | p95 {fmt(s.p95)}</div>
                      <div>mean {fmt(s.mean)} s, n = {s.s.length}</div>
                    </>
                  ),
                });
              }}
            >
              <text x={L - 8} y={y + 6} className="tick" textAnchor="end" dominantBaseline="middle">
                {s.label}
              </text>
              <line x1={X(s.p5)} x2={X(s.p95)} y1={y + 6} y2={y + 6} stroke={s.color} strokeWidth={2} />
              <rect x={X(s.q1)} y={y} width={Math.max(2, X(s.q3) - X(s.q1))} height={12} rx={3} fill={s.color} opacity={0.35} stroke={s.color} />
              <line x1={X(s.med)} x2={X(s.med)} y1={y - 1} y2={y + 13} stroke={s.color} strokeWidth={3} />
              <circle cx={X(s.mean)} cy={y + 6} r={3.5} fill="var(--surface)" stroke={s.color} strokeWidth={2} />
              <rect x={L} y={y - 6} width={W - L} height={rowH - 4} fill="transparent" />
            </g>
          );
        })}
        <text x={(L + W) / 2} y={H - 2} className="axis-label" textAnchor="middle">
          {xLabel} (box = quartiles, whiskers = p5-p95, line = median, dot = mean)
        </text>
      </svg>
      {tip}
    </div>
  );
}

export function HBarChart({ items, unit = '', maxValue }: { items: { label: string; value: number; color: string; err?: [number, number]; note?: string }[]; unit?: string; maxValue?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { tip, setTip } = useTip();
  const W = 560;
  const rowH = 22;
  const L = 150;
  const H = items.length * rowH + 10;
  const vmax = maxValue ?? Math.max(1e-9, ...items.map((i) => Math.max(i.value, i.err?.[1] ?? 0)));
  const X = (v: number) => L + (v / vmax) * (W - L - 60);
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setTip(null)}>
        {items.map((it, k) => {
          const y = 4 + k * rowH;
          return (
            <g
              key={it.label}
              onMouseMove={(e) => {
                const wr = wrap.current!.getBoundingClientRect();
                setTip({ x: e.clientX - wr.left, y: e.clientY - wr.top, content: <><b>{it.label}</b>: {fmt(it.value, unit === '%' ? 1 : 1)}{unit}{it.err ? ` [${fmt(it.err[0])}, ${fmt(it.err[1])}]` : ''}{it.note ? <div>{it.note}</div> : null}</> });
              }}
            >
              <text x={L - 8} y={y + 8} className="tick" textAnchor="end" dominantBaseline="middle">
                {it.label}
              </text>
              <rect x={L} y={y + 1} width={Math.max(0, X(it.value) - L)} height={14} rx={3} fill={it.color} />
              {it.err && <line x1={X(it.err[0])} x2={X(it.err[1])} y1={y + 8} y2={y + 8} stroke="var(--text)" strokeWidth={1.5} />}
              <text x={X(Math.max(it.value, it.err?.[1] ?? 0)) + 6} y={y + 8} className="tick" dominantBaseline="middle">
                {fmt(it.value, unit === '%' ? 0 : 1)}
                {unit}
              </text>
            </g>
          );
        })}
      </svg>
      {tip}
    </div>
  );
}

export function Tornado({ items, base, unit = 's' }: { items: { label: string; low: number; high: number; lowLabel: string; highLabel: string }[]; base: number; unit?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { tip, setTip } = useTip();
  const sorted = [...items].sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  const W = 560;
  const rowH = 26;
  const L = 200;
  const H = sorted.length * rowH + 34;
  const vals = sorted.flatMap((i) => [i.low, i.high, base]).filter(Number.isFinite);
  if (!vals.length) return <div className="empty">No data.</div>;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 + 1;
  const X = (v: number) => L + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - L - 20);
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setTip(null)}>
        {niceTicks(lo - pad, hi + pad, 6).map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={4} y2={H - 28} className="grid" />
            <text x={X(t)} y={H - 14} className="tick" textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <line x1={X(base)} x2={X(base)} y1={2} y2={H - 28} className="ref" />
        {sorted.map((it, k) => {
          const y = 6 + k * rowH;
          return (
            <g
              key={it.label}
              onMouseMove={(e) => {
                const wr = wrap.current!.getBoundingClientRect();
                setTip({ x: e.clientX - wr.left, y: e.clientY - wr.top, content: <><b>{it.label}</b><div>{it.lowLabel}: {fmt(it.low)} {unit}</div><div>{it.highLabel}: {fmt(it.high)} {unit}</div><div>baseline {fmt(base)} {unit}</div></> });
              }}
            >
              <text x={L - 8} y={y + 8} className="tick" textAnchor="end" dominantBaseline="middle">
                {it.label}
              </text>
              <rect x={Math.min(X(base), X(it.low))} y={y + 1} width={Math.abs(X(it.low) - X(base))} height={14} rx={3} fill="#2a78d6" />
              <rect x={Math.min(X(base), X(it.high))} y={y + 1} width={Math.abs(X(it.high) - X(base))} height={14} rx={3} fill="#eb6834" />
              <rect x={L} y={y - 4} width={W - L} height={rowH - 2} fill="transparent" />
            </g>
          );
        })}
        <text x={(L + W) / 2} y={H - 1} className="axis-label" textAnchor="middle">
          mean evacuation time ({unit}); line = baseline
        </text>
      </svg>
      <Legend items={[{ name: 'low parameter value', color: '#2a78d6' }, { name: 'high parameter value', color: '#eb6834' }]} />
      {tip}
    </div>
  );
}
