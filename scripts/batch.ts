/**
 * Command-line Monte Carlo batch.
 *
 *   npm run batch -- --scenario concert-emergency --runs 100 --seed 2026 [--out results/x] [--workers 6] [--set movement.doorFlow=1.6]
 *
 * Writes <out>.runs.csv (one line per replication), <out>.json (config + statistics).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { batchSeeds, batchStats } from '../src/simulation/MonteCarlo';
import { SCENARIOS, STRATEGIES } from '../src/simulation/Scenarios';
import { runParallel } from './parallel';
import { runsToCsv } from './csv';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
function setPath(obj: any, path: string, value: string) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const old = o[parts[parts.length - 1]];
  o[parts[parts.length - 1]] = typeof old === 'number' ? Number(value) : typeof old === 'boolean' ? value === 'true' : value.startsWith('[') || value.startsWith('{') ? JSON.parse(value) : value;
}

async function main() {
  const id = arg('scenario', 'concert-emergency')!;
  const runs = Number(arg('runs', '20'));
  const seed = Number(arg('seed', '2026'));
  const workers = arg('workers') ? Number(arg('workers')) : undefined;
  const out = arg('out', `results/${id}`)!;
  const def = SCENARIOS.find((s) => s.id === id) ?? STRATEGIES.find((s) => s.id === id);
  if (!def) throw new Error(`unknown scenario ${id}. Known: ${[...SCENARIOS, ...STRATEGIES].map((s) => s.id).join(', ')}`);
  const cfg = def.build(BAILEY_HALL);
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--set') {
    const [k, v] = process.argv[i + 1].split('=');
    setPath(cfg, k, v);
  }
  const seeds = batchSeeds(seed, runs);
  const t0 = Date.now();
  const res = await runParallel(cfg, seeds, workers, (d, n) => process.stdout.write(`\r${d}/${n} runs`));
  const stats = batchStats(cfg.label, res);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.runs.csv`, runsToCsv(res));
  writeFileSync(`${out}.json`, JSON.stringify({ scenario: id, baseSeed: seed, seeds, config: cfg, stats, runs: res.map(({ inside, ...r }) => r) }, null, 1));
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
  console.log(`\n${cfg.label}: ${runs} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`  T_evac mean ${f(stats.tEvac.mean)} s (95% CI ${f(stats.tEvac.ciLow)}-${f(stats.tEvac.ciHigh)}), median ${f(stats.tEvac.median)}, sd ${f(stats.tEvac.sd)}, p5-p95 ${f(stats.tEvac.p5)}-${f(stats.tEvac.p95)}`);
  console.log(`  P(T_evac <= 180 s) = ${(stats.pMeet.p * 100).toFixed(1)}% [${(stats.pMeet.lo * 100).toFixed(1)}, ${(stats.pMeet.hi * 100).toFixed(1)}]; unresolved runs ${(stats.fracUnresolved * 100).toFixed(1)}%`);
  console.log(`  tail: 95% out by ${f(stats.p95Exit.mean)} s, 99% by ${f(stats.p99Exit.mean)} s; still inside at 180 s: ${f(stats.insideAt180.mean)} (sd ${f(stats.insideAt180.sd)}); mean exit ${f(stats.meanExit.mean)} s`);
  // who sets the evacuation time: zones of the last 20 persons out, pooled over runs
  const zones: Record<string, number> = {};
  for (const r of res) for (const [z, n] of Object.entries(r.lastOut?.zones ?? {})) zones[z] = (zones[z] ?? 0) + n / res.length;
  const top = Object.entries(zones).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([z, n]) => `${z} ${n.toFixed(1)}`).join(', ');
  const lo = (k: 'elderlyShare' | 'groupShare' | 'meanStart' | 'meanWait') => res.reduce((s, r) => s + (r.lastOut?.[k] ?? 0), 0) / res.length;
  console.log(`  last 20 out: ${top} | elderly ${(lo('elderlyShare') * 100).toFixed(0)}%, in groups ${(lo('groupShare') * 100).toFixed(0)}%, started at ${lo('meanStart').toFixed(0)} s, queued ${lo('meanWait').toFixed(0)} s`);
  console.log(`  written ${out}.runs.csv and ${out}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
