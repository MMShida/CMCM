/**
 * The 180 s question in all three models, for the baseline and the 180 s package.
 *
 *   npx tsx scripts/three-models-180.ts --runs 40 [--c-seeds 5] [--out results/three-models-180.json]
 *
 * Model A and B: Monte Carlo on the same seeds (paired audiences).
 * Model C (ideal flow, per seed): T*_imm (everyone ready at t = 0), T*_pre (sampled intrinsic
 * pre-movement), the individual own-speed bound with that pre-movement, the tighter bound
 * max(T*_pre, individual), and the pre-movement budget alpha (largest scaling of the sampled
 * departure times for which the ideal flow still meets 180 s).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { physicalAnalysis } from '../src/compare/Comparison';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { batchSeeds, summarize, wilson } from '../src/simulation/MonteCarlo';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimPool } from './pool';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const runs = Number(arg('runs', '40'));
  const cSeeds = Number(arg('c-seeds', '5'));
  const seeds = batchSeeds(Number(arg('seed', '777')), runs);
  const pool = new SimPool();
  const out: Record<string, unknown> = {};
  for (const id of ['concert-emergency', 'package-180']) {
    const cfg = scenarioById(id);
    const row: Record<string, unknown> = {};
    for (const model of ['A', 'B'] as const) {
      const res = await pool.run(cfg, seeds, model);
      const T = summarize(res.map((r) => r.tEvac));
      const w = wilson(res.filter((r) => r.tEvac <= 180).length, res.length);
      const inside = res.reduce((s, r) => s + (r.insideAt180 ?? 0), 0) / res.length;
      row[model] = { mean: T.mean, ciLow: T.ciLow, ciHigh: T.ciHigh, min: T.min, p: w.p, inside180: inside };
      console.log(`${id.padEnd(18)} ${model}: T ${T.mean.toFixed(1)} [${T.ciLow.toFixed(1)}, ${T.ciHigh.toFixed(1)}] min ${T.min.toFixed(0)}  P(<=180) ${(w.p * 100).toFixed(0)}%  inside@180 ${inside.toFixed(0)}`);
    }
    const C = seeds.slice(0, cSeeds).map((s) => physicalAnalysis(BAILEY_HALL, cfg, s, 1, { budget: true }));
    const m = (f: (c: (typeof C)[number]) => number) => C.reduce((s, c) => s + f(c), 0) / C.length;
    row.C = { tStarImm: m((c) => c.tStarImm), tStarPre: m((c) => c.tStarPre), tIndPre: m((c) => c.tIndPre), tBoundPre: m((c) => c.tBoundPre), alpha: m((c) => c.premovementAlpha), maxFlow: C[0].maxFlow, requiredRate: C[0].requiredRate };
    const c = row.C as Record<string, number>;
    console.log(
      `${id.padEnd(18)} C: T*_imm ${c.tStarImm.toFixed(0)} s, T*_pre ${c.tStarPre.toFixed(0)} s, individual bound ${c.tIndPre.toFixed(0)} s, bound ${c.tBoundPre.toFixed(0)} s, pre-movement budget alpha ${c.alpha.toFixed(2)}, max flow ${c.maxFlow.toFixed(1)} p/s (needed ${c.requiredRate.toFixed(1)})`,
    );
    out[id] = row;
  }
  await pool.close();
  const file = arg('out');
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ runs, seeds, cSeeds, results: out }, null, 1));
    console.log(`written ${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
