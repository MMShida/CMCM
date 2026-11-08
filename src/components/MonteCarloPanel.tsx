import { useEffect, useRef, useState } from 'react';
import type { GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { BatchStats, RunSummary } from '../simulation/MonteCarlo';
import { batchSeeds, batchStats, quantileSorted } from '../simulation/MonteCarlo';
import type { SimConfig } from '../simulation/Params';
import type { BatchHandle } from '../simulation/WorkerPool';
import { runBatchInWorkers, workerCount } from '../simulation/WorkerPool';
import { HBarChart, Histogram, LineChart } from './Charts';
import { Tile } from './LiveView';
import { GROUP_COLOR_INDEX, GROUP_SHORT, download, fmt, pct, seriesColor, toCsv } from './util';

export function StatsTable({ s }: { s: BatchStats }) {
  const row = (name: string, x: BatchStats['tEvac'], unit = 's') => (
    <tr key={name}>
      <th>{name}</th>
      <td>{fmt(x.mean)}</td>
      <td>
        [{fmt(x.ciLow)}, {fmt(x.ciHigh)}]
      </td>
      <td>{fmt(x.median)}</td>
      <td>{fmt(x.sd)}</td>
      <td>
        {fmt(x.p5)} - {fmt(x.p95)}
      </td>
      <td>
        {x.nValid}/{x.n}
      </td>
      <td>{unit}</td>
    </tr>
  );
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Mean</th>
          <th>95% CI of mean</th>
          <th>Median</th>
          <th>SD</th>
          <th>p5 - p95</th>
          <th>Valid runs</th>
          <th>Unit</th>
        </tr>
      </thead>
      <tbody>
        {row('Total evacuation time (last person out)', s.tEvac)}
        {row('Last ambulatory person out', s.tEvacAmbulatory)}
        {row('Last ambulatory person at street level', s.tSafe)}
        {row('Mean individual exit time', s.meanExit)}
        {row('95th-percentile individual exit time', s.p95Exit)}
        {s.p99Exit && row('99th-percentile individual exit time', s.p99Exit)}
        {s.insideAt180 && row('Persons still inside at 180 s', s.insideAt180, 'persons')}
        {s.tSafeAll && row('Last person incl. assisted wheelchair users at street', s.tSafeAll)}
        {row('Median start time', s.medianStart)}
        {row('Peak local density', s.peakDensity, 'p/m²')}
        {row('Exposure above 3.5 p/m²', s.exposure, 'person-s')}
        {row('Exit load imbalance (max/mean)', s.imbalance, '-')}
      </tbody>
    </table>
  );
}

