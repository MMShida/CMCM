import { useMemo, useRef, useState } from 'react';
import { BAILEY_HALL } from '../geometry/BaileyHall';
import { NavGraph } from '../geometry/NavigationGraph';
import type { Floor, GeometryData, MapOverlay } from '../geometry/types';
import type { CanvasOptions, FloorMode } from './SimulationCanvas';
import { SimulationCanvas } from './SimulationCanvas';
import { download, fmt } from './util';

function distToPoly(pts: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

export function GeometryEditor({ geo, setGeo, dark }: { geo: GeometryData; setGeo: (g: GeometryData) => void; dark: boolean }) {
  const [work] = useState(() => ({ g: structuredClone(geo) as GeometryData }));
  const [ver, setVer] = useState(0);
  const graph = useMemo(() => new NavGraph(work.g), [ver]);
  const [floorMode, setFloorMode] = useState<FloorMode>('floor1');
  const [opts, setOpts] = useState<CanvasOptions>({ showLinks: true, showLabels: true, showSeats: true, showAgents: false, highlightApprox: true, overlayOpacity: 0.55, overlayKind: 'plan' });
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selLink, setSelLink] = useState<string | null>(null);
  const [moveMode, setMoveMode] = useState(false);
  const dragging = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const g = work.g;
  const node = selNode ? g.nodes.find((n) => n.id === selNode) : null;
  const link = selLink ? g.links.find((l) => l.id === selLink) : null;
  const ovId = opts.overlayKind === 'chart' ? (floorMode === 'balcony' ? 'chart2' : 'chart1') : floorMode === 'balcony' ? 'plan2' : 'plan1';
  const ov = g.overlays.find((o) => o.id === ovId)!;
  const bump = () => setVer((v) => v + 1);

  const pick = (x: number, y: number, floor: Floor) => {
    let bestN: string | null = null;
    let bd = 0.8;
    for (const n of g.nodes) {
      if ((n.floor === 2 ? 2 : 1) !== floor) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) {
        bd = d;
        bestN = n.id;
      }
    }
    if (bestN) {
      setSelNode(bestN);
      setSelLink(null);
      return;
    }
    let bestL: string | null = null;
    let bl = 0.7;
    for (const l of g.links) {
      if ((l.floor === 2 ? 2 : 1) !== floor) continue;
      const d = distToPoly(l.pts, x, y);
      if (d < bl) {
        bl = d;
        bestL = l.id;
      }
    }
    setSelLink(bestL);
    setSelNode(null);
  };

  const moveNode = (id: string, x: number, y: number) => {
    const n = g.nodes.find((q) => q.id === id)!;
    n.x = Math.round(x * 100) / 100;
    n.y = Math.round(y * 100) / 100;
    for (const l of g.links) {
      if (l.a === id) l.pts[0] = [n.x, n.y];
      if (l.b === id) l.pts[l.pts.length - 1] = [n.x, n.y];
    }
  };

  const setOverlay = (patch: Partial<MapOverlay>) => {
    Object.assign(ov, patch);
    bump();
  };

  return (
    <div className="page editor">
      <h2>Geometry editor and map calibration</h2>
      <p className="muted">
        The simulator reads an editable JSON geometry (nodes, links with widths, seats, walls). Use the PDF overlay to check the reconstruction, drag nodes to correct positions, and edit door/stair widths.
        Approximate elements (estimated, not dimensioned) are highlighted in amber. Click <b>Apply</b> to use the edited geometry in all simulations.
      </p>
      <div className="toolbar">
        <span className="seg">
          {(
            [
              ['floor1', 'First floor'],
              ['balcony', 'Balcony'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} className={`btn small ${floorMode === m ? 'on' : ''}`} onClick={() => setFloorMode(m)}>
              {l}
            </button>
          ))}
        </span>
        <label className="inline-ctl">
          overlay
          <select value={opts.overlayKind} onChange={(e) => setOpts({ ...opts, overlayKind: e.target.value as 'plan' | 'chart' })}>
            <option value="plan">floor plan (p.4-5)</option>
            <option value="chart">seating chart (p.6-7)</option>
          </select>
          <input type="range" min={0} max={1} step={0.05} value={opts.overlayOpacity} onChange={(e) => setOpts({ ...opts, overlayOpacity: Number(e.target.value) })} />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={moveMode} onChange={(e) => setMoveMode(e.target.checked)} /> drag nodes
        </label>
        <label className="toggle">
          <input type="checkbox" checked={!!opts.highlightApprox} onChange={(e) => setOpts({ ...opts, highlightApprox: e.target.checked })} /> highlight approximate
        </label>
        <button className="btn primary" onClick={() => setGeo(structuredClone(g))}>
          Apply to simulator
        </button>
        <button className="btn" onClick={() => download('bailey-hall-geometry.json', JSON.stringify(g), 'application/json')}>
          Export JSON
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const parsed = JSON.parse(await f.text()) as GeometryData;
              if (!parsed.nodes || !parsed.links || !parsed.seats) throw new Error('not a geometry file');
              work.g = parsed;
              bump();
            } catch (err) {
              alert(String(err));
            }
          }}
        />
        <button
          className="btn"
          onClick={() => {
            work.g = structuredClone(BAILEY_HALL);
            bump();
            setGeo(BAILEY_HALL);
          }}
        >
          Reset to bundled
        </button>
      </div>
      <div className="editor-main">
        <div className="map-wrap tall">
          <SimulationCanvas
            key={ver}
            geo={g}
            graph={graph}
            floorMode={floorMode}
            options={opts}
            dark={dark}
            getFrame={() => null}
            getDyn={() => ({})}
            selectedNode={selNode}
            selectedLink={selLink}
            onClickWorld={(x, y, f) => pick(x, y, f)}
            onDragStart={(x, y, f) => {
              if (!moveMode || !selNode) return false;
              const n = g.nodes.find((q) => q.id === selNode)!;
              if ((n.floor === 2 ? 2 : 1) !== f || Math.hypot(n.x - x, n.y - y) > 1.2) return false;
              dragging.current = selNode;
              return true;
            }}
            onDragMove={(x, y) => dragging.current && moveNode(dragging.current, x, y)}
            onDragEnd={() => {
              dragging.current = null;
              bump();
            }}
          />
        </div>
        <div className="side panel">
          <h3>Overlay calibration: {ov.label}</h3>
          <label className="ctl">
            <span className="ctl-label">world offset x / y (m)</span>
            <span className="ctl-row">
              <input className="num wide" type="number" step={0.1} value={ov.worldOrigin[0]} onChange={(e) => setOverlay({ worldOrigin: [Number(e.target.value), ov.worldOrigin[1]] })} />
              <input className="num wide" type="number" step={0.1} value={ov.worldOrigin[1]} onChange={(e) => setOverlay({ worldOrigin: [ov.worldOrigin[0], Number(e.target.value)] })} />
            </span>
          </label>
          <label className="ctl">
            <span className="ctl-label">metres per pixel x / y</span>
            <span className="ctl-row">
              <input className="num wide" type="number" step={0.0005} value={ov.metresPerPxX} onChange={(e) => setOverlay({ metresPerPxX: Number(e.target.value) })} />
              <input className="num wide" type="number" step={0.0005} value={ov.metresPerPxY} onChange={(e) => setOverlay({ metresPerPxY: Number(e.target.value) })} />
            </span>
          </label>
          <label className="ctl">
            <span className="ctl-label">rotation (deg)</span>
            <input className="num wide" type="number" step={0.5} value={ov.rotationDeg} onChange={(e) => setOverlay({ rotationDeg: Number(e.target.value) })} />
          </label>
          <hr />
          {node && (
            <>
              <h3>Node {node.id}</h3>
              <table className="kv">
                <tbody>
                  <tr>
                    <th>kind</th>
                    <td>{node.kind}</td>
                  </tr>
                  <tr>
                    <th>floor</th>
                    <td>{node.floor}</td>
                  </tr>
                  <tr>
                    <th>label</th>
                    <td>{node.label ?? '-'}</td>
                  </tr>
                </tbody>
              </table>
              <label className="ctl">
                <span className="ctl-label">x / y (m)</span>
                <span className="ctl-row">
                  <input className="num wide" type="number" step={0.05} value={node.x} onChange={(e) => (moveNode(node.id, Number(e.target.value), node.y), bump())} />
                  <input className="num wide" type="number" step={0.05} value={node.y} onChange={(e) => (moveNode(node.id, node.x, Number(e.target.value)), bump())} />
                </span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={!!node.approx} onChange={(e) => ((node.approx = e.target.checked), bump())} /> approximate
              </label>
              <div className="muted small">Links: {g.links.filter((l) => l.a === node.id || l.b === node.id).map((l) => l.id).join(', ')}</div>
            </>
          )}
          {link && (
            <>
              <h3>Link {link.label ?? link.id}</h3>
              <table className="kv">
                <tbody>
                  <tr>
                    <th>id</th>
                    <td>{link.id}</td>
                  </tr>
                  <tr>
                    <th>kind</th>
                    <td>{link.kind}</td>
                  </tr>
                  <tr>
                    <th>nodes</th>
                    <td>
                      {link.a} → {link.b}
                    </td>
                  </tr>
                  <tr>
                    <th>length</th>
                    <td>{fmt(graph.links[graph.linkIndex.get(link.id)!].len, 2)} m</td>
                  </tr>
                  <tr>
                    <th>gate (capacity-limited)</th>
                    <td>{link.gate ? 'yes' : 'no'}</td>
                  </tr>
                  <tr>
                    <th>source</th>
                    <td>{link.source ?? '-'}</td>
                  </tr>
                </tbody>
              </table>
              <label className="ctl">
                <span className="ctl-label">clear width (m)</span>
                <input className="num wide" type="number" step={0.05} min={0.3} value={link.width} onChange={(e) => ((link.width = Math.max(0.3, Number(e.target.value))), bump())} />
              </label>
              {link.kind === 'stair' && (
                <label className="ctl">
                  <span className="ctl-label">vertical drop (m)</span>
                  <input className="num wide" type="number" step={0.1} value={link.drop ?? 0} onChange={(e) => ((link.drop = Number(e.target.value)), bump())} />
                </label>
              )}
              <label className="toggle">
                <input type="checkbox" checked={!!link.approx} onChange={(e) => ((link.approx = e.target.checked), bump())} /> approximate
              </label>
            </>
          )}
          {!node && !link && <p className="muted">Click a node or a link to inspect and edit it.</p>}
          <hr />
          <div className="muted small">
            {g.nodes.length} nodes · {g.links.length} links · {g.seats.length} seats · {g.links.filter((l) => l.approx).length} approximate links
          </div>
          <ul className="notes">
            {g.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
