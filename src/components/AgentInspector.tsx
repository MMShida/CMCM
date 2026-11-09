import {PlusSimulation} from '../plus/PlusSimulation';
import {stateFor} from '../plus/State';
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
    ['Crowd Manager', a.instructedCM ? (a.cmGroup >= 0 ? `${sim instanceof PlusSimulation?'accepted message':'instructed, complied'} → ${GROUP_SHORT[EXIT_GROUPS[a.cmGroup]]}` : 'instructed, did not accept') : 'not reached'],
    ['LED guidance', a.ledSeen ? (a.ledGroup >= 0 ? `${sim instanceof PlusSimulation?'accepted message':'followed'} → ${GROUP_SHORT[EXIT_GROUPS[a.ledGroup]]}` : 'seen / no accepted destination') : '-'],
    ['Reroutes', String(a.reroutes)],
    ['Total waiting at bottlenecks', `${fmt(a.waitTotal)} s`],
    ['Current link', link ? `${link.label} (${link.kind}), ${fmt(a.sDir, 1)}/${fmt(link.len, 1)} m, lane ${a.lane + 1}/${link.lanes}` : '-'],
    ['Speed now', `${fmt(a.v, 2)} m/s (desired ${fmt(a.vDes, 2)})`],
    ['Local density', `${fmt(a.densityHere, 2)} p/m²`],
  ];
  if(sim instanceof PlusSimulation){const p=stateFor(sim).people[a.id];rows.push(['Instruction commitment',a.wheelchair?'Accessible assistance route takes priority':p.command>=0?`${p.source} → ${EXIT_GROUPS[p.command]}`:'none'],['Pending feasible turn',p.pending?'yes, at next connected node':'no'],['Last decision',p.lastDecision],['Estimated remaining costs',p.costs.map((x,i)=>`${EXIT_GROUPS[i]}: ${x===null?'unknown':x.toFixed(1)+' s'}`).join('; ')],['Visible queues / apparent rate',p.observed.map(o=>`${o.link}: ${o.queue} people / ${o.rate.toFixed(2)} p/s / ${o.wait.toFixed(1)} s`).join('; ')||'none']);}
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
      {sim instanceof PlusSimulation&&<details open><summary>Information and decision history</summary>{stateFor(sim).people[a.id].history.map((e,i)=><p className="small" key={i}>{e.t.toFixed(1)} s · {e.kind} {e.source} → {EXIT_GROUPS[e.exit]} {e.accepted===undefined?'':e.accepted?'accepted':'declined'}</p>)}</details>}
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
