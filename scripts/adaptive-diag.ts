/**
 * Diagnoses surprising adaptive results by splitting the adaptive switches (agents only,
 * managers only, both) for one scenario / placement, on paired seeds, and printing exit-group
 * usage, maximum queues, manager switches and the first instructions of each manager.
 *   npx tsx scripts/adaptive-diag.ts [--scenario concert-emergency] [--placement decision] [--runs 8] [--model A]
 *     [--variants fixed,managers] [--patch '{"adaptive":{"comm":"none"}}'] [--verbose]
 * --patch is merged into every variant's config (after the adaptive switches), for ablations.
 */
import { batchSeeds } from '../src/simulation/MonteCarlo';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import type { PlacementId, SimConfig } from '../src/simulation/Params';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimPool } from './pool';

const arg = (n: string, d: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const RUNS = Number(arg('runs', '8'));
const SEEDS = batchSeeds(Number(arg('seed', '777')), RUNS);
const MODEL = arg('model', 'A') as 'A' | 'B';
const scen = arg('scenario', 'concert-emergency');
const placement = arg('placement', 'existing') as PlacementId;
const verbose = process.argv.includes('--verbose');
const PATCH = JSON.parse(arg('patch', '{}'));
const VARS = arg('variants', 'fixed,agents,managers,both').split(',');
const merge = (o: any, p: any) => {
  for (const k of Object.keys(p)) {
    if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) merge((o[k] ??= {}), p[k]);
    else o[k] = p[k];
  }
};

const allVariants: [string, (c: SimConfig) => void][] = [
  ['fixed', () => {}],
  ['agents', (c) => (c.adaptive.agents = true)],
  ['managers', (c) => (c.adaptive.managers = true)],
  ['both', (c) => ((c.adaptive.agents = true), (c.adaptive.managers = true))],
];
const variants = allVariants.filter(([k]) => VARS.includes(k));

const pool = new SimPool();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const out: Record<string, RunSummary[]> = {};
await Promise.all(
  variants.map(async ([k, f]) => {
    const c = scenarioById(scen);
    c.crowdManagers.placement = placement;
    f(c);
    merge(c, PATCH);
    out[k] = await pool.run(c, SEEDS, MODEL);
  }),
);
await pool.close();
console.log(`${scen}, placement ${placement}, Model ${MODEL}, ${RUNS} seeds, patch ${JSON.stringify(PATCH)}`);
for (const [k] of variants) {
  const rs = out[k];
  const groups = Object.keys(rs[0].exitGroupUsage);
  const usage = groups.map((g) => `${g} ${mean(rs.map((r) => r.exitGroupUsage[g] ?? 0)).toFixed(0)}`).join(' ');
  const gates = Object.keys(rs[0].maxQueue);
  const q = gates
    .map((g) => [g, mean(rs.map((r) => r.maxQueue[g] ?? 0))] as const)
    .filter(([, v]) => v >= 5)
    .map(([g, v]) => `${g} ${v.toFixed(0)}`)
    .join(', ');
  console.log(`\n${k.padEnd(9)} T ${mean(rs.map((r) => r.tEvac)).toFixed(1)}  switches ${mean(rs.map((r) => r.behaviour?.exitSwitches ?? 0)).toFixed(0)}  flipflops ${mean(rs.map((r) => r.behaviour?.flipFlops ?? 0)).toFixed(1)}`);
  console.log(`  usage: ${usage}`);
  console.log(`  max queue >= 5: ${q}`);
  if (rs[0].managers)
    for (let i = 0; i < rs[0].managers.length; i++) {
      const ms = rs.map((r) => r.managers![i]);
      console.log(
        `  ${ms[0].id.padEnd(5)} zones ${ms[0].zones.join('/')}  switches ${mean(ms.map((m) => m.switches)).toFixed(1)}  complied ${mean(ms.map((m) => m.complied)).toFixed(0)}  changed ${mean(ms.map((m) => m.changed)).toFixed(0)}  conflicts ${mean(ms.map((m) => m.conflicts)).toFixed(1)}`,
      );
      if (verbose && k !== 'fixed' && k !== 'agents')
        for (const h of ms[0].history.slice(0, 8)) console.log(`      ${JSON.stringify(h)}`);
    }
}
