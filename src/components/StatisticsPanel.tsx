import { EXIT_GROUPS } from '../geometry/types';
import type { LiveController } from './LiveController';
import { GROUP_COLOR_INDEX, GROUP_SHORT, fmt, pct, seriesColor } from './util';

export function StatisticsPanel({ ctl }: { ctl: LiveController }) {
  const s = ctl.currentStats();
  const flows = ctl.recentFlows(10);
  const frac = s.N ? s.left / s.N : 0;
  const done = ctl.sim.finished && ctl.replay === null;
  const snaps = ctl.snapshots;
  const upto = ctl.replay ?? snaps.length - 1;
  const curve = snaps.slice(0, upto + 1).map((x) => x.stats.inside);
  const W = 240;
  const H = 70;
  const maxT = Math.max(200, snaps.length);
  return (
    <div className="panel stats">
      <div className="stat-hero">
        <div>
          <div className="hero-num">{fmt(s.t, 1)} s</div>
          <div className="muted small">simulated time{ctl.replay !== null ? ' (replay)' : ''}</div>
        </div>
        <div>
          <div className="hero-num">{pct(frac, 1)}</div>
          <div className="muted small">left the building</div>
        </div>
      </div>
      <div className="progress" title="progress towards complete evacuation">
        <div style={{ width: `${frac * 100}%` }} />
        {s.t >= 180 || true ? <span className="bench" style={{ left: `${Math.min(100, (180 / maxT) * 100)}%` }} /> : null}
      </div>
      <table className="kv">
        <tbody>
          <tr>
            <th>Total occupancy</th>
            <td>{s.N}</td>
          </tr>
          <tr>
            <th>Evacuated (left building)</th>
            <td>{s.left}</td>
          </tr>
          <tr>
            <th>Reached street level</th>
            <td>{s.safe}</td>
          </tr>
          <tr>
            <th>Still inside</th>
            <td>{s.inside}</td>
          </tr>
          <tr>
            <th>Not yet moving (seated / preparing)</th>
            <td>{s.notStarted}</td>
          </tr>
          <tr>
            <th>Moving</th>
            <td>{s.moving}</td>
          </tr>
          <tr>
            <th>Queuing</th>
            <td>{s.queuing}</td>
          </tr>
          <tr>
            <th>Most congested bottleneck</th>
            <td>
              {s.worstGate} {s.worstQueue ? `(${s.worstQueue} waiting)` : ''}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="subhead">Inside the building</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="spark">
        <line x1={(180 / maxT) * W} x2={(180 / maxT) * W} y1={0} y2={H} className="ref" />
        <path d={curve.map((v, i) => `${i ? 'L' : 'M'}${((i / maxT) * W).toFixed(1)},${(H - 4 - (v / Math.max(1, s.N)) * (H - 8)).toFixed(1)}`).join('')} fill="none" stroke="#2a78d6" strokeWidth={2} />
      </svg>
      <div className="muted small">dashed line: 180 s benchmark</div>
      <div className="subhead">Flow at exits (persons/s, last 10 s)</div>
      <table className="kv">
        <tbody>
          {EXIT_GROUPS.map((g, i) => (
            <tr key={g}>
              <th>
                <span className="swatch" style={{ background: seriesColor(GROUP_COLOR_INDEX[g]) }} />
                {GROUP_SHORT[g]}
              </th>
              <td>{fmt(flows[i], 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {done && <div className="done-note">Simulation finished. Detailed results are shown below the map.</div>}
    </div>
  );
}