export interface StudyReplay { model:'A'|'B'|'Lite'; seeds:number[]; label:string; expectedMean:number|null; cfg:SimConfig }
export function MonteCarloPanel({ geo, cfg, bundled, replay, clearReplay }: { geo: GeometryData; cfg: SimConfig; bundled: boolean; replay?:StudyReplay|null; clearReplay?:()=>void }) {
  const [model,setModel] = useState<'A'|'B'|'Lite'>(replay?.model ?? 'A');
  const [runs, setRuns] = useState(replay?.seeds.length ?? 100);
  const [baseSeed, setBaseSeed] = useState(2026);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<RunSummary[] | null>(null);
  const [cfgUsed, setCfgUsed] = useState<SimConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const handle = useRef<BatchHandle | null>(null);
  const t0 = useRef(0);

  const start = () => {
    const seeds = replay ? replay.seeds : batchSeeds(baseSeed, runs);
    setResults(null);
    setErr(null);
    setProgress({ done: 0, total: runs });
    setCfgUsed(cfg);
    t0.current = performance.now();
    const partial: RunSummary[] = [];
    handle.current = runBatchInWorkers(cfg, seeds, (d, n, last) => {
      if (last) partial.push(last);
      setProgress({ done: d, total: n });
    }, bundled ? undefined : geo, model);
    handle.current.promise.then((r) => {
      setResults(r);
      setProgress(null);
    }, (e) => {
      setErr(String(e));
      setProgress(null);
    });
  };
  // optional URL trigger (?tab=mc&mcrun=10) used for automated UI checks
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('mcrun');
    if (q) {
      setRuns(Number(q));
      setTimeout(() => document.getElementById('mc-start')?.click(), 50);
    }
  }, []);
  const stats = results && cfgUsed ? batchStats(cfgUsed.label, results) : null;
  const curves = results ? meanCurve(results) : null;

  return (
    <div className="page">
      <h2>Monte Carlo simulation · model {model}</h2>
      {replay && <p className="card">Replaying {replay.label} on its exact {replay.seeds.length} archived seeds. Published mean: {replay.expectedMean?.toFixed(3) ?? 'unresolved'} s. {JSON.stringify(cfg)!==JSON.stringify(replay.cfg) ? 'Configuration edited: this is no longer an exact reproduction.' : 'Configuration matches the archived study.'}</p>}
      <p className="muted">
        Configuration: <b>{cfg.label}</b> (edit it in the left panel). Each replication re-samples the audience, reaction times, behaviour types and all stochastic decisions; scenario parameters stay fixed.
        Runs execute in {workerCount()} Web Workers (headless, no rendering), so the interface stays responsive.
      </p>
      <div className="row">
        {replay ? <button className="btn small" onClick={clearReplay} disabled={!!progress}>Leave exact replay</button> : <label>Model <select value={model} onChange={e=>setModel(e.target.value as typeof model)} disabled={!!progress}><option>A</option><option>B</option><option value="Lite">A-Lite</option></select></label>}
        {!replay && <><span className="seg">
          {[1, 10, 100, 500].map((n) => (
            <button key={n} className={`btn small ${runs === n ? 'on' : ''}`} onClick={() => setRuns(n)}>
              {n}
            </button>
          ))}
        </span>
        <label className="inline-ctl">
          custom
          <input className="num wide" type="number" min={1} max={5000} value={runs} onChange={(e) => setRuns(Math.max(1, Number(e.target.value)))} />
        </label>
        <label className="inline-ctl" title="the seed list is derived deterministically from this base seed">
          base seed
          <input className="num wide" type="number" value={baseSeed} onChange={(e) => setBaseSeed(Number(e.target.value))} />
        </label>
        </>}
        {!progress ? (
          <button id="mc-start" className="btn primary" onClick={start}>
            Run {runs} simulations
          </button>
        ) : (
          <button className="btn" onClick={() => handle.current?.cancel()}>
            Cancel
          </button>
        )}
      </div>
      {progress && (
        <div className="batch-progress">
          <div className="progress">
            <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <span className="small">
            {progress.done}/{progress.total} runs · {fmt((performance.now() - t0.current) / 1000, 0)} s elapsed
          </span>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      {stats && results && curves && cfgUsed && (
        <>
          <div className="tiles">
            <Tile label="Mean evacuation time (95% CI)" value={`${fmt(stats.tEvac.mean)} s [${fmt(stats.tEvac.ciLow)}, ${fmt(stats.tEvac.ciHigh)}]`} />
            <Tile label="Median / SD" value={`${fmt(stats.tEvac.median)} / ${fmt(stats.tEvac.sd)} s`} />
            <Tile label="5th - 95th percentile" value={`${fmt(stats.tEvac.p5)} - ${fmt(stats.tEvac.p95)} s`} />
            <Tile label="P(evacuated within 180 s)" value={`${pct(stats.pMeet.p, 1)} [${pct(stats.pMeet.lo, 0)}, ${pct(stats.pMeet.hi, 0)}]`} warn={stats.pMeet.p < 0.95} />
            <Tile label="Runs with unresolved agents" value={pct(stats.fracUnresolved, 1)} warn={stats.fracUnresolved > 0} />
            <Tile label="Runs ending in gridlock" value={pct(stats.fracGridlock, 1)} warn={stats.fracGridlock > 0} />
            {stats.insideAt180 && <Tile label="Still inside at 180 s (mean)" value={`${fmt(stats.insideAt180.mean, 0)} persons`} warn={stats.insideAt180.mean > 0} />}
          </div>
          <p className="muted small">
            Benchmark statistics count unfinished runs as failures. Simulated estimates are conditional on the documented assumptions; they are not a proof of regulatory compliance or real-world safety.
          </p>
          <StatsTable s={stats} />
          <div className="grid2">
            <div className="card">
              <h3>Completion-time histogram ({results.length} runs)</h3>
              <Histogram values={results.map((r) => r.tEvac)} xLabel="total evacuation time (s)" refX={180} />
            </div>
            <div className="card">
              <h3>Persons inside vs time (mean, p5-p95 band)</h3>
              <LineChart series={[{ name: 'mean inside', color: seriesColor(0), values: curves.mean, band: { lo: curves.lo, hi: curves.hi } }]} xLabel="time (s)" yLabel="persons inside" refX={180} />
            </div>
            <TailCard results={results} />
            <div className="card">
              <h3>Mean exit utilisation</h3>
              <HBarChart items={EXIT_GROUPS.map((g) => ({ label: GROUP_SHORT[g], value: stats.meanUsage[g], color: seriesColor(GROUP_COLOR_INDEX[g]) }))} />
            </div>
            <div className="card">
              <h3>Mean maximum queue per bottleneck (top 12)</h3>
              <HBarChart
                items={Object.entries(stats.meanMaxQueue)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 12)
                  .map(([k, v]) => ({ label: k, value: v, color: seriesColor(7) }))}
              />
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => download('batch-runs.csv', toCsv(results.map(({ inside, exitGroupUsage, maxQueue, meanWait, ...r }) => ({ ...r, ...Object.fromEntries(Object.entries(exitGroupUsage).map(([k, v]) => [`use_${k}`, v])) }))), 'text/csv')}>
              Export runs (CSV)
            </button>
            <button className="btn" onClick={() => download('batch-summary.json', JSON.stringify({ config: cfgUsed, baseSeed, seeds: results.map((r) => r.seed), stats }, null, 1), 'application/json')}>
              Export statistics + parameters (JSON)
            </button>
            <button className="btn" onClick={() => download('batch-curves.csv', toCsv(curves.mean.map((m, i) => ({ t: i, mean_inside: m, p5: curves.lo[i], p95: curves.hi[i] }))), 'text/csv')}>
              Export evacuation curves (CSV)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Who sets the evacuation time: composition of the last 20 persons out and clearance per level. */
export function TailCard({ results }: { results: RunSummary[] }) {
  const R = results.length;
  if (!R || !results[0].lastOut) return null;
  const zones: Record<string, number> = {};
  for (const r of results) for (const [z, n] of Object.entries(r.lastOut?.zones ?? {})) zones[z] = (zones[z] ?? 0) + n / R;
  const avg = (f: (r: RunSummary) => number) => results.reduce((s, r) => s + (Number.isFinite(f(r)) ? f(r) : 0), 0) / R;
  const levels = ['orchestra', 'mezzanine', 'balcony'];
  return (
    <div className="card">
      <h3>Who sets the evacuation time (last 20 out, mean per run)</h3>
      <HBarChart
        items={Object.entries(zones)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => ({ label: k, value: v, color: seriesColor(3) }))}
      />
      <p className="small muted">
        elderly {pct(avg((r) => r.lastOut?.elderlyShare ?? NaN), 0)} · in groups {pct(avg((r) => r.lastOut?.groupShare ?? NaN), 0)} · started moving at {fmt(avg((r) => r.lastOut?.meanStart ?? NaN), 0)} s ·
        queued {fmt(avg((r) => r.lastOut?.meanWait ?? NaN), 0)} s
      </p>
      <p className="small muted">
        Level cleared (mean): {levels.map((l) => `${l} ${fmt(avg((r) => r.clearanceByLevel?.[l] ?? NaN), 0)} s`).join(' · ')}
      </p>
    </div>
  );
}

export function meanCurve(runs: RunSummary[]) {
  const len = Math.max(...runs.map((r) => r.inside.length));
  const mean: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (let t = 0; t < len; t++) {
    const v = runs.map((r) => (t < r.inside.length ? r.inside[t] : r.inside[r.inside.length - 1] ?? 0)).sort((a, b) => a - b);
    mean.push(v.reduce((a, b) => a + b, 0) / v.length);
    lo.push(quantileSorted(v, 0.05));
    hi.push(quantileSorted(v, 0.95));
  }
  return { mean, lo, hi };
}
