import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { STATE_LABEL } from '../src/simulation/Agent';
const [,, scen, seedS, idS] = process.argv;
const sim = new SimulationEngine(BAILEY_HALL, scenarioById(scen), Number(seedS));
const id = Number(idS);
let lastKey = '';
const g = sim.graph;
while (!sim.finished) {
  sim.step();
  const a = sim.agents[id];
  const L = a.link >= 0 ? g.links[a.link] : null;
  const key = `${STATE_LABEL[a.state]}|${L?.id}`;
  if (key !== lastKey || (Math.round(sim.t * 10) % 300 === 0)) {
    lastKey = key;
    let extra = '';
    if (L) {
      const n = a.dir > 0 ? L.b : L.a;
      const e = a.pendingNext >= 0 ? g.adj[n][a.pendingNext] : null;
      extra = `s=${a.sDir.toFixed(2)}/${L.len.toFixed(2)} v=${a.v.toFixed(2)} pend=${e ? g.links[e.link].id : '-'} tg=${a.targetGroup} wt=${a.waitTarget>=0?g.links[a.waitTarget].id:'-'} cnt=${sim.movement.linkCount[a.link]}`;
      if (e) { const NL = g.links[e.link]; extra += ` nextCnt=${sim.movement.linkCount[e.link]} cap=${sim.movement.occCap[e.link]} dirC=${sim.movement.dirCount[2*e.link]}/${sim.movement.dirCount[2*e.link+1]} nlanes=${NL.lanes}`; }
    }
    console.log(sim.t.toFixed(1), key, extra);
  }
  if (a.done || !a.inside) break;
}
