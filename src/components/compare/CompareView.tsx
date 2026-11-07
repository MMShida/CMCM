/**
 * "Compare models" tab: Model A (detailed agent-based, left) and Model B (network behavioural,
 * right) animated side by side on ONE shared simulated clock, with the same audience (same seed
 * -> identical people) and the same scenario. Below: cumulative evacuation of A, B and the
 * Model C benchmarks, a summary table, and the optimal-flow / minimum-cut panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { runCompareJobs } from '../../compare/ComparePool';
import type { physicalAnalysis } from '../../compare/Comparison';
import { BAILEY_HALL, blockableLinks } from '../../geometry/BaileyHall';
import type { GeometryData } from '../../geometry/types';
import { EXIT_GROUPS } from '../../geometry/types';
import { STATE_COLOR, STATE_LABEL } from '../../simulation/Agent';
import type { RunResult } from '../../simulation/Metrics';
import type { SimConfig } from '../../simulation/Params';
import { SCENARIOS } from '../../simulation/Scenarios';
import { graphFor } from '../../simulation/SimulationEngine';
import { LineChart } from '../Charts';
import { LiveController } from '../LiveController';
import type { CanvasOptions, FloorMode } from '../SimulationCanvas';
import { SimulationCanvas } from '../SimulationCanvas';
import { GROUP_SHORT, download, fmt, seriesColor, toCsv } from '../util';
import { FlowAnalysis } from '../network/FlowAnalysis';
import { NetworkLiveController } from '../network/NetworkLiveController';
import { drawNetwork } from '../network/NetworkOverlay';

const SPEEDS = [1, 2, 5, 10, 25];
type Phys = ReturnType<typeof physicalAnalysis>;

interface Props {
  geo: GeometryData;
  cfg: SimConfig;
  dark: boolean;
  scenarioId: string;
  onScenario: (id: string) => void;
  update: (fn: (c: SimConfig) => void) => void;
}

export function CompareView({ geo, cfg, dark, scenarioId, onScenario, update }: Props) {
  const aRef = useRef<LiveController | null>(null);
  const bRef = useRef<NetworkLiveController | null>(null);
  if (!aRef.current) aRef.current = new LiveController(geo, cfg);
  if (!bRef.current) bRef.current = new NetworkLiveController(geo, cfg);
  const A = aRef.current;
  const B = bRef.current;
  const clock = useRef({ t: 0, running: false, speed: 5 });
  const graph = useMemo(() => graphFor(geo, cfg.movement.laneWidth), [geo, cfg.movement.laneWidth]);
  const [, setTick] = useState(0);
  const [floorMode, setFloorMode] = useState<FloorMode>('floor1');
  const [showNet, setShowNet] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [replay, setReplay] = useState<number | null>(null);
  const [phys, setPhys] = useState<Phys | null>(null);
  const [realA, setRealA] = useState<number[] | null>(null);
  const [realB, setRealB] = useState<number[] | null>(null);
  const [resA, setResA] = useState<RunResult | null>(null);
  const [resB, setResB] = useState<RunResult | null>(null);
  const opts: CanvasOptions = { showLinks: false, showLabels: true, showSeats: true, showAgents: true, overlayOpacity: 0, overlayKind: 'plan' };
  const geoParam = geo === BAILEY_HALL ? undefined : geo;

  const resetBoth = (c = cfg) => {
    A.reset(c, geo);
    B.reset(c, geo);
    clock.current.t = 0;
    clock.current.running = false;
    setReplay(null);
    setRealA(null);
    setRealB(null);
    setResA(null);
    setResB(null);
    setTick((t) => t + 1);
  };
  // optional URL control for screenshots: ?cmpuntil=60 advances both models to t = 60 s
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const until = q.get('cmpuntil') ? Number(q.get('cmpuntil')) : NaN;
    if (Number.isFinite(until)) {
      clock.current.t = until;
      A.advanceTo(until);
      B.advanceTo(until);
      if (A.sim.finished) setResA(A.sim.result());
      if (B.sim.finished) setResB(B.sim.result());
      if (q.get('cmpnet')) setShowNet(true);
      setTick((t) => t + 1);
    }
  }, []);
  // any change of the shared configuration resets both models (same audience, same scenario)
  useEffect(() => {
    if (A.cfg !== cfg || A.geo !== geo) resetBoth(cfg);
  }, [cfg, geo]);
  // Model C benchmarks for the current configuration and seed
  useEffect(() => {
    setPhys(null);
    const h = runCompareJobs<Phys>([{ kind: 'physical', cfg, seed: cfg.seed, geo: geoParam }]);
    h.promise.then((r) => setPhys(r[0])).catch(() => setPhys(null));
    return () => h.cancel();
  }, [cfg, geo]);
  // benchmark with each model's realised departure times once that model has finished
  useEffect(() => {
    if (!resA) return;
    const h = runCompareJobs<{ curve: number[] }>([{ kind: 'bench', cfg, seed: cfg.seed, starts: A.sim.agents.map((a) => a.tStartMove), geo: geoParam }]);
    h.promise.then((r) => setRealA(r[0].curve));
  }, [resA]);
  useEffect(() => {
    if (!resB) return;
    const h = runCompareJobs<{ curve: number[] }>([{ kind: 'bench', cfg, seed: cfg.seed, starts: B.sim.agents.map((a) => a.tStartMove), geo: geoParam }]);
    h.promise.then((r) => setRealB(r[0].curve));
  }, [resB]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const c = clock.current;
      if (c.running && replay === null) {
        c.t += dt * c.speed;
        A.advanceTo(c.t);
        B.advanceTo(c.t);
        if (A.sim.finished && !resA) setResA(A.sim.result());
        if (B.sim.finished && !resB) setResB(B.sim.result());
        if (A.sim.finished && B.sim.finished) c.running = false;
      }
      if (now - lastUi > 200) {
        lastUi = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay, resA, resB]);

  const c = clock.current;
  const nSnap = Math.max(A.snapshots.length, B.snapshots.length);
  const setReplayIdx = (v: number | null) => {
    setReplay(v);
    A.replay = v === null ? null : Math.min(v, A.snapshots.length - 1);
    B.replay = v === null ? null : Math.min(v, B.snapshots.length - 1);
    if (v !== null) c.running = false;
  };
  const sa = A.currentStats();
  const sb = B.currentStats();
  const curveA = A.snapshots.map((s) => s.stats.left);
  const curveB = B.snapshots.map((s) => s.stats.left);
  const N = A.sim.agents.length;
  const blockable = useMemo(() => blockableLinks(geo), [geo]);
  const guidance = cfg.crowdManagers.count === 0 ? 'none' : cfg.led.enabled ? (cfg.barriers.length ? 'cm-led-bar' : 'cm-led') : cfg.barriers.length ? 'cm-bar' : 'cm';
  const setGuidance = (g: string) =>
    update((x) => {
      x.crowdManagers.count = g === 'none' ? 0 : x.crowdManagers.count === 0 ? 6 : x.crowdManagers.count;
      x.led.enabled = g === 'cm-led' || g === 'cm-led-bar';
      x.barriers = g === 'cm-bar' || g === 'cm-led-bar' ? geo.links.filter((l) => l.barrierSlot && /W1|E1/.test(l.label ?? '')).map((l) => l.id) : [];
    });

  const pane = (which: 'A' | 'B') => {
    const ctl = which === 'A' ? A : B;
    const st = which === 'A' ? sa : sb;
    return (
      <div className="cmp-pane">
        <div className="cmp-head">
          <b>{which === 'A' ? 'Model A - detailed agent-based (spatial lanes, collisions, density)' : 'Model B - network behavioural (graph edges, capacity queues)'}</b>
          <span className="small">
            t = {fmt(ctl.sim.t, 1)} s · outside {st.left}/{N} ({((st.left / Math.max(1, N)) * 100).toFixed(0)}%) · queuing {st.queuing}
            {ctl.sim.finished ? ` · finished at ${fmt(ctl.sim.t, 1)} s` : ''}
          </span>
        </div>
        <div className="map-wrap cmp-map">
          <SimulationCanvas
            geo={geo}
            graph={graph}
            floorMode={floorMode}
            options={opts}
            dark={dark}
            getFrame={() => ctl.currentFrame()}
            getDyn={() => ctl.dyn(-1, true)}
            drawOverlay={which === 'B' && showNet ? (ctx, toScreen, floor, scale) => drawNetwork(ctx, toScreen, floor, scale, B.sim.net, { dark, showNodes: true }) : undefined}
          />
        </div>
      </div>
    );
  };

  const series = [
    { name: 'A detailed agent-based', color: seriesColor(0), values: curveA },
    { name: 'B network behavioural', color: seriesColor(1), values: curveB },
    ...(phys ? [{ name: 'C ideal flow, ready at t = 0', color: seriesColor(2), values: phys.curveImm, dashed: true }] : []),
    ...(phys ? [{ name: 'C ideal flow, sampled pre-movement', color: seriesColor(3), values: phys.curvePre, dashed: true }] : []),
    ...(realB ? [{ name: "C ideal flow, B's departure times", color: seriesColor(4), values: realB, dashed: true }] : []),
    ...(realA ? [{ name: "C ideal flow, A's departure times", color: seriesColor(6), values: realA, dashed: true }] : []),
  ];
  return (
    <div className="live compare">
      <div className="toolbar">
        {!c.running ? (
          <button className="btn primary" onClick={() => (setReplayIdx(null), (c.running = true), setTick((t) => t + 1))} disabled={A.sim.finished && B.sim.finished} id="cmp-start">
            {c.t > 0 ? '▶ Resume both' : '▶ Start both'}
          </button>
        ) : (
          <button className="btn" onClick={() => ((c.running = false), setTick((t) => t + 1))}>
            ❚❚ Pause both
          </button>
        )}
        <button className="btn" onClick={() => resetBoth()}>
          ↺ Reset both
        </button>
        <span className="seg">
          {SPEEDS.map((s) => (
            <button key={s} className={`btn small ${c.speed === s ? 'on' : ''}`} onClick={() => ((c.speed = s), setTick((t) => t + 1))}>
              {s}×
            </button>
          ))}
        </span>
        <span className="seg">
          {(
            [
              ['floor1', 'First floor'],
              ['balcony', 'Balcony'],
              ['split', 'Both floors'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} className={`btn small ${floorMode === m ? 'on' : ''}`} onClick={() => setFloorMode(m)}>
              {l}
            </button>
          ))}
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showNet} onChange={(e) => setShowNet(e.target.checked)} /> B graph
        </label>
        <span className="hero-clock">shared clock {fmt(c.t, 1)} s</span>
      </div>
      <div className="toolbar cmp-shared">
        <label className="inline-ctl">
          Scenario
          <select value={scenarioId} onChange={(e) => onScenario(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-ctl">
          Seed
          <input type="number" value={cfg.seed} onChange={(e) => update((x) => (x.seed = Math.max(1, Math.round(Number(e.target.value) || 1))))} style={{ width: 70 }} />
        </label>
        <label className="inline-ctl">
          Occupancy
          <select
            value={String(cfg.occupancy.orchestra)}
            onChange={(e) =>
              update((x) => {
                const v = Number(e.target.value);
                x.occupancy.orchestra = v;
                x.occupancy.mezzanine = v;
                x.occupancy.balcony = v;
              })
            }
          >
            {[0.1, 0.25, 0.5, 0.75, 1].map((v) => (
              <option key={v} value={String(v)}>
                {v * 100}%
              </option>
            ))}
          </select>
        </label>
        <label className="inline-ctl">
          Blocked exit
          <select value={cfg.blocked.links[0] ?? ''} onChange={(e) => update((x) => (x.blocked.links = e.target.value ? [e.target.value] : []))}>
            <option value="">none</option>
            {blockable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-ctl">
          Guidance
          <select value={guidance} onChange={(e) => setGuidance(e.target.value)}>
            <option value="none">none (no Crowd Managers)</option>
            <option value="cm">Crowd Managers</option>
            <option value="cm-led">CM + LED strips</option>
            <option value="cm-bar">CM + barriers W1/E1</option>
            <option value="cm-led-bar">CM + LED + barriers</option>
          </select>
        </label>
        <span className="muted small">Both models use this configuration and seed: identical people (seats, types, speeds, reaction times, compliance).</span>
      </div>
      <div className="cmp-grid">
        {pane('A')}
        {pane('B')}
      </div>
      <div className="legend map-legend">
        {[0, 1, 2, 3, 4, 5, 6, 10, 12, 13].map((s) => (
          <span key={s}>
            <span className="dot" style={{ background: STATE_COLOR[s] }} />
            {STATE_LABEL[s]}
          </span>
        ))}
      </div>
      <div className="timeline">
        <span className="muted small">Replay (both)</span>
        <input type="range" min={0} max={Math.max(0, nSnap - 1)} value={replay ?? nSnap - 1} onChange={(e) => setReplayIdx(Number(e.target.value) >= nSnap - 1 ? null : Number(e.target.value))} />
        <span className="small">{replay !== null ? `${replay} s` : 'live'}</span>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Cumulative number evacuated</h3>
          <LineChart series={series} xLabel="time (s)" yLabel="persons outside" refX={180} yMax={N} />
          <p className="muted small">
            Dashed: Model C, the mathematically optimal (earliest-arrival) evacuation on B's graph with perfectly coordinated routing at {phys ? fmt(B.sim.net.rates.vRep, 2) : '-'} m/s - an
            idealised benchmark, not a prediction. The A-B gap mixes model structure and behaviour representation; B vs "C with B's departure times" isolates decentralised routing and queuing on
            the same graph.
          </p>
        </div>
        <div className="card">
          <h3>This run</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Metric</th>
                <th>A</th>
                <th>B</th>
                <th>C</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Evacuation time (s)</td>
                <td>{resA ? fmt(resA.tEvac) : '...'}</td>
                <td>{resB ? fmt(resB.tEvac) : '...'}</td>
                <td>{phys ? `${fmt(phys.tStarImm, 0)} (t=0) / ${fmt(phys.tStarPre, 0)} (pre)` : '...'}</td>
              </tr>
              <tr>
                <td>Mean / p95 individual exit (s)</td>
                <td>{resA ? `${fmt(resA.meanExit, 0)} / ${fmt(resA.p95Exit, 0)}` : '...'}</td>
                <td>{resB ? `${fmt(resB.meanExit, 0)} / ${fmt(resB.p95Exit, 0)}` : '...'}</td>
                <td>-</td>
              </tr>
              <tr>
                <td>Median start (s)</td>
                <td>{resA ? fmt(resA.medianStart, 0) : '...'}</td>
                <td>{resB ? fmt(resB.medianStart, 0) : '...'}</td>
                <td>-</td>
              </tr>
              <tr>
                <td>Largest queue (where)</td>
                <td>{resA ? topQueue(resA) : '...'}</td>
                <td>{resB ? topQueue(resB) : '...'}</td>
                <td>-</td>
              </tr>
              {EXIT_GROUPS.map((g) => (
                <tr key={g}>
                  <td>Exit {GROUP_SHORT[g]}</td>
                  <td>{resA ? resA.exitGroupUsage[g] : '...'}</td>
                  <td>{resB ? resB.exitGroupUsage[g] : '...'}</td>
                  <td>{phys ? Math.round(phys.exitUsageImm[g] ?? 0) : '...'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn small"
            disabled={!resA || !resB}
            onClick={() => download(`compare-seed${cfg.seed}.csv`, toCsv(Array.from({ length: Math.max(curveA.length, curveB.length, phys?.curveImm.length ?? 0) }, (_, t) => ({ t, A: curveA[t] ?? N, B: curveB[t] ?? N, C_imm: phys?.curveImm[t] ?? N, C_pre: phys?.curvePre[t] ?? N, C_A: realA?.[t] ?? '', C_B: realB?.[t] ?? '' }))), 'text/csv')}
          >
            Export curves (CSV)
          </button>
        </div>
      </div>
      <details className="card" onToggle={(e) => setFlowOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <b>Optimal network flow and minimum cut (Model C)</b>
        </summary>
        {flowOpen && <FlowAnalysis geo={geo} cfg={cfg} dark={dark} />}
      </details>
    </div>
  );
}

function topQueue(r: RunResult): string {
  const g = [...r.gates].sort((a, b) => b.maxQueue - a.maxQueue)[0];
  return g ? `${g.maxQueue} (${g.label})` : '-';
}
