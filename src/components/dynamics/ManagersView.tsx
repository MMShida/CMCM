/**
 * "Crowd Managers" tab: per-manager formal responsibility R_m(t), communication reach H_m(t),
 * actual influence I_m(t) and workload over a recorded run, the instruction history, the posts on
 * the map at any recorded second, and a paired comparison of the previous fixed model with the
 * adaptive policies (Monte Carlo in workers).
 *
 * Definitions (docs/ADAPTIVE.md):
 *   R_m(t)  persons still inside whose seat zone is in m's responsibility (placement + reassignment)
 *   H_m(t)  persons inside who can currently hear m (same floor, <= voice radius; adaptive mode:
 *           same room or through a door within reachFactor x radius on foot)
 *   I_m(t)  persons inside whose LAST adopted instruction came from m and whose current exit
 *           choice equals it (attribution rule: most recent adopted manager)
 *   W_m(t)  workload index H/H_ref + 0.5 x critical gates watched + 0.5 x max(0, rho_loc - rho_ref)/rho_ref
 */
import { useMemo, useRef, useState } from 'react';
import type { GeometryData } from '../../geometry/types';
import { EXIT_GROUPS } from '../../geometry/types';
import type { RunSummary } from '../../simulation/MonteCarlo';
import { batchSeeds, summarize, wilson } from '../../simulation/MonteCarlo';
import type { SimConfig } from '../../simulation/Params';
import { cloneConfig } from '../../simulation/Params';
import { runBatchInWorkers, workerCount } from '../../simulation/WorkerPool';
import { LineChart } from '../Charts';
import { download, fmt, pct, seriesColor, toCsv } from '../util';
import { DensityMap } from './DensityMap';
import { RunControls, useRecordedRun } from './DensityView';
import type { LivePost, ModelId } from './runStore';

