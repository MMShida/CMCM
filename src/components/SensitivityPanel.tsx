import { useRef, useState } from 'react';
import type { GeometryData } from '../geometry/types';
import type { RunSummary } from '../simulation/MonteCarlo';
import { PERTURBATIONS, batchSeeds, batchStats, perturbed } from '../simulation/MonteCarlo';
import type { SimConfig } from '../simulation/Params';
import { runBatchInWorkers } from '../simulation/WorkerPool';
import { Tornado } from './Charts';
import { download, fmt, pct } from './util';

interface Row {
  key: string;
  label: string;
  lowV: number;
  highV: number;
  unit: string;
  low: RunSummary[];
  high: RunSummary[];
}

export function SensitivityPanel({ geo, cfg, bundled }: { geo: GeometryData; cfg: SimConfig; bundled: boolean }) {
  const [runs, setRuns] = useState(20);
  const [baseSeed, setBaseSeed] = useState(7);
  const [keys, setKeys] = useState<string[]>(PERTURBATIONS.filter((p) => p.key !== 'ledCompliance' || cfg.led.enabled).map((p) => p.key));
  const [metric, setMetric] = useState<'mean' | 'p95' | 'pMeet'>('mean');
  const [base, setBase] = useState<RunSummary[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const stop = useRef(false);
  const cancel = useRef<(() => void) | null>(null);

  const go = async () => {
    stop.current = false;
    const seeds = batchSeeds(baseSeed, runs);
    setRows([]);
    const exec = async (c: SimConfig, label: string) => {
      const h = runBatchInWorkers(c, seeds, (d, n) => setProgress(`${label}: ${d}/${n}`), bundled ? undefined : geo);
      cancel.current = h.cancel;
      return h.promise;
    };
    const b = await exec(cfg, 'baseline');
    setBase(b);
    const out: Row[] = [];
    for (const p of PERTURBATIONS.filter((x) => keys.includes(x.key))) {
      if (stop.current) break;
      const baseVal = p.base(cfg);
      const lowV = p.unit === 'x' ? p.low : p.low;
      const highV = p.unit === 'x' ? p.high : p.high;
      const low = await exec(perturbed(cfg, p, lowV), `${p.label} low`);
      const high = await exec(perturbed(cfg, p, highV), `${p.label} high`);
      out.push({ key: p.key, label: `${p.label} (${p.unit === 'x' ? `x${lowV} / x${highV}` : `${lowV} / ${highV} ${p.unit}; base ${fmt(baseVal, 2)}`})`, lowV, highV, unit: p.unit, low, high });
      setRows([...out]);
    }
    setProgress(null);
  };
  const val = (r: RunSummary[]) => {
    const s = batchStats('', r);
    return metric === 'mean' ? s.tEvac.mean : metric === 'p95' ? s.tEvac.p95 : s.pMeet.p * 100;
  };
  const baseVal = base ? val(base) : NaN;

  return (
    <div className="page">
      <h2>Sensitivity analysis (one parameter at a time)</h2>
      <p className="muted">
        Each parameter is set to a low and a high value while everything else stays at the current configuration ({cfg.label}). All variants share the same seeds, so differences are paired. The tornado ranks parameters by the swing they cause.
      </p>
      <div className="chips">
        {PERTURBATIONS.map((p) => (
          <label key={p.key} className="toggle">
            <input type="checkbox" checked={keys.includes(p.key)} onChange={(e) => setKeys(e.target.checked ? [...keys, p.key] : keys.filter((k) => k !== p.key))} />
            <span>
              {p.label} ({p.low} / {p.high} {p.unit})
            </span>
          </label>
        ))}
      </div>
      <div className="row">
        <label className="inline-ctl">
          runs per point
          <input className="num wide" type="number" min={2} value={runs} onChange={(e) => setRuns(Math.max(2, Number(e.target.value)))} />
        </label>
        <label className="inline-ctl">
          base seed
          <input className="num wide" type="number" value={baseSeed} onChange={(e) => setBaseSeed(Number(e.target.value))} />
        </label>
        <label className="inline-ctl">
          metric
          <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
            <option value="mean">mean evacuation time</option>
            <option value="p95">95th percentile of evacuation time</option>
            <option value="pMeet">P(T ≤ 180 s) (%)</option>
          </select>
        </label>
        {!progress ? (
          <button className="btn primary" onClick={go}>
            Run ({(2 * keys.length + 1) * runs} simulations)
          </button>
        ) : (
          <button className="btn" onClick={() => ((stop.current = true), cancel.current?.())}>
            Stop
          </button>
        )}
        {progress && <span className="small">{progress}</span>}
      </div>
      {base && rows.length > 0 && (
        <>
          <div className="card">
            <h3>Tornado: {metric === 'pMeet' ? 'probability of meeting 180 s' : metric === 'p95' ? '95th percentile of T' : 'mean T'}</h3>
            <Tornado items={rows.map((r) => ({ label: r.label.split(' (')[0], low: val(r.low), high: val(r.high), lowLabel: `low (${r.lowV} ${r.unit})`, highLabel: `high (${r.highV} ${r.unit})` }))} base={baseVal} unit={metric === 'pMeet' ? '%' : 's'} />
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Low value: mean T [CI]</th>
                <th>High value: mean T [CI]</th>
                <th>P180 low / high</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lo = batchStats('', r.low);
                const hi = batchStats('', r.high);
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td>
                      {fmt(lo.tEvac.mean)} [{fmt(lo.tEvac.ciLow)}, {fmt(lo.tEvac.ciHigh)}]
                    </td>
                    <td>
                      {fmt(hi.tEvac.mean)} [{fmt(hi.tEvac.ciLow)}, {fmt(hi.tEvac.ciHigh)}]
                    </td>
                    <td>
                      {pct(lo.pMeet.p)} / {pct(hi.pMeet.p)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn" onClick={() => download('sensitivity.json', JSON.stringify({ baseSeed, runs, baseline: batchStats('baseline', base), rows: rows.map((r) => ({ key: r.key, label: r.label, low: batchStats('low', r.low), high: batchStats('high', r.high) })) }, null, 1), 'application/json')}>
            Export (JSON)
          </button>
        </>
      )}
    </div>
  );
}
