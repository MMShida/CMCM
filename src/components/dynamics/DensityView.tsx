/**
 * "Density over time" tab.
 *   A  live heat map while the run advances, then
 *   F  replay of any recorded second (slider / play)
 *   B  density timeline of a selected region (+ occupancy, flows, queue)
 *   C  regional comparison (several regions on one density axis)
 *   D  congestion duration: time above a selected reference density per region
 *   E  distribution of individual cumulative density exposure
 *   G  Monte Carlo: peak density per region and exposure across seeds (workers, Model A or B)
 *   H  exports (CSV time series, region definitions JSON, summary JSON, Monte Carlo CSV)
 * Region averages are persons / area of the region; areas come from the reconstructed geometry
 * (assumption-labelled widths). Reference densities are analytical references, not safety limits.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeometryData } from '../../geometry/types';
import { buildRegions } from '../../simulation/DensityRegions';
import type { DensityResult } from '../../simulation/DensityRegions';
import type { RunSummary } from '../../simulation/MonteCarlo';
import { batchSeeds, quantileSorted, summarize } from '../../simulation/MonteCarlo';
import type { SimConfig } from '../../simulation/Params';
import type { BatchHandle } from '../../simulation/WorkerPool';
import { runBatchInWorkers, workerCount } from '../../simulation/WorkerPool';
import { BoxPlot, HBarChart, Histogram, LineChart } from '../Charts';
import { Tile } from '../LiveView';
import { download, fmt, pct, seriesColor, toCsv } from '../util';
import { DensityMap } from './DensityMap';
import type { LivePost, ModelId, RecordedRun } from './runStore';
import { IncrementalRun, runStore } from './runStore';

export function useRecordedRun(): RecordedRun | null {
  const [r, setR] = useState<RecordedRun | null>(runStore.get());
  useEffect(() => {
    const un = runStore.subscribe(setR);
    return () => void un();
  }, []);
  return r;
}

/** run controls shared by the density and Crowd Manager tabs */
export function RunControls({ geo, cfg, onLive }: { geo: GeometryData; cfg: SimConfig; onLive: (frame: number[] | null, items: ReturnType<IncrementalRun['heatItems']>, t: number, posts: LivePost[]) => void }) {
  const [model, setModel] = useState<ModelId>('A');
  const [seed, setSeed] = useState(cfg.seed);
  const [running, setRunning] = useState(false);
  const [t, setT] = useState(0);
  const runRef = useRef<IncrementalRun | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const start = () => {
    cancelAnimationFrame(raf.current);
    const run = new IncrementalRun(geo, cfg, seed, model);
    runRef.current = run;
    runStore.set(null);
    setRunning(true);
    const tick = () => {
      const t0 = performance.now();
      while (!run.finished && performance.now() - t0 < 30) run.advance(1);
      setT(run.t);
      onLive(run.liveFrame(), run.heatItems(), run.t, run.posts());
      if (run.finished) {
        setRunning(false);
        runStore.set({ model, seed, label: cfg.label, cfg: run.cfg, result: run.result() });
      } else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(raf.current);
    setRunning(false);
  };
  return (
    <div className="row">
      <span className="seg">
        {(['A', 'B'] as ModelId[]).map((m) => (
          <button key={m} className={`btn small ${model === m ? 'on' : ''}`} onClick={() => setModel(m)} disabled={running}>
            Model {m}
          </button>
        ))}
      </span>
      <label className="inline-ctl">
        seed <input className="num" type="number" value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value))))} disabled={running} />
      </label>
      {!running ? (
        <button id="dyn-run" className="btn primary" onClick={start}>
          Run and record
        </button>
      ) : (
        <button className="btn" onClick={stop}>
          Stop
        </button>
      )}
      {running && <span className="muted small">simulating… t = {t.toFixed(0)} s</span>}
      <span className="muted small">
        Configuration: <b>{cfg.label}</b>
        {cfg.adaptive?.agents ? ' · dynamic individuals' : ''}
        {cfg.adaptive?.managers ? ' · adaptive managers' : ''}
        {!cfg.adaptive?.agents && !cfg.adaptive?.managers ? ' · previous fixed model' : ''} · placement {cfg.crowdManagers.placement ?? 'existing'}
      </span>
    </div>
  );
}

