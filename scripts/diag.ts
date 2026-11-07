import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { STATE_LABEL } from '../src/simulation/Agent';
const cfg = scenarioById(process.argv[2] ?? 'concert-emergency');
const T = Number(process.argv[3] ?? 300);
const sim = new SimulationEngine(BAILEY_HALL, cfg, 1);
while (!sim.finished && sim.t < T) sim.step();
const byLink = new Map<string, number>();
const states = new Map<string, number>();
for (const a of sim.agents) {
  if (a.done) continue;
  states.set(STATE_LABEL[a.state], (states.get(STATE_LABEL[a.state]) ?? 0) + 1);
  if (a.link >= 0) { const L = sim.graph.links[a.link]; const k = `${L.id}(${L.kind}) st=${STATE_LABEL[a.state]}`; byLink.set(k, (byLink.get(k) ?? 0) + 1); }
}
console.log('states', Object.fromEntries(states));
console.log([...byLink.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25));
const ns = sim.agents.filter(a => a.link < 0 && !a.done).slice(0,10).map(a => ({id:a.id, st: STATE_LABEL[a.state], rec: a.tRecognition.toFixed(1), resp: a.tResponse.toFixed(1), prep: a.tPrepare.toFixed(1), clock: a.clock.toFixed(1), grp: a.group, tg: a.targetGroup, seat: sim.geo.seats[a.seat].id }));
console.log(ns);
// sample a queuing agent
const q = sim.agents.filter(a => a.state === 5).slice(0,8).map(a => { const L = sim.graph.links[a.link]; return {id:a.id, link:L.id, sDir:a.sDir.toFixed(2), len:L.len.toFixed(2), dir:a.dir, v:a.v.toFixed(2), vDes:a.vDes.toFixed(2), tg:a.targetGroup, wait:a.waitTarget>=0?sim.graph.links[a.waitTarget].id:'-', pend:a.pendingNext, node: sim.graph.nodes[a.dir>0?L.b:L.a].id, grp:a.group}; });
console.log(q);
