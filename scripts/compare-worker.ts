import { parentPort, workerData } from 'node:worker_threads';
import { runPair } from '../src/compare/Comparison';
import { physSummary } from '../src/compare/Experiments';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';

type Job = { index: number; kind: 'pair' | 'phys'; cfg: any; seed: number; geo?: any; models?: ('A' | 'B')[]; benchmarks?: boolean };
const { jobs } = workerData as { jobs: Job[] };
for (const j of jobs) {
  const geo = j.geo ?? BAILEY_HALL;
  if (j.kind === 'pair') parentPort!.postMessage({ index: j.index, result: runPair(geo, j.cfg, j.seed, { models: j.models, benchmarks: j.benchmarks }) });
  else parentPort!.postMessage({ index: j.index, result: physSummary(geo, j.cfg, j.seed, true) });
}
