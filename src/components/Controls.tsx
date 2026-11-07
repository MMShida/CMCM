import { useState } from 'react';
import type { ReactNode } from 'react';

export function Section({ title, children, open = false, badge }: { title: string; children: ReactNode; open?: boolean; badge?: string }) {
  const [o, setO] = useState(open);
  return (
    <div className={`section ${o ? 'open' : ''}`}>
      <button className="section-head" onClick={() => setO(!o)} aria-expanded={o}>
        <span className="chev">{o ? '▾' : '▸'}</span> {title}
        {badge && <span className="badge">{badge}</span>}
      </button>
      {o && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Slider({ label, value, min, max, step, unit = '', tip, onChange, format }: { label: string; value: number; min: number; max: number; step: number; unit?: string; tip?: string; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="ctl" title={tip}>
      <span className="ctl-label">
        {label}
        {tip && <span className="info">ⓘ</span>}
      </span>
      <span className="ctl-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <input
          className="num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? +value.toFixed(4) : ''}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        <span className="unit">{format ? format(value) : unit}</span>
      </span>
    </label>
  );
}

export function Toggle({ label, value, onChange, tip }: { label: string; value: boolean; onChange: (v: boolean) => void; tip?: string }) {
  return (
    <label className="toggle" title={tip}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange, tip }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; tip?: string }) {
  return (
    <label className="ctl" title={tip}>
      <span className="ctl-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NumberField({ label, value, onChange, tip, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; tip?: string; step?: number; min?: number; max?: number }) {
  return (
    <label className="ctl inline" title={tip}>
      <span className="ctl-label">{label}</span>
      <input className="num wide" type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
