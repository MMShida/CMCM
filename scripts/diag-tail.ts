import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { batchSeeds } from '../src/simulation/MonteCarlo';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { STATE_LABEL, REASON_LABEL } from '../src/simulation/Agent';
const cfg = scenarioById(process.argv[2] ?? 'concert-emergency');
const seeds = batchSeeds(2026, Number(process.argv[3] ?? 16));
for (const seed of seeds) {
  const sim = new SimulationEngine(BAILEY_HALL, cfg, seed);
  sim.run();
  const r = sim.result();
  const last = [...sim.agents].filter(a => a.inside || Number.isFinite(a.tLeftBuilding)).sort((a, b) => b.tLeftBuilding - a.tLeftBuilding).slice(0, 3);
  console.log(`seed ${seed} tEvac ${r.tEvac.toFixed(0)}`);
  if (r.tEvac > 330) for (const a of last) {
    const s = sim.geo.seats[a.seat];
    console.log(`   last: #${a.id} ${s.id} type=${a.type} wc=${a.wheelchair} grp=${a.group} start=${a.tStartMove.toFixed(0)} left=${a.tLeftBuilding.toFixed(0)} v0=${a.v0.toFixed(2)} reroutes=${a.reroutes} wait=${a.waitTotal.toFixed(0)} exit=${a.exitLink>=0?sim.graph.links[a.exitLink].label:'-'} reason=${REASON_LABEL[a.reason]} resp=${a.tResponse.toFixed(0)} rec=${a.tRecognition.toFixed(0)} prep=${a.tPrepare.toFixed(0)}`);
  }
}
