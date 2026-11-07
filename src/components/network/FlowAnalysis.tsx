/**
 * Model C panel: static maximum flow / minimum cut, blocking and barrier effects, and the
 * time-expanded quickest-evacuation benchmark (computed in a worker), drawn on the plan.
 */
import { useEffect, useMemo, useState } from 'react';
import type { physicalAnalysis } from '../../compare/Comparison';
import { runCompareJobs } from '../../compare/ComparePool';
import { BAILEY_HALL } from '../../geometry/BaileyHall';
import type { GeometryData } from '../../geometry/types';
import { EXIT_GROUPS } from '../../geometry/types';
import { networkFor } from '../../network/NetworkGraph';
import { blockingEffects, staticMaxFlow } from '../../network/StaticFlow';
import type { SimConfig } from '../../simulation/Params';
import { createPopulation } from '../../simulation/Population';
import { graphFor } from '../../simulation/SimulationEngine';
import { LineChart } from '../Charts';
import type { CanvasOptions, FloorMode } from '../SimulationCanvas';
import { SimulationCanvas } from '../SimulationCanvas';
import { Tile } from '../LiveView';
import { download, fmt, seriesColor, toCsv } from '../util';
import { drawNetwork } from './NetworkOverlay';

type Phys = ReturnType<typeof physicalAnalysis>;

