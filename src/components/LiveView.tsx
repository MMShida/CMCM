import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import { STATE_COLOR, STATE_LABEL } from '../simulation/Agent';
import type { RunResult } from '../simulation/Metrics';
import { agentRecord } from '../simulation/Metrics';
import type { SimConfig } from '../simulation/Params';
import { graphFor } from '../simulation/SimulationEngine';
import { AgentInspector } from './AgentInspector';
import { HBarChart, Histogram, LineChart } from './Charts';
import { LiveController } from './LiveController';
import type { CanvasOptions, FloorMode } from './SimulationCanvas';
import { SimulationCanvas } from './SimulationCanvas';
import { StatisticsPanel } from './StatisticsPanel';
import { GROUP_COLOR_INDEX, GROUP_SHORT, download, fmt, seriesColor, toCsv } from './util';

const SPEEDS = [1, 2, 5, 10, 50];
const LEGEND_STATES = [0, 1, 2, 3, 4, 5, 6, 9, 7, 8, 10, 12, 13];

export function LiveView({ geo, cfg, dark, model = 'A' }: { geo: GeometryData; cfg: SimConfig; dark: boolean; model?: 'A' | 'Lite' }) {
  const ctlRef = useRef<LiveController | null>(null);
  if (!ctlRef.current) ctlRef.current = new LiveController(geo, cfg, model);
  const ctl = ctlRef.current;
  const graph = useMemo(() => graphFor(geo, cfg.movement.laneWidth), [geo, cfg.movement.laneWidth]);
  const [, setTick] = useState(0);
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [floorMode, setFloorMode] = useState<FloorMode>('split');
  const [opts, setOpts] = useState<CanvasOptions>({ showLinks: false, showLabels: true, showSeats: true, showAgents: true, overlayOpacity: 0, overlayKind: 'plan' });
  const [heat, setHeat] = useState<'off' | 'current' | 'peak'>('off');
  const [showQueues, setShowQueues] = useState(true);
  const [result, setResult] = useState<RunResult | null>(null);

  // optional URL control (?autostart=1&speed=50&until=90&floor=split&heat=current&overlay=0.5)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('floor')) setFloorMode(q.get('floor') as FloorMode);
    if (q.get('heat')) setHeat(q.get('heat') as 'off' | 'current' | 'peak');
    if (q.get('overlay')) setOpts((o) => ({ ...o, overlayOpacity: Number(q.get('overlay')), overlayKind: (q.get('overlayKind') as 'plan' | 'chart') ?? 'plan' }));
    if (q.get('speed')) ctl.speed = Number(q.get('speed'));
    const until = q.get('until') ? Number(q.get('until')) : Infinity;
    if (q.get('autostart')) {
      ctl.running = true;
      if (Number.isFinite(until)) {
        // run headlessly up to `until` for screenshots, then pause
        while (!ctl.sim.finished && ctl.sim.t < until) ctl.stepOnce();
        ctl.running = false;
        if (ctl.sim.finished) setResult(ctl.sim.result({ heat: true }));
      }
    }
    if (q.get('select')) setSelected(Number(q.get('select')));
  }, []);

  // configuration changes: reset automatically if the run has not started yet
  useEffect(() => {
    if (ctl.cfg === cfg && ctl.geo === geo) return;
    if (ctl.sim.t === 0 || ctl.geo !== geo) {
      ctl.reset(cfg, geo);
      setResult(null);
      setSelected(-1);
      setStale(false);
    } else setStale(true);
  }, [cfg, geo]);

  // engine loop (decoupled from rendering)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const wasRunning = ctl.running;
      ctl.tick(dt);
      if (wasRunning && ctl.sim.finished && !result) setResult(ctl.sim.result({ heat: true }));
      if (now - lastUi > 200) {
        lastUi = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  ctl.heatMode = heat;
  const reset = () => {
    ctl.reset(cfg, geo);
    setResult(null);
    setSelected(-1);
    setStale(false);
    setTick((t) => t + 1);
  };
  const started = ctl.sim.t > 0;
  const nSnap = ctl.snapshots.length;

  return (
    <div className="live">
      <p className="muted small">Model {model === 'Lite' ? 'A-Lite' : 'A'} · seed {ctl.sim.seed} · {ctl.sim.guidance.cms.length} managers. This is one audience, not the study mean. The building-clearance time is reported separately from continued travel to street level.</p>
      <div className="toolbar">
        {!ctl.running ? (
          <button className="btn primary" onClick={() => ((ctl.replay = null), (ctl.running = true), setTick((t) => t + 1))} disabled={ctl.sim.finished}>
            {started ? '▶ Resume' : '▶ Start'}
          </button>
        ) : (
          <button className="btn" onClick={() => ((ctl.running = false), setTick((t) => t + 1))}>
            ❚❚ Pause
          </button>
        )}
        <button className="btn" onClick={() => ctl.stepOnce()} disabled={ctl.running || ctl.sim.finished} title="advance one time step (0.1 s)">
          Step
        </button>
        <button className="btn" onClick={reset}>
          ↺ Reset
        </button>
        <span className="seg" role="group" aria-label="simulation speed">
          {SPEEDS.map((s) => (
            <button key={s} className={`btn small ${ctl.speed === s ? 'on' : ''}`} onClick={() => ((ctl.speed = s), setTick((t) => t + 1))}>
              {s}×
            </button>
          ))}
        </span>
        <span className="seg" role="group" aria-label="floor">
          {(
            [
              ['floor1', 'First floor'],
              ['balcony', 'Balcony'],
              ['split', 'Both'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} className={`btn small ${floorMode === m ? 'on' : ''}`} onClick={() => setFloorMode(m)}>
              {l}
            </button>
          ))}
        </span>
        <label className="inline-ctl" title="original PDF map overlay">
          PDF overlay
          <input type="range" min={0} max={1} step={0.05} value={opts.overlayOpacity} onChange={(e) => setOpts({ ...opts, overlayOpacity: Number(e.target.value) })} />
          <select value={opts.overlayKind} onChange={(e) => setOpts({ ...opts, overlayKind: e.target.value as 'plan' | 'chart' })}>
            <option value="plan">floor plan</option>
            <option value="chart">seating chart</option>
          </select>
        </label>
        <select value={heat} onChange={(e) => setHeat(e.target.value as typeof heat)} title="crowd density overlay">
          <option value="off">Density: off</option>
          <option value="current">Density: current</option>
          <option value="peak">Density: peak so far</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={showQueues} onChange={(e) => setShowQueues(e.target.checked)} /> queues
        </label>
        <label className="toggle">
          <input type="checkbox" checked={opts.showLinks} onChange={(e) => setOpts({ ...opts, showLinks: e.target.checked })} /> network
        </label>
        <label className="toggle">
          <input type="checkbox" checked={opts.showLabels} onChange={(e) => setOpts({ ...opts, showLabels: e.target.checked })} /> labels
        </label>
        <span className="muted small">scroll = zoom · drag = pan · double-click = fit · click a circle to inspect</span>
      </div>
      {stale && (
        <div className="stale">
          Configuration changed - the running simulation still uses the old settings.{' '}
          <button className="btn small primary" onClick={reset}>
            Reset to apply
          </button>
        </div>
      )}
      <div className="live-main">
        <div className="map-wrap">
          <SimulationCanvas
            geo={geo}
            graph={graph}
            floorMode={floorMode}
            options={opts}
            dark={dark}
            getFrame={() => ctl.currentFrame()}
            getDyn={() => ctl.dyn(selected, showQueues)}
            onClickWorld={(x, y, floor) => setSelected(ctl.findAgentAt(x, y, floor))}
          />
          <div className="legend map-legend">
            {LEGEND_STATES.map((s) => (
              <span key={s}>
                <span className="dot" style={{ background: STATE_COLOR[s] }} />
                {STATE_LABEL[s]}
              </span>
            ))}
            <span>
              <span className="star">★</span>Crowd Manager
            </span>
            <span>
              <span className="xmark">✕</span>blocked
            </span>
            <span>
              <span className="bar-mark" />
              barrier
            </span>
            <span>
              <span className="led-mark" />
              LED strip
            </span>
          </div>
        </div>
        <div className="side">
          <StatisticsPanel ctl={ctl} />
          {selected >= 0 && <AgentInspector sim={ctl.sim} id={selected} onClose={() => setSelected(-1)} />}
        </div>
      </div>
      <div className="timeline">
        <span className="muted small">Replay</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, nSnap - 1)}
          value={ctl.replay ?? nSnap - 1}
          onChange={(e) => {
            const v = Number(e.target.value);
            ctl.running = false;
            ctl.replay = v >= nSnap - 1 ? null : v;
            setTick((t) => t + 1);
          }}
        />
        <span className="small">{ctl.replay !== null ? `${ctl.snapshots[ctl.replay].t.toFixed(0)} s` : 'live'}</span>
        {ctl.replay !== null && (
          <button className="btn small" onClick={() => ((ctl.replay = null), setTick((t) => t + 1))}>
            Back to live
          </button>
        )}
      </div>
      {result && <RunResults result={result} ctl={ctl} />}
    </div>
  );
}

