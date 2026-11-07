/**
 * Model B (network behavioural simulator) Monte Carlo batch, independent of Model A.
 *   npm run network-batch -- --scenario concert-emergency --runs 100 --seed 2026 [--out results/network/baseline]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { runNetworkSimulation } from '../src/network/NetworkSimulation';
import { batchStats, toRunSummary } from '../src/simulation/MonteCarlo';
import { batchSeeds } from '../src/simulation/Random';
import { scenarioById } from '../src/simulation/Scenarios';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const cfg = scenarioById(opt('scenario', 'concert-emergency'));
const runs = Number(opt('runs', '20'));
const seeds = batchSeeds(Number(opt('seed', '2026')), runs);
const out = opt('out', '');
const t0 = Date.now();
const summaries = seeds.map((s, i) => {
  const { result, sim } = runNetworkSimulation(BAILEY_HALL, cfg, s);
  if ((i + 1) % 10 === 0 || i + 1 === runs) console.log(`${i + 1}/${runs} runs`);
  return { ...toRunSummary(result), meanQueueTime: sim.meanQueueTime() };
});
const st = batchStats(cfg.label, summaries);
console.log(`Model B, ${cfg.label}: ${runs} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  T_evac mean ${st.tEvac.mean.toFixed(1)} s (95% CI ${st.tEvac.ciLow.toFixed(1)}-${st.tEvac.ciHigh.toFixed(1)}), median ${st.tEvac.median.toFixed(1)}, sd ${st.tEvac.sd.toFixed(1)}, p5-p95 ${st.tEvac.p5.toFixed(1)}-${st.tEvac.p95.toFixed(1)}`);
console.log(`  P(T_evac <= 180 s) = ${(st.pMeet.p * 100).toFixed(1)}% [${(st.pMeet.lo * 100).toFixed(1)}, ${(st.pMeet.hi * 100).toFixed(1)}]; unresolved runs ${(st.fracUnresolved * 100).toFixed(1)}%`);
console.log(`  mean queue time per person ${(summaries.reduce((a, s) => a + s.meanQueueTime, 0) / runs).toFixed(1)} s`);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify({ model: 'B', config: cfg, stats: st, runs: summaries.map((s) => ({ ...s, inside: undefined })) }, null, 1));
  console.log(`  written ${out}.json`);
}
