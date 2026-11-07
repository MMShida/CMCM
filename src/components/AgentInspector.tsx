import { EXIT_GROUPS } from '../geometry/types';
import { REASON_LABEL, STATE_COLOR, STATE_LABEL } from '../simulation/Agent';
import { BEHAVIOR_LABEL } from '../simulation/Params';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import { GROUP_SHORT, fmt } from './util';

export function AgentInspector({ sim, id, onClose }: { sim: SimulationEngine; id: number; onClose: () => void }) {
  const a = sim.agents[id];
  if (!a) return null;
  const seat = sim.geo.seats[a.seat];
  const g = sim.graph;
  const group = a.group >= 0 ? sim.groups[a.group] : null;
  const known = EXIT_GROUPS.filter((_, i) => a.knownExits & (1 << i)).map((x) => GROUP_SHORT[x]);
  const link = a.link >= 0 ? g.links[a.link] : null;
  const rows: [string, string][] = [
    ['Seat', `${seat.id} (${seat.level}, zone ${seat.zone})`],
    ['Behaviour type', BEHAVIOR_LABEL[a.type]],
    ['State', STATE_LABEL[a.state]],
    ['Target exit group', a.wheelchair ? 'Assistance point (accessible route)' : a.targetGroup >= 0 ? GROUP_SHORT[EXIT_GROUPS[a.targetGroup]] : '-'],
    ['Reason for route', REASON_LABEL[a.reason] ?? '-'],
    ['Free walking speed', `${fmt(a.v0, 2)} m/s${a.elderly ? ' (over 65)' : ''}${a.wheelchair ? ' (wheelchair)' : ''}`],
    ['Stair speed ratio', fmt(a.stairRatio, 2)],
    ['Body radius', `${fmt(a.radius, 2)} m`],
    ['Impatience', fmt(a.impatience, 2)],
    ['Familiar with building', a.familiar ? 'yes' : 'no'],
    ['Recognition / response / belongings', `${fmt(a.tRecognition)} / ${fmt(a.tResponse)} / ${fmt(a.tPrepare)} s (intrinsic)`],
    ['Became aware', Number.isFinite(a.tAware) ? `${fmt(a.tAware)} s` : '-'],
    ['Started moving', Number.isFinite(a.tStartMove) ? `${fmt(a.tStartMove)} s` : '-'],
    ['Left building', Number.isFinite(a.tLeftBuilding) ? `${fmt(a.tLeftBuilding)} s` : '-'],
    ['Reached street', Number.isFinite(a.tSafe) ? `${fmt(a.tSafe)} s` : '-'],
    ['Social influence phi', fmt(a.socialPhi, 2)],
    ['Group', group ? `#${a.group} (${group.length} people${a.groupLeader ? ', leader' : ''}${sim.groupBroken[a.group] ? ', separated in crowd' : ''})` : 'alone'],
    ['Known exits', known.join(', ')],
    ['Known closures', a.knownBlocked.map((li) => g.links[li].label).join(', ') || 'none'],
    ['Crowd Manager', a.instructedCM ? (a.cmGroup >= 0 ? `instructed, complied → ${GROUP_SHORT[EXIT_GROUPS[a.cmGroup]]}` : 'instructed, did not comply') : 'not reached'],
    ['LED guidance', a.ledSeen ? (a.ledGroup >= 0 ? `followed → ${GROUP_SHORT[EXIT_GROUPS[a.ledGroup]]}` : 'seen / not followed or not perceived') : '-'],
    ['Reroutes', String(a.reroutes)],
    ['Total waiting at bottlenecks', `${fmt(a.waitTotal)} s`],
    ['Current link', link ? `${link.label} (${link.kind}), ${fmt(a.sDir, 1)}/${fmt(link.len, 1)} m, lane ${a.lane + 1}/${link.lanes}` : '-'],
    ['Speed now', `${fmt(a.v, 2)} m/s (desired ${fmt(a.vDes, 2)})`],
    ['Local density', `${fmt(a.densityHere, 2)} p/m²`],
  ];
  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className="dot" style={{ background: STATE_COLOR[a.state] }} />
        <b>Agent #{a.id}</b>
        <button className="btn small" onClick={onClose}>
          ✕
        </button>
      </div>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.utilities.length > 0 && (
        <>
          <div className="muted small">Last exit-choice evaluation (utility, est. cost s):</div>
          <table className="util">
            <tbody>
              {EXIT_GROUPS.map((gname, i) => (
                <tr key={gname} className={i === a.targetGroup ? 'sel' : ''}>
                  <th>{GROUP_SHORT[gname]}</th>
                  <td>{Number.isFinite(a.utilities[i]) ? fmt(a.utilities[i], 2) : 'unknown / unreachable'}</td>
                  <td>{Number.isFinite(a.groupCosts[i]) ? `${a.groupCosts[i]} s` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