function RunResults({ result: r, ctl }: { result: RunResult; ctl: LiveController }) {
  const t = r.series;
  const gates = [...r.gates].filter((g) => g.passes > 0).sort((a, b) => b.maxQueue - a.maxQueue);
  const starts = ctl.sim.agents.map((a) => a.tStartMove);
  const exits = ctl.sim.agents.map((a) => a.tLeftBuilding);
  return (
    <div className="results">
      <h2>Run results (seed {r.seed})</h2>
      <div className="tiles">
        <Tile label="Evacuation time (last person out)" value={Number.isFinite(r.tEvac) ? `${fmt(r.tEvac)} s` : 'not completed'} warn={!(r.tEvac <= 180)} />
        <Tile label="Last ambulatory person out" value={`${fmt(r.tEvacAmbulatory)} s`} />
        <Tile label="Last ambulatory person at street level" value={`${fmt(r.tSafe)} s`} />
        <Tile label="All people at street level, including scheduled assistance" value={`${fmt(r.tSafeAll ?? NaN)} s`} />
        <Tile label="Mean / median / p95 exit time" value={`${fmt(r.meanExit, 0)} / ${fmt(r.medianExit, 0)} / ${fmt(r.p95Exit, 0)} s`} />
        <Tile label="Median / p95 start time" value={`${fmt(r.medianStart, 0)} / ${fmt(r.p95Start, 0)} s`} />
        <Tile label="Peak local density" value={`${fmt(r.peakDensity, 2)} p/m² (${r.peakDensityWhere})`} />
        <Tile label="Exposure above 3.5 p/m²" value={`${r.highDensityExposure} person-s`} />
        <Tile label="Agents who rerouted" value={`${r.reroutedAgents}`} />
        <Tile label="Unresolved" value={`${r.unresolved.inside} inside, ${r.unresolved.awaitingAssistance} awaiting assistance, ${r.unresolved.trapped} trapped`} warn={r.unresolved.inside + r.unresolved.trapped > 0} />
      </div>
      <p className="muted small">Simulated outcome under stated assumptions; it does not prove regulatory compliance or real-world safety.</p>
      <div className="grid2">
        <div className="card">
          <h3>Evacuation curve</h3>
          <LineChart
            series={[
              { name: 'inside building', color: seriesColor(0), values: t.inside },
              { name: 'not yet moving', color: seriesColor(3), values: t.notStarted },
              { name: 'queuing', color: seriesColor(7), values: t.queuing },
            ]}
            xLabel="time (s)"
            yLabel="persons"
            refX={180}
          />
        </div>
        <div className="card">
          <h3>Exit utilisation</h3>
          <HBarChart items={EXIT_GROUPS.map((g) => ({ label: GROUP_SHORT[g], value: r.exitGroupUsage[g], color: seriesColor(GROUP_COLOR_INDEX[g]) }))} unit="" />
          <div className="muted small">By door: {Object.entries(r.exitDoorUsage).sort().map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
        </div>
        <div className="card">
          <h3>When people started moving</h3>
          <Histogram values={starts} xLabel="start time (s)" color={seriesColor(3)} />
        </div>
        <div className="card">
          <h3>When people left the building</h3>
          <Histogram values={exits} xLabel="exit time (s)" refX={180} />
        </div>
      </div>
      <div className="card">
        <h3>Bottlenecks (doors and stairs)</h3>
        <table className="data">
          <thead>
            <tr>
              <th>Gate</th>
              <th>Capacity (p/s)</th>
              <th>Passes</th>
              <th>Max queue</th>
              <th>Mean wait (s)</th>
              <th>Max passes in 1 s</th>
            </tr>
          </thead>
          <tbody>
            {gates.map((g) => (
              <tr key={g.id}>
                <td>{g.label}</td>
                <td>{fmt(g.capacity, 2)}</td>
                <td>{g.passes}</td>
                <td>{g.maxQueue}</td>
                <td>{fmt(g.meanWait, 1)}</td>
                <td>{g.maxPassesPerSecond}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn" onClick={() => download(`run-${r.seed}-agents.csv`, toCsv(ctl.sim.agents.map((a) => agentRecord(ctl.sim, a) as unknown as Record<string, unknown>)), 'text/csv')}>
          Export agents (CSV)
        </button>
        <button className="btn" onClick={() => download(`run-${r.seed}.json`, JSON.stringify({ config: ctl.cfg, result: { ...r, heat: undefined } }, null, 1), 'application/json')}>
          Export run + parameters (JSON)
        </button>
        <button className="btn" onClick={() => download(`run-${r.seed}-timeseries.csv`, toCsv(t.inside.map((_, i) => ({ t: i, inside: t.inside[i], leftBuilding: t.leftBuilding[i], safe: t.safe[i], moving: t.moving[i], queuing: t.queuing[i], notStarted: t.notStarted[i] }))), 'text/csv')}>
          Export time series (CSV)
        </button>
      </div>
    </div>
  );
}

export function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`tile ${warn ? 'warn' : ''}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
