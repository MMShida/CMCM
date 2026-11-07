import { parentPort, workerData } from 'node:worker_threads';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { toRunSummary } from '../src/simulation/MonteCarlo';
import { runSimulation } from '../src/simulation/SimulationEngine';

const { cfg, seeds, indices, agents } = workerData as { cfg: any; seeds: number[]; indices: number[]; agents?: boolean };
for (let k = 0; k < seeds.length; k++) {
  const r = runSimulation(BAILEY_HALL, cfg, seeds[k], { agents: !!agents });
  parentPort!.postMessage({ index: indices[k], summary: toRunSummary(r), agents: agents ? r.agents : undefined });
}
