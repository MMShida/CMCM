import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { STATE_LABEL } from '../src/simulation/Agent';
const cfg = scenarioById('concert-emergency');
const sim = new SimulationEngine(BAILEY_HALL, cfg, 1);
while (!sim.finished && sim.t < Number(process.argv[2] ?? 300)) sim.step();
const g = sim.graph;
const mv = sim.movement;
// dump aisle W links occupancy
for (const id of ['AW_L0','AW_L1','AW_L2','AW_L3','AW_L4','AW_L5','AW_L6','AW_L7','AW_L8','AW_L9','AW_L10','AW_L11','AW_L12','AW_L13','AW_L14','AW_L15','AW_L16','AW_L17','AW_L18','OST_BW','FX_1','FX_2']) {
  const li = g.linkIndex.get(id)!;
  const L = g.links[li];
  const parts: string[] = [];
  for (let d = 0; d < 2; d++) for (let ln = 0; ln < L.lanes; ln++) {
    const arr = mv.lanes[li][d][ln];
    if (arr.length) parts.push(`d${d}l${ln}:[` + arr.map(i => { const a = sim.agents[i]; return `${i}@${a.sDir.toFixed(2)} v${a.v.toFixed(2)} vd${a.vDes.toFixed(2)} tg${a.targetGroup} pn${a.pendingNext} ${STATE_LABEL[a.state][0]}${a.state}`; }).join(', ') + ']');
  }
  console.log(id, 'len', L.len.toFixed(2), 'w', L.width, 'lanes', L.lanes, parts.join(' | '));
}
const n = g.nodeIndex.get('AW_C')!;
console.log('adj AW_C', g.adj[n].map(e => `${g.links[e.link].id}->${g.nodes[e.other].id} d${e.dir}`));
