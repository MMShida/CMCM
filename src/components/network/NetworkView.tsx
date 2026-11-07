/**
 * "Network model" tab: Model B (stochastic behavioural simulation on the building graph) live,
 * with the network drawn on the plan, plus the Model C flow benchmark panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeometryData } from '../../geometry/types';
import { EXIT_GROUPS } from '../../geometry/types';
import { STATE_COLOR, STATE_LABEL } from '../../simulation/Agent';
import type { RunResult } from '../../simulation/Metrics';
import type { SimConfig } from '../../simulation/Params';
import { graphFor } from '../../simulation/SimulationEngine';
import { HBarChart, Histogram, LineChart } from '../Charts';
import { Tile } from '../LiveView';
import type { CanvasOptions, FloorMode } from '../SimulationCanvas';
import { SimulationCanvas } from '../SimulationCanvas';
import { GROUP_COLOR_INDEX, GROUP_SHORT, download, fmt, seriesColor, toCsv } from '../util';
import { FlowAnalysis } from './FlowAnalysis';
import { NetworkLiveController } from './NetworkLiveController';
import { drawNetwork } from './NetworkOverlay';

const SPEEDS = [1, 2, 5, 10, 50];
const LEGEND_STATES = [0, 1, 2, 3, 4, 5, 6, 10, 12, 13];

export function NetworkView({ geo, cfg, dark }: { geo: GeometryData; cfg: SimConfig; dark: boolean }) {
  const ref = useRef<NetworkLiveController | null>(null);
  if (!ref.current) ref.current = new NetworkLiveController(geo, cfg);
  const ctl = ref.current;
  const graph = useMemo(() => graphFor(geo, cfg.movement.laneWidth), [geo, cfg.movement.laneWidth]);
  const [, setTick] = useState(0);
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [floorMode, setFloorMode] = useState<FloorMode>('split');
  const [showNet, setShowNet] = useState(true);
  const [showQueues, setShowQueues] = useState(true);
  const [opts, setOpts] = useState<CanvasOptions>({ showLinks: false, showLabels: true, showSeats: true, showAgents: true, overlayOpacity: 0, overlayKind: 'plan' });
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('autostart')) {
      const until = q.get('until') ? Number(q.get('until')) : Infinity;
      if (Number.isFinite(until)) {
        ctl.advanceTo(until);
        if (ctl.sim.finished) setResult(ctl.sim.result());
      } else ctl.running = true;
      setTick((t) => t + 1);
    }
  }, []);

  useEffect(() => {
    if (ctl.cfg === cfg && ctl.geo === geo) return;
    if (ctl.sim.t === 0 || ctl.geo !== geo) {
      ctl.reset(cfg, geo);
      setResult(null);
      setSelected(-1);
      setStale(false);
    } else setStale(true);
  }, [cfg, geo]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const was = ctl.running;
      ctl.tick(dt);
      if (was && ctl.sim.finished && !result) setResult(ctl.sim.result());
      if (now - lastUi > 200) {
        lastUi = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  const reset = () => {
    ctl.reset(cfg, geo);
    setResult(null);
    setSelected(-1);
    setStale(false);
    setTick((t) => t + 1);
  };
  const st = ctl.currentStats();
  const nSnap = ctl.snapshots.length;
  const net = ctl.sim.net;
  const ns = net.stats();
  return (
    <div className="live">
      <div className="toolbar">
        {!ctl.running ? (
          <button className="btn primary" onClick={() => ((ctl.replay = null), (ctl.running = true), setTick((t) => t + 1))} disabled={ctl.sim.finished}>
            {ctl.sim.t > 0 ? '▶ Resume' : '▶ Start'}
          </button>
        ) : (
          <button className="btn" onClick={() => ((ctl.running = false), setTick((t) => t + 1))}>
            ❚❚ Pause
          </button>
        )}
        <button className="btn" onClick={() => ctl.stepOnce()} disabled={ctl.running || ctl.sim.finished} title="advance one time step (0.25 s)">
          Step
        </button>
        <button className="btn" onClick={reset}>
          ↺ Reset
        </button>
        <span className="seg">
          {SPEEDS.map((s) => (
            <button key={s} className={`btn small ${ctl.speed === s ? 'on' : ''}`} onClick={() => ((ctl.speed = s), setTick((t) => t + 1))}>
              {s}×
            </button>
          ))}
        </span>
        <span className="seg">
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
        <label className="inline-ctl">
          PDF overlay
          <input type="range" min={0} max={1} step={0.05} value={opts.overlayOpacity} onChange={(e) => setOpts({ ...opts, overlayOpacity: Number(e.target.value) })} />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showNet} onChange={(e) => setShowNet(e.target.checked)} /> graph
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showQueues} onChange={(e) => setShowQueues(e.target.checked)} /> queues
        </label>
        <span className="muted small">
          Model B: {ns.junctions} junctions, {ns.sources} seating sources, {ns.sinks} exterior doors, {ns.edges} edges ({ns.featureEdges} physical features)
        </span>
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
            drawOverlay={showNet ? (ctx, toScreen, floor, scale) => drawNetwork(ctx, toScreen, floor, scale, net, { dark, showNodes: true }) : undefined}
          />
          <div className="legend map-legend">
            {LEGEND_STATES.map((s) => (
              <span key={s}>
                <span className="dot" style={{ background: STATE_COLOR[s] }} />
                {STATE_LABEL[s]}
              </span>
            ))}
            <span className="muted">Circles move along graph edges; queued people are drawn behind the door they wait for (no collision model).</span>
          </div>
        </div>
        <div className="side">
          <div className="panel stats">
            <div className="stat-hero">
              <div>
                <div className="hero-num">{fmt(st.t, 1)} s</div>
                <div className="muted small">simulated time (Model B)</div>
              </div>
              <div>
                <div className="hero-num">{((st.left / Math.max(1, ctl.sim.agents.length)) * 100).toFixed(1)}%</div>
                <div className="muted small">left the building</div>
              </div>
            </div>
            <table className="kv">
              <tbody>
                <tr>
                  <td>Total occupancy</td>
                  <td>{ctl.sim.agents.length}</td>
                </tr>
                <tr>
                  <td>Left the building</td>
                  <td>{st.left}</td>
                </tr>
                <tr>
                  <td>Still inside</td>
                  <td>{st.inside}</td>
                </tr>
                <tr>
                  <td>Not yet moving</td>
                  <td>{st.notStarted}</td>
                </tr>
                <tr>
                  <td>Walking</td>
                  <td>{st.moving}</td>
                </tr>
                <tr>
                  <td>Queuing</td>
                  <td>{st.queuing}</td>
                </tr>
                <tr>
                  <td>Trapped / no route</td>
                  <td>{st.trapped}</td>
                </tr>
                <tr>
                  <td>Longest queue</td>
                  <td>{st.worstQueue}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {selected >= 0 && (
            <div className="panel inspector">
              <div className="row">
                <b>Agent inspector (Model B)</b>
                <button className="btn small" onClick={() => setSelected(-1)}>
                  ✕
                </button>
              </div>
              <table className="kv">
                <tbody>
                  {ctl.describe(selected).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
      </div>
      {result && <NetRunResults r={result} ctl={ctl} />}
      <FlowAnalysis geo={geo} cfg={cfg} dark={dark} />
    </div>
  );
}

function NetRunResults({ r, ctl }: { r: RunResult; ctl: NetworkLiveController }) {
  const gates = r.gates.filter((g) => g.passes > 0).sort((a, b) => b.maxQueue - a.maxQueue);
  return (
    <div className="results">
      <h2>Model B run results (seed {r.seed})</h2>
      <div className="tiles">
        <Tile label="Evacuation time (last person out)" value={Number.isFinite(r.tEvac) ? `${fmt(r.tEvac)} s` : 'not completed'} warn={!(r.tEvac <= 180)} />
        <Tile label="Last ambulatory person out" value={`${fmt(r.tEvacAmbulatory)} s`} />
        <Tile label="Mean / median / p95 exit time" value={`${fmt(r.meanExit, 0)} / ${fmt(r.medianExit, 0)} / ${fmt(r.p95Exit, 0)} s`} />
        <Tile label="Median / p95 start time" value={`${fmt(r.medianStart, 0)} / ${fmt(r.p95Start, 0)} s`} />
        <Tile label="Mean queue time per person" value={`${fmt(ctl.sim.meanQueueTime(), 1)} s`} />
        <Tile label="Agents who rerouted" value={`${r.reroutedAgents}`} />
        <Tile label="Unresolved" value={`${r.unresolved.inside} inside, ${r.unresolved.awaitingAssistance} awaiting assistance, ${r.unresolved.trapped} trapped`} warn={r.unresolved.inside + r.unresolved.trapped > r.unresolved.awaitingAssistance} />
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Evacuation curve</h3>
          <LineChart
            series={[
              { name: 'inside building', color: seriesColor(0), values: r.series.inside },
              { name: 'not yet moving', color: seriesColor(3), values: r.series.notStarted },
              { name: 'queuing', color: seriesColor(7), values: r.series.queuing },
            ]}
            xLabel="time (s)"
            yLabel="persons"
            refX={180}
          />
        </div>
        <div className="card">
          <h3>Exit utilisation</h3>
          <HBarChart items={EXIT_GROUPS.map((g) => ({ label: GROUP_SHORT[g], value: r.exitGroupUsage[g], color: seriesColor(GROUP_COLOR_INDEX[g]) }))} unit="" />
        </div>
        <div className="card">
          <h3>When people left the building</h3>
          <Histogram values={ctl.sim.na.map((n) => n.tLeft)} xLabel="exit time (s)" refX={180} />
        </div>
        <div className="card">
          <h3>Bottlenecks (network feature edges)</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Capacity (p/s)</th>
                <th>Passes</th>
                <th>Max queue</th>
                <th>Mean wait (s)</th>
              </tr>
            </thead>
            <tbody>
              {gates.slice(0, 14).map((g) => (
                <tr key={g.id}>
                  <td>{g.label}</td>
                  <td>{fmt(g.capacity, 2)}</td>
                  <td>{g.passes}</td>
                  <td>{g.maxQueue}</td>
                  <td>{fmt(g.meanWait, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => download(`netrun-${r.seed}.json`, JSON.stringify({ model: 'B', config: ctl.cfg, result: r }, null, 1), 'application/json')}>
          Export run + parameters (JSON)
        </button>
        <button
          className="btn"
          onClick={() =>
            download(
              `netrun-${r.seed}-agents.csv`,
              toCsv(ctl.sim.na.map((n) => ({ id: n.a.id, seat: ctl.geo.seats[n.a.seat].id, zone: ctl.geo.seats[n.a.seat].zone, type: n.a.type, v0: +n.a.v0.toFixed(3), tStart: +n.a.tStartMove.toFixed(2), tLeft: +n.tLeft.toFixed(2), exitGroup: n.exitGroup >= 0 ? EXIT_GROUPS[n.exitGroup] : '', exitDoor: n.exitEdge >= 0 ? ctl.sim.net.edges[n.exitEdge].label : '', queueTime: +n.waitTotal.toFixed(2), reroutes: n.reroutes }))),
              'text/csv',
            )
          }
        >
          Export agents (CSV)
        </button>
      </div>
    </div>
  );
}