export function FlowAnalysis({ geo, cfg, dark }: { geo: GeometryData; cfg: SimConfig; dark: boolean }) {
  const net = useMemo(() => networkFor(geo, cfg), [geo, cfg]);
  const graph = useMemo(() => graphFor(geo, cfg.movement.laneWidth), [geo, cfg.movement.laneWidth]);
  const N = useMemo(() => createPopulation(geo, cfg, cfg.seed).agents.length, [geo, cfg]);
  const stat = useMemo(() => {
    const all = staticMaxFlow(net, cfg, N);
    const building = staticMaxFlow(net, cfg, N, { sourceMode: 'unlimited' });
    const levels = (['orchestra', 'mezzanine', 'balcony'] as const).map((lv) => ({ level: lv, r: staticMaxFlow(net, cfg, N, { levels: [lv] }) }));
    const noBar = staticMaxFlow(net, cfg, N, { barriers: [] });
    const be = blockingEffects(net, cfg, N);
    return { all, building, levels, noBar, be };
  }, [net, cfg, N]);
  const [phys, setPhys] = useState<Phys | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flowMode, setFlowMode] = useState<'static' | 'te'>('static');
  const [floorMode, setFloorMode] = useState<FloorMode>('split');
  useEffect(() => {
    setPhys(null);
    setBusy(true);
    setErr('');
    const h = runCompareJobs<Phys>([{ kind: 'physical', cfg, seed: cfg.seed, geo: geo === BAILEY_HALL ? undefined : geo }]);
    h.promise
      .then((r) => setPhys(r[0]))
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
    return () => h.cancel();
  }, [geo, cfg]);

  const cut = new Set(stat.all.cut.map((c) => c.id));
  const opts: CanvasOptions = { showLinks: false, showLabels: false, showSeats: false, showAgents: false, overlayOpacity: 0, overlayKind: 'plan' };
  const flow = flowMode === 'static' ? stat.all.edgeFlow : phys ? phys.edgeTotalsImm : null;
  const req = N / 180;
  return (
    <div className="results flow-analysis">
      <h2>Model C - network flow benchmark</h2>
      <p className="muted small">
        Static maximum flow gives the largest sustainable discharge RATE (persons/s); it is not an evacuation time. The time-expanded network gives the quickest possible evacuation of the finite
        population under perfectly coordinated routing at the representative walking speed ({fmt(net.rates.vRep, 2)} m/s). Both are idealised benchmarks under the same graph and capacities as
        Model B.
      </p>
      <div className="tiles">
        <Tile label="Static max flow F* (row ends limit supply)" value={`${fmt(stat.all.maxFlow, 2)} p/s`} />
        <Tile label={`Required average rate (${N} in 180 s)`} value={`${fmt(req, 2)} p/s`} warn={stat.all.maxFlow < req} />
        <Tile label="Pure flow time N / F* (not an evacuation time)" value={`${fmt(stat.all.flowTime, 0)} s`} />
        <Tile label="Quickest evacuation T*, everyone ready at t = 0" value={busy ? 'computing...' : phys ? `${fmt(phys.tStarImm, 0)} s` : '-'} warn={!!phys && !(phys.tStarImm <= 180)} />
        <Tile label="T* with sampled pre-movement (no social effects)" value={busy ? 'computing...' : phys ? `${fmt(phys.tStarPre, 0)} s` : '-'} warn={!!phys && !(phys.tStarPre <= 180)} />
        <Tile label="Barriers' effect on F*" value={cfg.barriers.length ? `${fmt(stat.all.maxFlow - stat.noBar.maxFlow, 2)} p/s` : 'no barriers'} />
      </div>
      {err && <div className="stale">{err}</div>}
      <div className="toolbar">
        <span className="seg">
          <button className={`btn small ${flowMode === 'static' ? 'on' : ''}`} onClick={() => setFlowMode('static')}>
            Static max-flow pattern
          </button>
          <button className={`btn small ${flowMode === 'te' ? 'on' : ''}`} onClick={() => setFlowMode('te')} disabled={!phys}>
            Quickest-evacuation totals
          </button>
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
        <span className="muted small">line width = flow; red = minimum cut; squares = seating sources; green = exterior doors</span>
      </div>
      <div className="map-wrap flow-map">
        <SimulationCanvas
          geo={geo}
          graph={graph}
          floorMode={floorMode}
          options={opts}
          dark={dark}
          getFrame={() => null}
          getDyn={() => ({})}
          drawOverlay={(ctx, toScreen, floor, scale) => drawNetwork(ctx, toScreen, floor, scale, net, { dark, cut, flow: flow ?? undefined, showSources: true })}
        />
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Minimum cut ({fmt(stat.all.cutCapacity, 2)} p/s)</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Edge (feature id)</th>
                <th>Region</th>
                <th>Capacity (p/s)</th>
              </tr>
            </thead>
            <tbody>
              {stat.all.cut.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.label} <span className="muted">({c.id})</span>
                  </td>
                  <td>{c.region}</td>
                  <td>{fmt(c.capacity, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Building alone (unlimited supply at the row ends): F* = {fmt(stat.building.maxFlow, 2)} p/s.</p>
        </div>
        <div className="card">
          <h3>Per level (each level evacuating alone)</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Level</th>
                <th>F* (p/s)</th>
                <th>Minimum cut</th>
              </tr>
            </thead>
            <tbody>
              {stat.levels.map((l) => (
                <tr key={l.level}>
                  <td>{l.level}</td>
                  <td>{fmt(l.r.maxFlow, 2)}</td>
                  <td className="small">{l.r.cut.map((c) => c.label).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Exit flows at F*</h3>
          <div className="small">{EXIT_GROUPS.map((g) => `${g} ${fmt(stat.all.exitFlow[g], 2)}`).join(' · ')}</div>
        </div>
        <div className="card">
          <h3>Earliest-arrival curve (persons outside by time t)</h3>
          {phys ? (
            <LineChart
              series={[
                { name: 'C: everyone ready at t = 0', color: seriesColor(2), values: phys.curveImm },
                { name: 'C: sampled pre-movement', color: seriesColor(3), values: phys.curvePre },
              ]}
              xLabel="time (s)"
              yLabel="persons outside"
              refX={180}
            />
          ) : (
            <div className="muted">{busy ? 'computing the time-expanded network...' : '-'}</div>
          )}
          {phys && (
            <p className="muted small">
              Discretisation dt = 1 s; rounding of edge transit times changes shortest source-to-exit times by {fmt(phys.discretisation.meanAbsError, 2)} s on average (max{' '}
              {fmt(phys.discretisation.maxAbsError, 2)} s).
            </p>
          )}
        </div>
        <div className="card">
          <h3>Blocking one feature (change in F*)</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Closed</th>
                <th>F* (p/s)</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {stat.be.effects.slice(0, 14).map((e) => (
                <tr key={e.id}>
                  <td>{e.label}</td>
                  <td>{fmt(e.maxFlow, 2)}</td>
                  <td>{fmt(e.delta, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="row">
        <button
          className="btn"
          onClick={() =>
            download(
              'flow-analysis.json',
              JSON.stringify({ config: cfg.label, N, requiredRate: req, static: { maxFlow: stat.all.maxFlow, cut: stat.all.cut, exitFlow: stat.all.exitFlow, buildingOnly: stat.building.maxFlow, perLevel: stat.levels.map((l) => ({ level: l.level, maxFlow: l.r.maxFlow, cut: l.r.cut })) }, blocking: stat.be, timeExpanded: phys }, null, 1),
              'application/json',
            )
          }
        >
          Export flow analysis (JSON)
        </button>
        <button className="btn" onClick={() => phys && download('earliest-arrival.csv', toCsv(phys.curveImm.map((v, t) => ({ t, immediate: v, sampledPremovement: phys.curvePre[t] ?? N }))), 'text/csv')} disabled={!phys}>
          Export curves (CSV)
        </button>
        <button className="btn" onClick={() => download('network-edges.csv', toCsv(net.edges.map((e) => ({ id: e.id, label: e.label, kind: e.kind, from: net.nodes[e.a].id, to: net.nodes[e.b].id, length_m: +e.length.toFixed(2), width_m: e.width, capacity_ps: +e.capacity.toFixed(3), feature: e.feature, approx: e.approx, detailedLinks: e.links.join(' '), staticFlow: +(stat.all.edgeFlow[e.idx] ?? 0).toFixed(3) }))), 'text/csv')}>
          Export network + mapping (CSV)
        </button>
      </div>
    </div>
  );
}