export function DensityView({ geo, cfg, dark, bundled }: { geo: GeometryData; cfg: SimConfig; dark: boolean; bundled: boolean }) {
  const rec = useRecordedRun();
  const D: DensityResult | undefined = rec?.result.density;
  const S = D?.series;
  const [live, setLive] = useState<{ frame: number[] | null; items: ReturnType<IncrementalRun['heatItems']>; t: number; posts: LivePost[] } | null>(null);
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [region, setRegion] = useState(0);
  const [compare, setCompare] = useState<number[]>([0, 9, 11]);
  const [thrIdx, setThrIdx] = useState(1);
  const regionsInfo = useMemo(() => buildRegions(geo, cfg).regions, [geo, cfg]);

  useEffect(() => {
    if (S) setK(S.t.length - 1);
  }, [rec]);
  useEffect(() => {
    if (!playing || !S) return;
    const id = setInterval(() => setK((x) => (x + 1 >= S.t.length ? (setPlaying(false), x) : x + 1)), 120);
    return () => clearInterval(id);
  }, [playing, S]);

  const items = D?.heat?.items ?? live?.items ?? [];
  const values = S && D?.heat ? D.heat.frames[Math.min(k, D.heat.frames.length - 1)] : live?.frame ?? null;
  const tNow = S ? S.t[Math.min(k, S.t.length - 1)] : live?.t ?? 0;
  const R = D?.regions ?? regionsInfo.map((x) => ({ id: x.id, label: x.label, area: x.area, capacity: x.capacity, floor: x.floor, approx: x.approx }));

  const exportSeries = () => {
    if (!S || !D) return;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < S.t.length; i++)
      D.regions.forEach((r, j) =>
        rows.push({ t: S.t[i], region: r.id, occupancy: S.occ[j][i], density: S.dens[j][i], inflow: S.inflow[j][i], outflow: S.outflow[j][i], speed: S.speed[j][i], queue: S.queue[j][i], utilisation: S.util[j][i] }),
      );
    download(`density-series-${rec!.model}-seed${rec!.seed}.csv`, toCsv(rows), 'text/csv');
  };
  const exportRegions = () =>
    download(
      'density-regions.json',
      JSON.stringify(
        {
          note: 'Area = sum of link length x clear width of the reconstructed geometry (widths estimated from the plans, +/- 0.3 m: ASSUMPTION). capacity = nominal outflow capacity over boundary crossings (p/s). Seat rows, the elevator and outdoor street links are not measured.',
          regions: regionsInfo,
        },
        null,
        1,
      ),
      'application/json',
    );
  const exportSummary = () => {
    if (!D) return;
    const { series, heat, exposureValues, ...summary } = D;
    void series;
    void heat;
    download(`density-summary-${rec!.model}-seed${rec!.seed}.json`, JSON.stringify({ model: rec!.model, seed: rec!.seed, label: rec!.label, tEvac: rec!.result.tEvac, ...summary, exposureValues }, null, 1), 'application/json');
  };

  const thr = D?.thresholds ?? [1, 2, 3, 4];
  const exposure = D?.exposureValues ?? [];
  const exposed = exposure.filter((v) => v > 0);

  return (
    <div className="page">
      <h2>Density over time</h2>
      <p className="muted">
        Records the density ρ<sub>A</sub>(t) = N<sub>A</sub>(t) / Area(A) of {R.length} regions every second, plus a per-link density frame for the heat map. Areas come from the reconstructed
        geometry (link length × clear width; the widths are estimates from the scanned plans). Region values are averages: local peaks are higher. Reference densities are analytical references, <b>not</b> safety limits.
      </p>
      <div className="card">
        <RunControls geo={geo} cfg={cfg} onLive={(frame, its, t, posts) => setLive({ frame, items: its, t, posts })} />
        {rec && (
          <div className="tiles">
            <Tile label="Evacuation time (last person out)" value={`${fmt(rec.result.tEvac)} s`} warn={!(rec.result.tEvac <= 180)} />
            <Tile label="Highest region-average density" value={D ? `${fmt(Math.max(...D.peak), 2)} p/m²` : '-'} />
            <Tile label={`Person-seconds in regions above ${D?.ref ?? 2} p/m²`} value={D ? fmt(D.personTimeAbove, 0) : '-'} />
            <Tile label={`Mean individual exposure ∫max(0, ρ − ${D?.ref ?? 2}) dt`} value={D ? `${fmt(D.exposure.mean, 1)} p·s/m²` : '-'} />
            <Tile label={`Share of people ever above ${D?.ref ?? 2} p/m² (local)`} value={D ? pct(D.exposure.shareExposed) : '-'} />
            <Tile label="Most regions above the reference at once" value={D ? `${D.maxRegionsAbove} (${fmt(D.maxCongestedArea, 0)} m²)` : '-'} />
          </div>
        )}
      </div>

      <div className="card">
        <h3>A / F. Heat map {S ? '(replay)' : live ? '(live)' : ''} · t = {fmt(tNow, 0)} s</h3>
        <DensityMap geo={geo} items={items} values={values} dark={dark} highlight={region} posts={!S ? live?.posts : undefined} onPick={(r) => setRegion(r)} />
        {S && (
          <div className="row">
            <button className="btn small" onClick={() => setPlaying(!playing)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button className="btn small" onClick={() => setK(Math.max(0, k - 1))}>
              −1 s
            </button>
            <input type="range" min={0} max={S.t.length - 1} value={k} onChange={(e) => setK(Number(e.target.value))} style={{ flex: 1, minWidth: 200 }} aria-label="replay time" />
            <button className="btn small" onClick={() => setK(Math.min(S.t.length - 1, k + 1))}>
              +1 s
            </button>
            <span className="small muted">click a link on the map to select its region</span>
          </div>
        )}
        {!rec && <p className="muted">Press “Run and record”. The map updates while the simulation runs; afterwards every recorded second can be replayed.</p>}
      </div>

      {S && D && (
        <>
          <div className="card">
            <h3>Regions at t = {fmt(tNow, 0)} s</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Area (m²)</th>
                  <th>Occupancy</th>
                  <th>Density (p/m²)</th>
                  <th>Mean speed (m/s)</th>
                  <th>Queuing</th>
                  <th>In / out (p/s)</th>
                  <th>Capacity use</th>
                  <th>Peak density (time)</th>
                </tr>
              </thead>
              <tbody>
                {D.regions.map((r, j) => (
                  <tr key={r.id} className={j === region ? 'sel' : ''} onClick={() => setRegion(j)} style={{ cursor: 'pointer' }}>
                    <td>
                      {r.label}
                      {r.approx ? ' *' : ''}
                    </td>
                    <td>{fmt(r.area, 1)}</td>
                    <td>{S.occ[j][k]}</td>
                    <td>{fmt(S.dens[j][k], 2)}</td>
                    <td>{fmt(S.speed[j][k], 2)}</td>
                    <td>{S.queue[j][k]}</td>
                    <td>
                      {S.inflow[j][k]} / {S.outflow[j][k]}
                    </td>
                    <td>{Number.isFinite(S.util[j][k]) ? pct(S.util[j][k]) : '-'}</td>
                    <td>
                      {fmt(D.peak[j], 2)} ({fmt(D.peakT[j], 0)} s)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">* region contains links whose geometry is marked approximate. Capacity use = outflow / nominal outflow capacity of the region boundary.</p>
          </div>

          <div className="grid2">
            <div className="card">
              <h3>B. Density timeline</h3>
              <select value={region} onChange={(e) => setRegion(Number(e.target.value))}>
                {D.regions.map((r, j) => (
                  <option key={r.id} value={j}>
                    {r.label}
                  </option>
                ))}
              </select>
              <LineChart series={[{ name: D.regions[region].label, color: seriesColor(0), values: S.dens[region] }]} xLabel="time (s)" yLabel="persons / m²" digits={2} markX={k} refX={180} />
              <LineChart
                series={[
                  { name: 'occupancy', color: seriesColor(0), values: S.occ[region] },
                  { name: 'queuing', color: seriesColor(1), values: S.queue[region] },
                  { name: 'outflow (p/s)', color: seriesColor(2), values: S.outflow[region] },
                ]}
                xLabel="time (s)"
                yLabel="persons"
                height={180}
                markX={k}
              />
            </div>
            <div className="card">
              <h3>C. Regional comparison</h3>
              <div className="chips" style={{ maxHeight: 110 }}>
                {D.regions.map((r, j) => (
                  <label key={r.id} className="toggle small">
                    <input
                      type="checkbox"
                      checked={compare.includes(j)}
                      disabled={!compare.includes(j) && compare.length >= 6}
                      onChange={(e) => setCompare(e.target.checked ? [...compare, j] : compare.filter((x) => x !== j))}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
              <LineChart series={compare.map((j, i) => ({ name: D.regions[j].label, color: seriesColor(i), values: S.dens[j] }))} xLabel="time (s)" yLabel="persons / m²" digits={2} markX={k} />
              <LineChart series={[{ name: `area above ${D.ref} p/m² (m²)`, color: seriesColor(0), values: S.congestedArea }]} xLabel="time (s)" yLabel="m² above reference" height={150} markX={k} />
            </div>
          </div>

          <div className="grid2">
            <div className="card">
              <h3>D. Congestion duration</h3>
              <div className="row">
                <span className="small">reference density:</span>
                <span className="seg">
                  {thr.map((v, i) => (
                    <button key={v} className={`btn small ${thrIdx === i ? 'on' : ''}`} onClick={() => setThrIdx(i)}>
                      {v} p/m²
                    </button>
                  ))}
                </span>
              </div>
              <HBarChart
                items={D.regions
                  .map((r, j) => ({ label: r.label, value: D.timeAbove[thrIdx]?.[j] ?? 0, color: seriesColor(0) }))
                  .filter((x) => x.value > 0)
                  .sort((a, b) => b.value - a.value)}
                unit=" s"
                labelWidth={290}
              />
              {D.regions.every((_, j) => !(D.timeAbove[thrIdx]?.[j] > 0)) && <p className="muted small">No region average exceeded {thr[thrIdx]} p/m².</p>}
            </div>
            <div className="card">
              <h3>E. Individual density exposure</h3>
              <p className="small muted">
                E<sub>i</sub> = ∫ max(0, ρ(x<sub>i</sub>, t) − {D.ref}) dt. {D.exposure.local}. {pct(D.exposure.shareExposed)} of people had E &gt; 0; mean {fmt(D.exposure.mean, 1)}, p95 {fmt(D.exposure.p95, 1)}, max {fmt(D.exposure.max, 1)} p·s/m²; mean time
                above {D.ref} p/m²: {fmt(D.exposure.meanTimeAbove, 1)} s.
              </p>
              {exposed.length > 0 && <Histogram values={exposed} xLabel="exposure of exposed people (p·s/m²)" bins={30} unit="people" valueUnit="p·s/m²" />}
            </div>
          </div>
        </>
      )}

      <DensityMonteCarlo geo={geo} cfg={cfg} bundled={bundled} />

      <div className="card">
        <h3>H. Exports</h3>
        <div className="row">
          <button className="btn" onClick={exportSeries} disabled={!S}>
            Time series (CSV)
          </button>
          <button className="btn" onClick={exportRegions}>
            Region definitions (JSON)
          </button>
          <button className="btn" onClick={exportSummary} disabled={!D}>
            Summary metrics (JSON)
          </button>
        </div>
      </div>
    </div>
  );
}

function DensityMonteCarlo({ geo, cfg, bundled }: { geo: GeometryData; cfg: SimConfig; bundled: boolean }) {
  const [runs, setRuns] = useState(20);
  const [model, setModel] = useState<ModelId>('A');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [res, setRes] = useState<RunSummary[] | null>(null);
  const handle = useRef<BatchHandle | null>(null);
  const start = () => {
    setRes(null);
    setProgress({ done: 0, total: runs });
    handle.current = runBatchInWorkers(cfg, batchSeeds(777, runs), (d, n) => setProgress({ done: d, total: n }), bundled ? undefined : geo, model);
    handle.current.promise.then(
      (r) => {
        setRes(r);
        setProgress(null);
      },
      () => setProgress(null),
    );
  };
  const D0 = res?.[0]?.density;
  const regionStats = useMemo(() => {
    if (!res || !D0) return [];
    return D0.regions.map((r, j) => {
      const peaks = res.map((x) => x.density!.peak[j]);
      const s = summarize(peaks);
      const k2 = D0.thresholds.indexOf(D0.ref);
      const above = res.map((x) => (k2 >= 0 ? x.density!.timeAbove[k2][j] : NaN));
      return { j, r, peaks, s, above: summarize(above) };
    });
  }, [res]);
  const exportMc = () => {
    if (!res || !D0) return;
    const rows: Record<string, unknown>[] = [];
    for (const x of res)
      D0.regions.forEach((r, j) =>
        rows.push({ seed: x.seed, region: r.id, peakDensity: x.density!.peak[j], peakTime: x.density!.peakT[j], peakOccupancy: x.density!.peakOcc[j], ...Object.fromEntries(x.density!.thresholds.map((t, k) => [`timeAbove${t}`, x.density!.timeAbove[k][j]])), tEvac: x.tEvac, exposureMean: x.density!.exposure.mean, exposureP95: x.density!.exposure.p95 }),
      );
    download(`density-montecarlo-${model}.csv`, toCsv(rows), 'text/csv');
  };
  const top = [...regionStats].sort((a, b) => b.s.mean - a.s.mean).slice(0, 8);
  return (
    <div className="card">
      <h3>G. Monte Carlo: regional peak density and exposure across seeds</h3>
      <div className="row">
        <span className="seg">
          {(['A', 'B'] as ModelId[]).map((m) => (
            <button key={m} className={`btn small ${model === m ? 'on' : ''}`} onClick={() => setModel(m)}>
              Model {m}
            </button>
          ))}
        </span>
        <span className="seg">
          {[10, 20, 40, 100].map((n) => (
            <button key={n} className={`btn small ${runs === n ? 'on' : ''}`} onClick={() => setRuns(n)}>
              {n} runs
            </button>
          ))}
        </span>
        <button className="btn primary" onClick={start} disabled={!!progress}>
          Run in {workerCount()} workers
        </button>
        {progress && (
          <span className="small muted">
            {progress.done} / {progress.total}
          </span>
        )}
        <button className="btn" onClick={exportMc} disabled={!res}>
          Export (CSV)
        </button>
      </div>
      {res && D0 && (
        <>
          <div className="grid2">
            <div>
              <BoxPlot items={top.map((x, i) => ({ label: x.r.label, values: x.peaks, color: seriesColor(i % 8) }))} xLabel="peak region-average density (p/m²)" />
            </div>
            <div>
              <Histogram values={res.map((x) => x.density!.exposure.mean)} xLabel="mean individual exposure per run (p·s/m²)" bins={16} valueUnit="p·s/m²" />
            </div>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Region</th>
                <th>Peak density: mean [95 % CI]</th>
                <th>p5 – p95</th>
                <th>Time above {D0.ref} p/m²: mean [95 % CI]</th>
              </tr>
            </thead>
            <tbody>
              {regionStats.map(({ r, s, peaks, above }) => {
                const sorted = [...peaks].sort((a, b) => a - b);
                return (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td>
                      {fmt(s.mean, 2)} [{fmt(s.ciLow, 2)}, {fmt(s.ciHigh, 2)}]
                    </td>
                    <td>
                      {fmt(quantileSorted(sorted, 0.05), 2)} – {fmt(quantileSorted(sorted, 0.95), 2)}
                    </td>
                    <td>
                      {fmt(above.mean, 0)} s [{fmt(above.ciLow, 0)}, {fmt(above.ciHigh, 0)}]
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            {res.length} runs, seeds 777…; person-seconds above {D0.ref} p/m²: mean {fmt(summarize(res.map((x) => x.density!.personTimeAbove)).mean, 0)}; evacuation time mean {fmt(summarize(res.map((x) => x.tEvac)).mean, 1)} s.
          </p>
        </>
      )}
    </div>
  );
}