export function ManagersView({ geo, cfg, dark, bundled }: { geo: GeometryData; cfg: SimConfig; dark: boolean; bundled: boolean }) {
  const rec = useRecordedRun();
  const M = rec?.result.managers ?? [];
  const D = rec?.result.density;
  const [sel, setSel] = useState(0);
  const [k, setK] = useState(-1);
  const [live, setLive] = useState<{ posts: LivePost[]; t: number } | null>(null);
  const m = M[Math.min(sel, Math.max(0, M.length - 1))];
  const n = m?.series?.t.length ?? 0;
  const kk = k < 0 || k >= n ? n - 1 : k;
  const postsWithXY: LivePost[] | undefined = useMemo(
    () =>
      M.length
        ? M.map((x) => {
            const S = x.series!;
            const i = Math.min(kk, S.t.length - 1);
            return { id: x.id, x: x.x, y: x.y, floor: x.floor, active: S.t[i] >= x.tActive, H: S.H[i], W: S.W[i] };
          })
        : live?.posts,
    [M, kk, live],
  );
  const heatK = D?.heat ? Math.min(kk, D.heat.frames.length - 1) : -1;

  const exportCsv = () => {
    if (!M.length) return;
    const rows: Record<string, unknown>[] = [];
    for (const x of M) {
      const S = x.series!;
      for (let i = 0; i < S.t.length; i++) rows.push({ manager: x.id, t: S.t[i], R: S.R[i], H: S.H[i], I: S.I[i], reached: S.reached[i], W: S.W[i], criticalGates: S.crit[i], localDensity: S.dens[i] });
    }
    download(`crowd-managers-${rec!.model}-seed${rec!.seed}.csv`, toCsv(rows), 'text/csv');
  };
  const exportHistory = () => {
    if (!M.length) return;
    download(
      `crowd-manager-instructions-${rec!.model}-seed${rec!.seed}.csv`,
      toCsv(M.flatMap((x) => x.history.map((h) => ({ manager: x.id, t: h.t, planned: EXIT_GROUPS[h.planned] ?? '-', from: EXIT_GROUPS[h.from] ?? '-', to: EXIT_GROUPS[h.to] ?? '-', reason: h.reason })))),
      'text/csv',
    );
  };

  return (
    <div className="page">
      <h2>Crowd Managers: responsibility, reach, influence and workload</h2>
      <p className="muted">
        R = people still inside in the manager’s formal zones · H = people who can hear the manager now · I = people whose current exit follows this manager’s last adopted instruction · W = workload
        index (assumed indicator: people in reach / {cfg.adaptive?.workloadRef ?? 80} + 0.5 × critical bottlenecks watched + density term; W &gt; 1 = overloaded). With adaptive managers off, the previous rules are used (the voice reaches
        through walls; one instruction per person) and only the bookkeeping is added.
      </p>
      <div className="card">
        <RunControls geo={geo} cfg={cfg} onLive={(_f, _i, t, p) => setLive({ posts: p, t })} />
      </div>
      {M.length > 0 && m && (
        <>
          <div className="card">
            <h3>Managers ({rec!.model === 'A' ? 'Model A' : 'Model B'}, seed {rec!.seed})</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>Manager</th>
                  <th>Post</th>
                  <th>Formal zones</th>
                  <th>Active from</th>
                  <th>max R</th>
                  <th>max H</th>
                  <th>max I</th>
                  <th>Reached (unique)</th>
                  <th>Instructed</th>
                  <th>Complied</th>
                  <th>Changed route</th>
                  <th>Instruction changes</th>
                  <th>Conflicts</th>
                  <th>Overloaded (s)</th>
                  <th>max W</th>
                  <th>Heard through a wall (previous rule)</th>
                </tr>
              </thead>
              <tbody>
                {M.map((x, i) => (
                  <tr key={x.id} className={i === sel ? 'sel' : ''} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
                    <td>
                      <b>{x.id}</b>
                    </td>
                    <td>
                      {x.label} (floor {x.floor})
                    </td>
                    <td className="small">{x.zones.join(', ') || '—'}</td>
                    <td>{fmt(x.tActive, 0)} s</td>
                    <td>{x.maxR}</td>
                    <td>{x.maxH}</td>
                    <td>{x.maxI}</td>
                    <td>{x.uniqueReached}</td>
                    <td>{x.instructed}</td>
                    <td>{x.complied}</td>
                    <td>{x.changed}</td>
                    <td>{x.switches}</td>
                    <td>{x.conflicts}</td>
                    <td>{x.overloadTime}</td>
                    <td>{fmt(x.maxW, 2)}</td>
                    <td>{x.throughWall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <button className="btn small" onClick={exportCsv}>
                Manager time series (CSV)
              </button>
              <button className="btn small" onClick={exportHistory}>
                Instruction history (CSV)
              </button>
            </div>
          </div>

          <div className="grid2">
            <div className="card">
              <h3>{m.id}: R, H and I over time</h3>
              <LineChart
                series={[
                  { name: 'R formal responsibility', color: seriesColor(0), values: m.series!.R },
                  { name: 'H in reach', color: seriesColor(1), values: m.series!.H },
                  { name: 'I influenced', color: seriesColor(2), values: m.series!.I },
                ]}
                xLabel="time (s)"
                yLabel="persons"
                markX={kk}
              />
              <LineChart series={[{ name: 'workload index W', color: seriesColor(3), values: m.series!.W }]} xLabel="time (s)" yLabel="W (1 = overloaded)" digits={2} height={150} markX={kk} refX={undefined} />
            </div>
            <div className="card">
              <h3>Posts at t = {fmt(m.series!.t[kk] ?? 0, 0)} s</h3>
              <DensityMap geo={geo} items={D?.heat?.items ?? []} values={heatK >= 0 ? D!.heat!.frames[heatK] : null} dark={dark} posts={postsWithXY} ring={rec!.cfg.crowdManagers.radius} height={300} />
              <input type="range" min={0} max={Math.max(0, n - 1)} value={kk} onChange={(e) => setK(Number(e.target.value))} style={{ width: '100%' }} aria-label="time" />
              <LineChart series={M.map((x, i) => ({ name: x.id, color: seriesColor(i % 8), values: x.series!.H }))} xLabel="time (s)" yLabel="persons in reach (H)" height={170} markX={kk} />
            </div>
          </div>

          <div className="card">
            <h3>Instruction history</h3>
            {M.every((x) => !x.history.length) ? (
              <p className="muted small">No instruction changed during this run {rec!.cfg.adaptive?.managers || rec!.cfg.crowdManagers.rebalance?.enabled ? '' : '(fixed plan: managers never change their instruction in the previous model)'}.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>t (s)</th>
                    <th>Manager</th>
                    <th>People planned for</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {M.flatMap((x) => x.history.map((h) => ({ ...h, id: x.id })))
                    .sort((a, b) => a.t - b.t)
                    .map((h, i) => (
                      <tr key={i}>
                        <td>{fmt(h.t, 0)}</td>
                        <td>{h.id}</td>
                        <td>{EXIT_GROUPS[h.planned] ?? '—'}</td>
                        <td>{EXIT_GROUPS[h.from] ?? '—'}</td>
                        <td>{EXIT_GROUPS[h.to] ?? '—'}</td>
                        <td>{h.reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {!M.length && <p className="muted">Run and record a simulation to inspect each manager (the map shows the posts live while it runs).</p>}
      {!M.length && live && (
        <div className="card">
          <DensityMap geo={geo} items={[]} values={null} dark={dark} posts={live.posts} ring={cfg.crowdManagers.radius} height={300} />
        </div>
      )}
      <PolicyComparison geo={geo} cfg={cfg} bundled={bundled} />
    </div>
  );
}

const POLICIES: { key: string; label: string; agents: boolean; managers: boolean }[] = [
  { key: 'fixed', label: 'Previous fixed model', agents: false, managers: false },
  { key: 'agents', label: 'Dynamic individuals only', agents: true, managers: false },
  { key: 'managers', label: 'Adaptive managers only', agents: false, managers: true },
  { key: 'both', label: 'Both adaptive', agents: true, managers: true },
];

function PolicyComparison({ geo, cfg, bundled }: { geo: GeometryData; cfg: SimConfig; bundled: boolean }) {
  const [runs, setRuns] = useState(20);
  const [model, setModel] = useState<ModelId>('A');
  const [prog, setProg] = useState<string | null>(null);
  const [res, setRes] = useState<Record<string, RunSummary[]> | null>(null);
  const cancel = useRef(false);
  const start = async () => {
    cancel.current = false;
    const out: Record<string, RunSummary[]> = {};
    const seeds = batchSeeds(777, runs);
    for (const p of POLICIES) {
      if (cancel.current) break;
      const c = cloneConfig(cfg);
      c.adaptive = { ...c.adaptive, agents: p.agents, managers: p.managers };
      setProg(`${p.label}: 0 / ${runs}`);
      const h = runBatchInWorkers(c, seeds, (d, nn) => setProg(`${p.label}: ${d} / ${nn}`), bundled ? undefined : geo, model);
      out[p.key] = await h.promise;
      setRes({ ...out });
    }
    setProg(null);
  };
  const base = res?.fixed;
  const paired = (xs: RunSummary[]) => {
    if (!base) return null;
    const by = new Map(base.map((r) => [r.seed, r.tEvac]));
    const d = xs.filter((r) => by.has(r.seed)).map((r) => r.tEvac - by.get(r.seed)!).filter(Number.isFinite);
    return { s: summarize(d), worse: d.filter((x) => x > 0).length / Math.max(1, d.length) };
  };
  return (
    <div className="card">
      <h3>Compare the fixed and adaptive policies (paired seeds)</h3>
      <p className="small muted">Runs the current configuration four times on the same audiences (seeds 777…), switching only the adaptive settings. Positive differences = slower than the previous fixed model.</p>
      <div className="row">
        <span className="seg">
          {(['A', 'B'] as ModelId[]).map((x) => (
            <button key={x} className={`btn small ${model === x ? 'on' : ''}`} onClick={() => setModel(x)}>
              Model {x}
            </button>
          ))}
        </span>
        <span className="seg">
          {[10, 20, 40].map((x) => (
            <button key={x} className={`btn small ${runs === x ? 'on' : ''}`} onClick={() => setRuns(x)}>
              {x} runs
            </button>
          ))}
        </span>
        <button className="btn primary" onClick={start} disabled={!!prog}>
          Compare ({workerCount()} workers)
        </button>
        {prog && <span className="small muted">{prog}</span>}
      </div>
      {res && (
        <table className="data">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Mean T (s) [95 % CI]</th>
              <th>P(T ≤ 180)</th>
              <th>Paired difference vs fixed (s) [CI]</th>
              <th>Slower than fixed</th>
              <th>Central aisles peak (p/m²)</th>
              <th>Mean exposure</th>
              <th>Exit switches</th>
              <th>Followed CM</th>
            </tr>
          </thead>
          <tbody>
            {POLICIES.filter((p) => res[p.key]).map((p) => {
              const xs = res[p.key];
              const s = summarize(xs.map((r) => r.tEvac));
              const w = wilson(xs.filter((r) => r.tEvac <= 180).length, xs.length);
              const pr = p.key === 'fixed' ? null : paired(xs);
              const ca = xs[0].density!.regions.findIndex((r) => r.id === 'orchCentralAisles');
              const mean = (f: (r: RunSummary) => number) => summarize(xs.map(f)).mean;
              return (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td>
                    {fmt(s.mean)} [{fmt(s.ciLow)}, {fmt(s.ciHigh)}]
                  </td>
                  <td>{pct(w.p)}</td>
                  <td>{pr ? `${pr.s.mean >= 0 ? '+' : ''}${fmt(pr.s.mean)} [${fmt(pr.s.ciLow)}, ${fmt(pr.s.ciHigh)}]` : 'reference'}</td>
                  <td>{pr ? pct(pr.worse) : '—'}</td>
                  <td>{fmt(mean((r) => r.density!.peak[ca]), 2)}</td>
                  <td>{fmt(mean((r) => r.density!.exposure.mean), 1)}</td>
                  <td>{fmt(mean((r) => r.behaviour!.exitSwitches), 0)}</td>
                  <td>{pct(mean((r) => r.behaviour!.followedShare))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
