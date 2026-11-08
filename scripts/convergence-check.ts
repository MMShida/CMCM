/**
 * Numerical convergence check: the same scenario and seeds at time step dt and dt/2 (Model A).
 *
 *   npx tsx scripts/convergence-check.ts --scenario concert-emergency --runs 30 [--dt 0.1] [--seed 777]
 *
 * Reports the paired difference of T_evac, the 95% exit time and the mean exit time with 95%
 * confidence intervals, and the spread (sd) at both steps. A difference whose interval contains 0
 * and similar spreads mean the results are not an artefact of the time step.
 */
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { batchSeeds, pairedComparison, summarize } from '../src/simulation/MonteCarlo';
import type { SimConfig } from '../src/simulation/Params';
import { SCENARIOS, STRATEGIES } from '../src/simulation/Scenarios';
import { SimPool } from './pool';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const id = arg('scenario', 'concert-emergency')!;
  const runs = Number(arg('runs', '30'));
  const dt = Number(arg('dt', '0.1'));
  const def = SCENARIOS.find((s) => s.id === id) ?? STRATEGIES.find((s) => s.id === id);
  if (!def) throw new Error(`unknown scenario ${id}`);
  const a: SimConfig = def.build(BAILEY_HALL);
  a.movement.dt = dt;
  const b: SimConfig = structuredClone(a);
  b.movement.dt = dt / 2;
  const seeds = batchSeeds(Number(arg('seed', '777')), runs);
  const pool = new SimPool();
  const [ra, rb] = [await pool.run(a, seeds), await pool.run(b, seeds)];
  await pool.close();
  const sa = summarize(ra.map((r) => r.tEvac));
  const sb = summarize(rb.map((r) => r.tEvac));
  console.log(`dt = ${dt}: T_evac ${sa.mean.toFixed(1)} s (sd ${sa.sd.toFixed(1)}, max ${sa.max.toFixed(0)})`);
  console.log(`dt = ${dt / 2}: T_evac ${sb.mean.toFixed(1)} s (sd ${sb.sd.toFixed(1)}, max ${sb.max.toFixed(0)})`);
  for (const d of pairedComparison(ra, rb).filter((x) => ['tEvac', 'p95Exit', 'meanExit'].includes(x.metric)))
    console.log(`  ${d.metric.padEnd(10)} (dt/2 - dt): ${d.meanDiff.toFixed(1)} s [${d.ciLow.toFixed(1)}, ${d.ciHigh.toFixed(1)}] ${d.ciLow <= 0 && d.ciHigh >= 0 ? 'not significant' : 'SIGNIFICANT'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
