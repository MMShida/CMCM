/**
 * "Results dashboard": summary of the latest comparison report - from this browser session
 * (Model experiments tab) or from the CLI (`npm run compare` writes public/results/comparison-report.json).
 * Every number is taken from that report, i.e. from actual simulation runs and optimisation results.
 */
import { useEffect, useState } from 'react';
import type { CellResult, ComparisonReport } from '../../compare/Experiments';
import type { Summary } from '../../simulation/MonteCarlo';
import { Tile } from '../LiveView';
import { fmt } from '../util';
import { ReportView } from './ReportView';
import { getReport, subscribeReport } from './ReportStore';

const ci = (s?: Summary, d = 0) => (s && s.n ? `${fmt(s.mean, d)} [${fmt(s.ciLow, d)}, ${fmt(s.ciHigh, d)}]` : 'n/a');
const sig = (s?: Summary) => !!s && s.n > 1 && (s.ciLow > 0 || s.ciHigh < 0);

export function ResultsDashboard() {
  const [browser, setBrowser] = useState<ComparisonReport | null>(getReport());
  const [cli, setCli] = useState<ComparisonReport | null>(null);
  const [src, setSrc] = useState<'browser' | 'cli'>(getReport() ? 'browser' : 'cli');
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => subscribeReport((r) => (setBrowser(r), r && setSrc('browser'))), []);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}results/comparison-report.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setCli(j as ComparisonReport))
      .catch((e) => setLoadErr(String(e)));
  }, []);
  const report = src === 'browser' ? browser ?? cli : cli ?? browser;
  if (!report)
    return (
      <div className="mc">
        <div className="card">
          <h2>Results dashboard</h2>
          <p>
            No comparison report yet. Run experiments in the <b>Model experiments</b> tab, or on the command line: <code>npm run compare -- --runs 30</code> (writes
            public/results/comparison-report.json, shown here).
          </p>
          {loadErr && <p className="muted small">CLI report not found ({loadErr}).</p>}
        </div>
      </div>
    );
  const base: CellResult | undefined = report.baseline ?? report.interventions?.find((c) => c.id === 'S1') ?? report.interventions?.[0];
  const ivs = report.interventions ?? [];
  const bestFor = (m: 'A' | 'B') => {
    const c = ivs.slice(1).filter((x) => sig(m === 'A' ? x.effectA : x.effectB) && ((m === 'A' ? x.effectA : x.effectB)?.mean ?? 0) < 0);
    c.sort((a, b) => ((m === 'A' ? a.effectA : a.effectB)?.mean ?? 0) - ((m === 'A' ? b.effectA : b.effectB)?.mean ?? 0));
    return c[0];
  };
  const bA = bestFor('A');
  const bB = bestFor('B');
  const blocked = ivs.find((c) => c.id === 'S5');
  const sens = (report.sensitivity ?? []).filter((s) => s.key !== 'base');
  const swing = (m: 'A' | 'B') =>
    sens
      .map((s) => ({ label: s.label, d: Math.abs(((m === 'A' ? s.levels[1]?.effectA : s.levels[1]?.effectB)?.mean ?? NaN) - ((m === 'A' ? s.levels[0]?.effectA : s.levels[0]?.effectB)?.mean ?? NaN)) }))
      .filter((x) => Number.isFinite(x.d))
      .sort((a, b) => b.d - a.d)[0];
  const sA = swing('A');
  const sB = swing('B');
  const restrictive = base ? [...base.phys.cut].sort((a, b) => a.capacity - b.capacity).slice(0, 4) : [];
  return (
    <div className="mc dashboard">
      <div className="card">
        <div className="row">
          <h2>Results dashboard</h2>
          <span className="seg">
            <button className={`btn small ${src === 'browser' ? 'on' : ''}`} disabled={!browser} onClick={() => setSrc('browser')}>
              This session's experiment
            </button>
            <button className={`btn small ${src === 'cli' ? 'on' : ''}`} disabled={!cli} onClick={() => setSrc('cli')}>
              CLI report (npm run compare)
            </button>
          </span>
        </div>
        <p className="muted small">Model outputs under the documented assumptions; meeting 180 s in a simulation is not evidence of regulatory compliance or real-world safety.</p>
        {base && (
          <>
            <h3>Physical analysis (Model C)</h3>
            <div className="tiles">
              <Tile label="Static maximum flow F*" value={`${fmt(base.phys.maxFlow, 2)} p/s`} />
              <Tile label="Required average rate for 180 s" value={`${fmt(base.phys.requiredRate, 2)} p/s`} warn={base.phys.maxFlow < base.phys.requiredRate} />
              <Tile label="Minimum cut (capacity)" value={`${base.phys.cut.length} edges, ${fmt(base.phys.cut.reduce((s, c) => s + c.capacity, 0), 2)} p/s`} />
              <Tile label="Most restrictive cut edges" value={restrictive.map((c) => `${c.label} ${fmt(c.capacity, 2)}`).join(' · ')} />
              <Tile label="Ideal evacuation T* (ready at t = 0)" value={`${fmt(base.phys.tStarImm, 0)} s`} warn={!(base.phys.tStarImm <= 180)} />
              <Tile label="Ideal T* with sampled pre-movement" value={ci(base.stats.C?.pre)} warn={!((base.stats.C?.pre.mean ?? Infinity) <= 180)} />
            </div>
            <h3>Model comparison ({base.name})</h3>
            <div className="tiles">
              <Tile label="A detailed agent-based: mean T [95% CI]" value={`${ci(base.stats.A?.tEvac, 1)} s`} warn={!((base.stats.A?.tEvac.mean ?? Infinity) <= 180)} />
              <Tile label="B network behavioural: mean T [95% CI]" value={`${ci(base.stats.B?.tEvac, 1)} s`} warn={!((base.stats.B?.tEvac.mean ?? Infinity) <= 180)} />
              <Tile label="C ideal network flow: T* (t=0 / pre-movement)" value={`${fmt(base.stats.C?.imm.mean, 0)} / ${fmt(base.stats.C?.pre.mean, 0)} s`} />
              <Tile label="95th percentile of T across runs, A / B" value={`${fmt(base.stats.A?.tEvac.p95, 0)} / ${fmt(base.stats.B?.tEvac.p95, 0)} s`} />
              <Tile label="P(T ≤ 180 s), A / B" value={`${fmt((base.stats.A?.pMeet.p ?? NaN) * 100, 0)}% / ${fmt((base.stats.B?.pMeet.p ?? NaN) * 100, 0)}%`} />
              <Tile label="Decentralisation cost on the same graph, B − C_B" value={`${ci(base.stats.diffs.find((d) => d.label.startsWith('B - C_B')), 1)} s`} />
            </div>
          </>
        )}
        {ivs.length > 0 && (
          <>
            <h3>Interventions</h3>
            <div className="tiles">
              <Tile label="Largest significant time saving, Model A" value={bA ? `${bA.name}: ${fmt(bA.effectA?.mean, 1)} s` : 'none significant'} />
              <Tile label="Largest significant time saving, Model B" value={bB ? `${bB.name}: ${fmt(bB.effectB?.mean, 1)} s` : 'none significant'} />
              <Tile label="Worst single run (max T), A / B" value={ivs.map((c) => `${c.id} ${fmt(c.stats.A?.tEvac.max, 0)}/${fmt(c.stats.B?.tEvac.max, 0)}`).join(' · ')} />
              {blocked && <Tile label="Blocked FC2 vs no guidance, A / B" value={`${fmt(blocked.effectA?.mean, 1)} / ${fmt(blocked.effectB?.mean, 1)} s; F* ${fmt(blocked.phys.maxFlow, 2)} p/s`} />}
              <Tile label="Bottleneck shifts (most frequent largest queue), A / B" value={ivs.map((c) => `${c.id}: ${c.stats.A?.topBottleneck ?? '-'} / ${c.stats.B?.topBottleneck ?? '-'}`).join(' · ')} />
            </div>
          </>
        )}
        {sens.length > 0 && (
          <>
            <h3>Sensitivity</h3>
            <div className="tiles">
              <Tile label="Largest swing, Model A" value={sA ? `${sA.label}: ${fmt(sA.d, 0)} s` : 'n/a'} />
              <Tile label="Largest swing, Model B" value={sB ? `${sB.label}: ${fmt(sB.d, 0)} s` : 'n/a'} />
            </div>
          </>
        )}
      </div>
      <ReportView report={report} />
    </div>
  );
}
