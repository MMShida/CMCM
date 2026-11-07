import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { STATE_LABEL } from '../src/simulation/Agent';
const sim = new SimulationEngine(BAILEY_HALL, scenarioById(process.argv[2] ?? 'concert-emergency'), 1);
const T = Number(process.argv[3] ?? 150);
while (!sim.finished && sim.t < T) sim.step();
const g = sim.graph, mv = sim.movement;
for (const id of (process.argv[4] ?? 'OST_BW,MRW_x1,MRW_x2,MRW_x3,MRW_x4,MRW_xw,D4,VSCW').split(',')) {
  const li = g.linkIndex.get(id); if (li === undefined) { console.log('no', id); continue; }
  const L = g.links[li];
  const parts: string[] = [];
  for (let d = 0; d < 2; d++) for (let ln = 0; ln < L.lanes; ln++) {
    const arr = mv.lanes[li][d][ln];
    if (arr.length) parts.push(`d${d}l${ln}:[` + arr.map(i => { const a = sim.agents[i]; return `${i}@${a.sDir.toFixed(2)} v${a.v.toFixed(2)} pn${a.pendingNext} tg${a.targetGroup}`; }).join(', ') + ']');
  }
  console.log(id, g.nodes[L.a].id, '->', g.nodes[L.b].id, 'len', L.len.toFixed(2), 'w', L.width, 'lanes', L.lanes, parts.join(' | '));
}
for (const nid of (process.argv[5] ?? 'MRW_0,MRW_1,MRW_4,MRW_wk,C_D4W').split(',')) { const n = g.nodeIndex.get(nid)!; console.log(nid, g.adj[n].map(e => g.links[e.link].id + (g.links[e.link].isRow ? '(row)' : '')).join(' ')); }
