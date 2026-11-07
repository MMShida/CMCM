import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { runNetworkSimulation } from '../src/network/NetworkSimulation';
import { scenarioById } from '../src/simulation/Scenarios';
const id = process.argv[2] ?? 'concert-emergency';
for (const seed of [1, 2, 3]) {
  const t0 = Date.now();
  const { result: r, sim } = runNetworkSimulation(BAILEY_HALL, scenarioById(id), seed);
  console.log(`${id} seed ${seed}: tEvac ${r.tEvac.toFixed(1)} amb ${r.tEvacAmbulatory.toFixed(1)} left ${r.series.leftBuilding.at(-1)} trapped ${r.unresolved.trapped} gridlock ${r.gridlock} medStart ${r.medianStart.toFixed(1)} p95Exit ${r.p95Exit.toFixed(1)} meanQ ${sim.meanQueueTime().toFixed(1)} reroutes ${r.reroutedAgents} wall ${Date.now() - t0} ms`);
  console.log('   usage', JSON.stringify(r.exitGroupUsage), 'top waits', r.gates.slice(0, 5).map((g) => `${g.label}:${g.maxQueue}/${g.meanWait.toFixed(1)}s`).join(' '));
}
