/**
 * Model comparison experiments on the command line (parallel worker threads).
 *
 *   npm run compare -- --runs 30 --seed 2026 [--only baseline,interventions,occupancy,sensitivity] [--models A,B] [--workers 8] [--force]
 *
 * Writes results/comparison/report.json, results/comparison/runs.csv, public/results/comparison-report.json
 * (loaded by the Results dashboard) and docs/COMPARISON_RESULTS.md. Per-cell results are cached in
 * results/comparison/cache (use --force to recompute).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { PairRecord } from '../src/compare/Comparison';
import type { ExperimentKind, PhysSummary } from '../src/compare/Experiments';
import { assembleReport, planCells } from '../src/compare/Experiments';
import { reportMarkdown } from '../src/compare/ReportMarkdown';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { batchSeeds } from '../src/simulation/Random';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const runs = Number(opt('runs', '30'));
const baseSeed = Number(opt('seed', '2026'));
const kinds = opt('only', 'baseline,interventions,occupancy,sensitivity').split(',') as ExperimentKind[];
const models = opt('models', 'A,B').split(',') as ('A' | 'B')[];
const nWorkers = Number(opt('workers', String(Math.max(1, cpus().length - 1))));
const force = args.includes('--force');
const outDir = 'results/comparison';
mkdirSync(`${outDir}/cache`, { recursive: true });
mkdirSync('public/results', { recursive: true });

const cells = planCells(kinds, BAILEY_HALL);
const seeds = batchSeeds(baseSeed, runs);
const cacheFile = (id: string) => `${outDir}/cache/${id.replace(/[^A-Za-z0-9_.-]/g, '_')}-r${runs}-s${baseSeed}-${models.join('')}.json`;

type Job = { index: number; kind: 'pair' | 'phys'; cfg: unknown; seed: number; geo?: unknown; models?: string[]; benchmarks?: boolean };
const jobs: Job[] = [];
const records: PairRecord[][] = cells.map(() => new Array(runs));
const phys: PhysSummary[] = new Array(cells.length);
const slot: { cell: number; run: number }[] = [];
cells.forEach((c, ci) => {
  if (!force && existsSync(cacheFile(c.id))) {
    const cached = JSON.parse(readFileSync(cacheFile(c.id), 'utf8'));
    records[ci] = cached.records;
    phys[ci] = cached.phys;
    return;
  }
  slot.push({ cell: ci, run: -1 });
  jobs.push({ index: jobs.length, kind: 'phys', cfg: c.cfg, seed: seeds[0], geo: c.geo });
  seeds.forEach((s, ri) => {
    slot.push({ cell: ci, run: ri });
    jobs.push({ index: jobs.length, kind: 'pair', cfg: c.cfg, seed: s, geo: c.geo, models, benchmarks: true });
  });
});

const t0 = Date.now();
console.log(`${cells.length} cells x ${runs} seeds, models ${models.join('+')}: ${jobs.length} jobs on ${nWorkers} workers (${cells.length - new Set(slot.map((s) => s.cell)).size} cells cached)`);
let done = 0;
const remaining = new Map<number, number>();
for (const s of slot) remaining.set(s.cell, (remaining.get(s.cell) ?? 0) + 1);
const flushCell = (ci: number) => writeFileSync(cacheFile(cells[ci].id), JSON.stringify({ records: records[ci], phys: phys[ci] }));

await Promise.all(
  Array.from({ length: Math.min(nWorkers, Math.max(1, jobs.length)) }, (_, w) => {
    const mine = jobs.filter((j) => j.index % nWorkers === w);
    if (!mine.length) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const wk = new Worker(new URL('./compare-worker-boot.mjs', import.meta.url), { workerData: { jobs: mine }, resourceLimits: { maxYoungGenerationSizeMb: 96, maxOldGenerationSizeMb: 2048 } });
      wk.on('message', (m: { index: number; result: unknown }) => {
        const s = slot[m.index];
        if (s.run < 0) phys[s.cell] = m.result as PhysSummary;
        else records[s.cell][s.run] = m.result as PairRecord;
        done++;
        const left = remaining.get(s.cell)! - 1;
        remaining.set(s.cell, left);
        if (left === 0) {
          flushCell(s.cell);
          console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)} s] ${done}/${jobs.length} ${cells[s.cell].name} done`);
        }
      });
      wk.on('error', reject);
      wk.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}`))));
    });
  }),
);

const report = assembleReport(cells, records, phys, { source: 'cli', runs, baseSeed, models });
// keep sections computed by earlier invocations (e.g. sensitivity with fewer seeds); --fresh discards them
const prevPath = `${outDir}/report.json`;
const prev = existsSync(prevPath) && !args.includes('--fresh') ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
report.sectionRuns = { ...(prev?.sectionRuns ?? {}), ...Object.fromEntries(kinds.map((k) => [k, runs])) };
for (const k of ['baseline', 'interventions', 'occupancy', 'sensitivity'] as const) if (!report[k] && prev?.[k]) (report as unknown as Record<string, unknown>)[k] = prev[k];
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
writeFileSync('public/results/comparison-report.json', JSON.stringify(report));
const rows: string[] = ['cell,model,seed,tEvac,tEvacAmbulatory,meanExit,p95Exit,medianStart,meanQueueTime,maxQueue,maxQueueWhere,allLeftBuilding,trapped,C_imm,C_pre,C_realA,C_realB'];
cells.forEach((c, ci) =>
  records[ci].forEach((r) => {
    for (const m of models) {
      const x = r[m];
      if (!x) continue;
      rows.push([c.id, m, r.seed, x.tEvac, x.tEvacAmbulatory, x.meanExit, x.p95Exit, x.medianStart, x.meanQueueTime.toFixed(2), x.maxQueue1, JSON.stringify(x.maxQueueWhere), x.allLeftBuilding, x.trapped, r.C?.imm, r.C?.pre, r.C?.realA, r.C?.realB].join(','));
    }
  }),
);
writeFileSync(`${outDir}/runs.csv`, rows.join('\n'));
writeFileSync('docs/COMPARISON_RESULTS.md', reportMarkdown(report));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outDir}/report.json, ${outDir}/runs.csv, public/results/comparison-report.json, docs/COMPARISON_RESULTS.md`);
if (report.baseline) {
  const b = report.baseline.stats;
  console.log(`baseline: A ${b.A?.tEvac.mean.toFixed(1)} s, B ${b.B?.tEvac.mean.toFixed(1)} s, C_imm ${b.C?.imm.mean.toFixed(0)} s, C_pre ${b.C?.pre.mean.toFixed(0)} s`);
}
