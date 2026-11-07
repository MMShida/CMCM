import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';

const id = process.argv[2] ?? 'concert-emergency';
const seed = Number(process.argv[3] ?? 1);
const cfg = scenarioById(id);
const t0 = Date.now();
const sim = new SimulationEngine(BAILEY_HALL, cfg, seed);
let lastPrint = -1;
while (!sim.finished) {
  sim.step();
  const s = Math.floor(sim.t);
  if (s % 20 === 0 && s !== lastPrint) {
    lastPrint = s;
    const ls = sim.liveStats();
    console.log(`t=${s} left=${ls.left} safe=${ls.safe} notStarted=${ls.notStarted} moving=${ls.moving} queuing=${ls.queuing} worst=${ls.worstGate}(${ls.worstQueue})`);
  }
}
const r = sim.result();
console.log('wall ms', Date.now() - t0);
console.log({ tEvac: r.tEvac, tSafe: r.tSafe, completed: r.completed, gridlock: r.gridlock, tEnd: r.tEnd, mean: r.meanExit, p95: r.p95Exit, medStart: r.medianStart, p95Start: r.p95Start, unresolved: r.unresolved, peak: r.peakDensity, where: r.peakDensityWhere, reroutes: r.totalReroutes });
console.log('groups', r.exitGroupUsage);
console.log('doors', r.exitDoorUsage);
console.log(r.gates.filter(g=>g.passes>0).map(g=>`${g.label}: n=${g.passes} cap=${g.capacity} maxQ=${g.maxQueue} wait=${g.meanWait} maxps=${g.maxPassesPerSecond}`).join('\n'));
