/**
 * Records (or checks) reference results of the previous fixed-behaviour model, so that the
 * adaptive extensions can be shown to leave the legacy configuration unchanged.
 *   npx tsx scripts/legacy-reference.ts --write   (writes results/legacy-reference.json)
 *   npx tsx scripts/legacy-reference.ts           (compares against it)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { runNetworkSimulation } from '../src/network/NetworkSimulation';
import { scenarioById } from '../src/simulation/Scenarios';
import { runSimulation } from '../src/simulation/SimulationEngine';

const FILE = 'results/legacy-reference.json';
const cases = [
  ['concert-emergency', 'A', 11],
  ['concert-emergency', 'A', 12],
  ['package-180', 'A', 11],
  ['concert-emergency', 'B', 11],
  ['package-180', 'B', 11],
] as const;
const out: Record<string, number[]> = {};
for (const [id, m, seed] of cases) {
  const cfg = scenarioById(id);
  const r = m === 'A' ? runSimulation(BAILEY_HALL, cfg, seed) : runNetworkSimulation(BAILEY_HALL, cfg, seed).result;
  out[`${id}|${m}|${seed}`] = [r.tEvac, r.meanExit, r.totalReroutes];
  console.log(id, m, seed, r.tEvac, r.meanExit.toFixed(3), r.totalReroutes);
}
if (process.argv.includes('--write')) {
  writeFileSync(FILE, JSON.stringify(out, null, 1));
  console.log('written', FILE);
} else if (existsSync(FILE)) {
  const ref = JSON.parse(readFileSync(FILE, 'utf8'));
  let ok = true;
  for (const k of Object.keys(ref)) if (JSON.stringify(ref[k]) !== JSON.stringify(out[k])) {
    ok = false;
    console.log('DIFF', k, ref[k], out[k]);
  }
  console.log(ok ? 'legacy reference reproduced exactly' : 'LEGACY REFERENCE CHANGED');
  if (!ok) process.exit(1);
}
