import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { STATE_LABEL } from '../src/simulation/Agent';
const [,, scen, seedS, tS, linksS] = process.argv;
const sim = new SimulationEngine(BAILEY_HALL, scenarioById(scen), Number(seedS));
while (!sim.finished && sim.t < Number(tS)) sim.step();
const g = sim.graph;
for (const id of linksS.split(',')) {
  const li = g.linkIndex.get(id)!; const L = g.links[li];
  console.log(`== ${id} ${g.nodes[L.a].id}->${g.nodes[L.b].id} len=${L.len.toFixed(2)} lanes=${L.lanes} cnt=${sim.movement.linkCount[li]} cap=${sim.movement.occCap[li]}`);
  for (let d = 0; d < 2; d++) for (let ln = 0; ln < L.lanes; ln++) {
    const arr = sim.movement.lanes[li][d][ln];
    for (const i of arr) { const a = sim.agents[i]; const n = a.dir>0?L.b:L.a; const e = a.pendingNext>=0? g.adj[n][a.pendingNext]:null;
      console.log(`  d${d} l${ln} #${i} s=${a.sDir.toFixed(2)} v=${a.v.toFixed(2)} vd=${a.vDes.toFixed(2)} st=${STATE_LABEL[a.state]} grp=${a.group} gcap=${a.groupCap.toFixed(2)} hes=${a.hesitate.toFixed(1)} hold=${a.holdAtNode} pathValid=${a.pathValid} pend=${e?g.links[e.link].id:'-'} lastNode=${a.lastNode>=0?g.nodes[a.lastNode].id:'-'} tg=${a.targetGroup} noRoute=${a.noRouteTime.toFixed(1)}`); }
  }
}
