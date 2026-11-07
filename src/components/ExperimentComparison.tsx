import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { BatchStats, PairedDiff, RunSummary } from '../simulation/MonteCarlo';
import { batchSeeds, batchStats, pairedComparison } from '../simulation/MonteCarlo';
import type { SimConfig } from '../simulation/Params';
import { cloneConfig } from '../simulation/Params';
import { STRATEGIES } from '../simulation/Scenarios';
import { runBatchInWorkers } from '../simulation/WorkerPool';
import { BoxPlot, HBarChart, LineChart } from './Charts';
import { meanCurve } from './MonteCarloPanel';
import { GROUP_SHORT, download, fmt, pct, seriesColor, toCsv } from './util';

interface Strat {
  id: string;
  name: string;
  cfg: SimConfig;
}

const LS_KEY = 'bailey.savedStrategies';
function loadSaved(): Strat[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function ExperimentComparison({ geo, cfg, bundled }: { geo: GeometryData; cfg: SimConfig; bundled: boolean }) {
  const [saved, setSaved] = useState<Strat[]>(loadSaved);
  const builtins: Strat[] = useMemo(() => STRATEGIES.map((s) => ({ id: s.id, name: s.name, cfg: s.build(geo) })), [geo]);
  const all = [...builtins, ...saved, { id: 'CURRENT', name: `Current configuration (${cfg.label})`, cfg }];
  const [chosen, setChosen] = useState<string[]>(['S0', 'S1', 'S2', 'S3', 'S4']);
  const [runs, setRuns] = useState(40);
  const [baseSeed, setBaseSeed] = useState(2026);
  const [refId, setRefId] = useState('S1');
  const [progress, setProgress] = useState<string | null>(null);
  const [res, setRes] = useState<{ strat: Strat; runs: RunSummary[]; stats: BatchStats }[] | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const stopped = useRef(false);

  const run = async () => {
    const seeds = batchSeeds(baseSeed, runs);
    const out: { strat: Strat; runs: RunSummary[]; stats: BatchStats }[] = [];
    stopped.current = false;
    setRes(null);
    for (const id of chosen) {
      const s = all.find((x) => x.id === id);
      if (!s || stopped.current) continue;
      const h = runBatchInWorkers(s.cfg, seeds, (d, n) => setProgress(`${s.name}: ${d}/${n}`), bundled ? undefined : geo);
      cancelRef.current = h.cancel;
      const r = await h.promise;
      out.push({ strat: s, runs: r, stats: batchStats(s.name, r) });
      setRes([...out]);
    }
    setProgress(null);
  };

  // optional URL trigger (?tab=exp&exprun=8&strats=S0,S1,S2) for automated checks
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('exprun')) {
      setRuns(Number(q.get('exprun')));
      if (q.get('strats')) setChosen(q.get('strats')!.split(','));
      setTimeout(() => document.getElementById('exp-start')?.click(), 80);
    }
  }, []);
  const ref = res?.find((r) => r.strat.id === refId) ?? res?.[0];
  const diffs: Record<string, PairedDiff[]> = {};
  if (res && ref) for (const r of res) diffs[r.strat.id] = pairedComparison(ref.runs, r.runs);

  return (
    <div className="page">
      <h2>Experiment mode: compare strategies</h2>
      <p className="muted">
        Every strategy is run on the <b>same list of seeds</b> (common random numbers: identical audiences, seats, reaction times and behaviour types), so paired differences isolate the effect of the intervention. Robustness
        matters more than the single fastest run: look at the 95th percentile, the probability of meeting 180 s and the density metrics.
      </p>
      <div className="strat-list">
        {all.map((s) => (
          <label key={s.id} className="toggle">
            <input type="checkbox" checked={chosen.includes(s.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))} />
            <span>{s.name}</span>
            {saved.some((x) => x.id === s.id) && (
              <button
                className="btn tiny"
                onClick={() => {
                  const n = saved.filter((x) => x.id !== s.id);
                  setSaved(n);
                  localStorage.setItem(LS_KEY, JSON.stringify(n));
                }}
              >
                remove
              </button>
            )}
          </label>
        ))}
      </div>
      <div className="row">
        <button
          className="btn small"
          onClick={() => {
            const name = prompt('Name for the current configuration:', cfg.label);
            if (!name) return;
            const n = [...saved, { id: `U${Date.now()}`, name, cfg: cloneConfig(cfg) }];
            setSaved(n);
            localStorage.setItem(LS_KEY, JSON.stringify(n));
          }}
        >
          Save current configuration as a strategy
        </button>
        <label className="inline-ctl">
          runs per strategy
          <input className="num wide" type="number" min={2} max={2000} value={runs} onChange={(e) => setRuns(Math.max(2, Number(e.target.value)))} />
        </label>
        <label className="inline-ctl">
          base seed
          <input className="num wide" type="number" value={baseSeed} onChange={(e) => setBaseSeed(Number(e.target.value))} />
        </label>
        <label className="inline-ctl">
          reference
          <select value={refId} onChange={(e) => setRefId(e.target.value)}>
            {chosen.map((id) => (
              <option key={id} value={id}>
                {all.find((x) => x.id === id)?.name ?? id}
              </option>
            ))}
          </select>
        </label>
        {!progress ? (
          <button id="exp-start" className="btn primary" onClick={run} disabled={!chosen.length}>
            Run comparison ({chosen.length} × {runs})
          </button>
        ) : (
          <button className="btn" onClick={() => ((stopped.current = true), cancelRef.current?.())}>
            Stop
          </button>
        )}
        {progress && <span className="small">{progress}</span>}
      </div>
      {res && ref && (
        <>
          <div className="card">
            <h3>Side-by-side results</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Mean T (s) [95% CI]</th>
                  <th>p95 of T (s)</th>
                  <th>P(T ≤ 180 s)</th>
                  <th>Mean p95 indiv. exit (s)</th>
                  <th>Peak density (p/m²)</th>
                  <th>Exposure &gt;3.5 p/m² (person-s)</th>
                  <th>Exit imbalance</th>
                  <th>Unresolved runs</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {res.map((r) => {
                  const d = diffs[r.strat.id];
                  const dT = d.find((x) => x.metric === 'tEvac')!;
                  const dD = d.find((x) => x.metric === 'peakDensity')!;
                  const dE = d.find((x) => x.metric === 'highDensityExposure')!;
                  const flags: string[] = [];
                  if (r !== ref && dT.ciHigh < 0 && (dD.meanDiff > 0.3 || dE.meanDiff > 0.15 * Math.max(1, ref.stats.exposure.mean))) flags.push('faster but denser');
                  if (r !== ref && dT.ciLow > 0) flags.push('slower (significant)');
                  if (r !== ref && dT.ciHigh < 0) flags.push('faster (significant)');
                  if (r.stats.fracUnresolved > 0) flags.push('unresolved agents');
                  return (
                    <tr key={r.strat.id} className={r === ref ? 'sel' : ''}>
                      <td>{r.strat.name}</td>
                      <td>
                        {fmt(r.stats.tEvac.mean)} [{fmt(r.stats.tEvac.ciLow)}, {fmt(r.stats.tEvac.ciHigh)}]
                      </td>
                      <td>{fmt(r.stats.tEvac.p95)}</td>
                      <td>
                        {pct(r.stats.pMeet.p)} [{pct(r.stats.pMeet.lo)}, {pct(r.stats.pMeet.hi)}]
                      </td>
                      <td>{fmt(r.stats.p95Exit.mean)}</td>
                      <td>{fmt(r.stats.peakDensity.mean, 2)}</td>
                      <td>{fmt(r.stats.exposure.mean, 0)}</td>
                      <td>{fmt(r.stats.imbalance.mean, 2)}</td>
                      <td>{pct(r.stats.fracUnresolved)}</td>
                      <td className="flags">{flags.join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Paired differences vs reference ({ref.strat.name}); negative = better</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Δ mean T (s) [95% CI]</th>
                  <th>Δ p95 indiv. exit (s) [CI]</th>
                  <th>Δ peak density [CI]</th>
                  <th>Δ exposure [CI]</th>
                  <th>Δ imbalance [CI]</th>
                  <th>Seeds where faster</th>
                </tr>
              </thead>
              <tbody>
                {res
                  .filter((r) => r !== ref)
                  .map((r) => {
                    const d = Object.fromEntries(diffs[r.strat.id].map((x) => [x.metric, x]));
                    const c = (x: PairedDiff, dd = 1) => `${fmt(x.meanDiff, dd)} [${fmt(x.ciLow, dd)}, ${fmt(x.ciHigh, dd)}]`;
                    return (
                      <tr key={r.strat.id}>
                        <td>{r.strat.name}</td>
                        <td>{c(d.tEvac)}</td>
                        <td>{c(d.p95Exit)}</td>
                        <td>{c(d.peakDensity, 2)}</td>
                        <td>{c(d.highDensityExposure, 0)}</td>
                        <td>{c(d.exitImbalance, 2)}</td>
                        <td>{pct(d.tEvac.fracBBetter)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="grid2">
            <div className="card">
              <h3>Total evacuation time distribution</h3>
              <BoxPlot items={res.map((r, i) => ({ label: r.strat.id === 'CURRENT' ? 'Current' : r.strat.name.split(' ')[0], values: r.runs.map((x) => x.tEvac), color: seriesColor(i) }))} xLabel="seconds" refX={180} />
              <div className="muted small">{res.map((r) => `${r.strat.name.split(' ')[0]} = ${r.strat.name}`).join(' · ')}</div>
            </div>
            <div className="card">
              <h3>Probability of evacuating within 180 s (Wilson 95% CI)</h3>
              <HBarChart items={res.map((r, i) => ({ label: r.strat.name.split(' ')[0], value: r.stats.pMeet.p * 100, err: [r.stats.pMeet.lo * 100, r.stats.pMeet.hi * 100], color: seriesColor(i) }))} unit="%" maxValue={100} />
            </div>
            <div className="card">
              <h3>Mean persons inside vs time</h3>
              <LineChart series={res.map((r, i) => ({ name: r.strat.name.split(' ')[0], color: seriesColor(i), values: meanCurve(r.runs).mean }))} xLabel="time (s)" yLabel="persons inside" refX={180} />
            </div>
            <div className="card">
              <h3>Mean exit-group usage</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    {EXIT_GROUPS.map((g) => (
                      <th key={g}>{GROUP_SHORT[g]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {res.map((r) => (
                    <tr key={r.strat.id}>
                      <td>{r.strat.name.split(' ')[0]}</td>
                      {EXIT_GROUPS.map((g) => (
                        <td key={g}>{fmt(r.stats.meanUsage[g], 0)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => download('comparison-runs.csv', toCsv(res.flatMap((r) => r.runs.map(({ inside, exitGroupUsage, maxQueue, meanWait, ...x }) => ({ strategy: r.strat.name, ...x, ...Object.fromEntries(Object.entries(exitGroupUsage).map(([k, v]) => [`use_${k}`, v])) })))), 'text/csv')}>
              Export all runs (CSV)
            </button>
            <button className="btn" onClick={() => download('comparison.json', JSON.stringify({ baseSeed, runs, reference: ref.strat.id, strategies: res.map((r) => ({ id: r.strat.id, name: r.strat.name, config: r.strat.cfg, stats: r.stats, pairedVsReference: diffs[r.strat.id] })) }, null, 1), 'application/json')}>
              Export comparison (JSON)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
