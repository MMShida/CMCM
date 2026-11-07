import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
const sim = new SimulationEngine(BAILEY_HALL, scenarioById(process.argv[2] ?? 'concert-emergency'), 1);
sim.run();
const g = sim.graph;
for (const id of (process.argv[3] ?? 'OST_FW,OST_MW,OST_BW,OST_BE,SDW,FC1,FC2,FC3,P2,D4').split(',')) {
  const li = g.linkIndex.get(id)!;
  const log = sim.gates.passLog.get(li) ?? [];
  const bins: number[] = [];
  for (let s = 0; s < log.length; s += 20) bins.push(log.slice(s, s + 20).reduce((a, b) => a + b, 0));
  console.log(id.padEnd(8), 'cap', sim.gates.baseCap[li].toFixed(2), 'per20s:', bins.join(' '));
}
// orchestra agents exit time distribution
const orch = sim.agents.filter(a => sim.geo.seats[a.seat].level === 'orchestra');
const t = orch.map(a => a.tLeftBuilding).sort((a,b)=>a-b);
console.log('orchestra left building quantiles', [0.1,0.5,0.9,1].map(q => t[Math.min(t.length-1, Math.floor(q*(t.length-1)))].toFixed(0)));
for (const lv of ['mezzanine','balcony']) { const tt = sim.agents.filter(a => sim.geo.seats[a.seat].level === lv).map(a=>a.tLeftBuilding).sort((a,b)=>a-b); console.log(lv, [0.1,0.5,0.9,1].map(q => tt[Math.min(tt.length-1, Math.floor(q*(tt.length-1)))].toFixed(0))); }
