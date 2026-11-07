import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { scenarioById } from '../src/simulation/Scenarios';
import { runSimulation } from '../src/simulation/SimulationEngine';
const cfg = scenarioById('concert-emergency');
for (let s = 1; s <= 3; s++) { const t0 = performance.now(); runSimulation(BAILEY_HALL, cfg, s); console.log('run', s, (performance.now() - t0).toFixed(0), 'ms'); }
