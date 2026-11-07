/**
 * "Model experiments" tab: paired Monte Carlo of Model A and Model B (+ Model C benchmarks per
 * seed) in Web Workers, for the current configuration, the seven interventions, an occupancy
 * sweep or the sensitivity factors. The finished report is also shown on the Results dashboard.
 */
import { useEffect, useState } from 'react';
import type { PairRecord } from '../../compare/Comparison';
import { runCompareJobs } from '../../compare/ComparePool';
import type { ComparisonReport, ExperimentKind, PhysSummary } from '../../compare/Experiments';
import { assembleReport, planCells } from '../../compare/Experiments';
import type { CompareJob } from '../../workers/CompareWorker';
import { BAILEY_HALL } from '../../geometry/BaileyHall';
import type { GeometryData } from '../../geometry/types';
import type { SimConfig } from '../../simulation/Params';
import { batchSeeds } from '../../simulation/Random';
import { workerCount } from '../../simulation/WorkerPool';
import { ReportView } from './ReportView';
import { setReport } from './ReportStore';

const RUNS = [10, 100, 500];
type What = 'current' | ExperimentKind;

export function ModelExperiments({ geo, cfg }: { geo: GeometryData; cfg: SimConfig }) {
  const [what, setWhat] = useState<What>('current');
  const [runs, setRuns] = useState(10);
  const [custom, setCustom] = useState('');
  const [seed, setSeed] = useState(2026);
  const [models, setModels] = useState<'AB' | 'B' | 'A'>('AB');
  const [bench, setBench] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number; t0: number } | null>(null);
  const [report, setRep] = useState<ComparisonReport | null>(null);
  const [cancel, setCancel] = useState<(() => void) | null>(null);
  const [err, setErr] = useState('');
  const nRuns = custom ? Math.max(1, Math.min(5000, Math.round(Number(custom) || 1))) : runs;
  const kinds: ExperimentKind[] = what === 'current' ? ['baseline'] : [what];
  const cellsPreview = planCells(kinds, geo, cfg);
  const pairs = cellsPreview.length * nRuns;
  const ms = models.split('') as ('A' | 'B')[];

  const run = () => {
    setErr('');
    setRep(null);
    const cells = planCells(kinds, geo, cfg);
    if (what === 'current') cells[0].name = `Current configuration: ${cfg.label}`;
    const seeds = batchSeeds(seed, nRuns);
    const jobs: CompareJob[] = [];
    const slot: { cell: number; run: number }[] = [];
    cells.forEach((c, ci) => {
      const g = c.geo ?? (geo === BAILEY_HALL ? undefined : geo);
      slot.push({ cell: ci, run: -1 });
      jobs.push({ kind: 'physical', cfg: c.cfg, seed: seeds[0], geo: g });
      seeds.forEach((s, ri) => {
        slot.push({ cell: ci, run: ri });
        jobs.push({ kind: 'pair', cfg: c.cfg, seed: s, opt: { models: ms, benchmarks: bench }, geo: g });
      });
    });
    const t0 = performance.now();
    setProgress({ done: 0, total: jobs.length, t0 });
    const h = runCompareJobs<unknown>(jobs, (done, total) => setProgress({ done, total, t0 }));
    setCancel(() => h.cancel);
    h.promise
      .then((res) => {
        const records: PairRecord[][] = cells.map(() => []);
        const phys: PhysSummary[] = new Array(cells.length);
        res.forEach((r, i) => {
          if (r === null || r === undefined) return;
          const s = slot[i];
          if (s.run < 0) {
            const p = r as PhysSummary & { curveImm: number[]; curvePre: number[] };
            phys[s.cell] = { maxFlow: p.maxFlow, requiredRate: p.requiredRate, flowTime: p.flowTime, tStarImm: p.tStarImm, tStarPre: p.tStarPre, cut: p.cut, exitUsageImm: p.exitUsageImm, curveImm: p.curveImm, curvePre: p.curvePre };
          } else records[s.cell].push(r as PairRecord);
        });
        if (phys.some((p) => !p)) throw new Error('cancelled before the physical analysis finished');
        const rep = assembleReport(cells, records, phys, { source: 'browser', runs: nRuns, baseSeed: seed, models: ms });
        setRep(rep);
        setReport(rep);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => {
        setProgress(null);
        setCancel(null);
      });
  };

  // optional URL control: ?cmpxrun=4&cmpxwhat=current&cmpxmodels=AB
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get('cmpxrun')) return;
    setCustom(q.get('cmpxrun')!);
    if (q.get('cmpxwhat')) setWhat(q.get('cmpxwhat') as What);
    if (q.get('cmpxmodels')) setModels(q.get('cmpxmodels') as typeof models);
    setAuto(true);
  }, []);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (auto) {
      setAuto(false);
      run();
    }
  }, [auto]);
  const eta = progress && progress.done > 0 ? ((performance.now() - progress.t0) / progress.done) * (progress.total - progress.done) / 1000 : NaN;
  return (
    <div className="mc">
      <div className="card">
        <h2>Model comparison experiments (A detailed · B network · C ideal flow)</h2>
        <p className="muted small">
          Paired random scenarios: for every seed both models simulate the identical audience (shared population generator: seats, types, speeds, reaction-time draws, compliance, knowledge,
          groups); each engine keeps its own random streams for its dynamics. Model C is recomputed for each topology and seed (ready at 0, sampled pre-movement, and each model's realised
          departure times).
        </p>
        <div className="toolbar">
          <label className="inline-ctl">
            Experiment
            <select value={what} onChange={(e) => setWhat(e.target.value as What)}>
              <option value="current">Current configuration (left panel)</option>
              <option value="interventions">Interventions (7 configurations)</option>
              <option value="occupancy">Occupancy sweep (10-100%)</option>
              <option value="sensitivity">Sensitivity (9 factors x 2 levels)</option>
            </select>
          </label>
          <span className="seg">
            {RUNS.map((r) => (
              <button key={r} className={`btn small ${!custom && runs === r ? 'on' : ''}`} onClick={() => (setRuns(r), setCustom(''))}>
                {r}
              </button>
            ))}
            <input className="small-input" placeholder="custom" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))} style={{ width: 70 }} />
          </span>
          <label className="inline-ctl">
            Base seed
            <input type="number" value={seed} onChange={(e) => setSeed(Math.max(1, Math.round(Number(e.target.value) || 1)))} style={{ width: 80 }} />
          </label>
          <label className="inline-ctl">
            Models
            <select value={models} onChange={(e) => setModels(e.target.value as typeof models)}>
              <option value="AB">A + B (paired)</option>
              <option value="B">B only (fast)</option>
              <option value="A">A only</option>
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={bench} onChange={(e) => setBench(e.target.checked)} /> Model C per seed
          </label>
          {!progress ? (
            <button className="btn primary" onClick={run} id="cmp-mc-run">
              Run {pairs} paired run{pairs === 1 ? '' : 's'}
            </button>
          ) : (
            <button className="btn" onClick={() => cancel?.()}>
              Cancel
            </button>
          )}
        </div>
        <p className="muted small">
          {cellsPreview.length} configuration{cellsPreview.length > 1 ? 's' : ''} × {nRuns} seeds on {workerCount()} workers. Rough cost per paired run: A ≈ 1.5 s, B ≈ 0.7 s, Model C ≈ 1 s per
          benchmark. Large batches are better run with <code>npm run compare</code>; its report is shown on the Results dashboard.
        </p>
        {progress && (
          <div className="progress-row">
            <progress value={progress.done} max={progress.total} />
            <span className="small">
              {progress.done}/{progress.total} jobs{Number.isFinite(eta) ? ` · about ${Math.ceil(eta)} s left` : ''}
            </span>
          </div>
        )}
        {err && <div className="stale">{err}</div>}
      </div>
      {report && <ReportView report={report} />}
    </div>
  );
}
