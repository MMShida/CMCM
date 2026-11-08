/**
 * Evacuation time versus occupancy, T(N), and the largest audience that meets the 180 s rule.
 *
 *   npx tsx scripts/occupancy-curve.ts --base concert-emergency --runs 40 [--model A|B]
 *        [--levels 0.4,0.5,...,1] [--cm auto|fixed] [--plan results/plans/x.json] [--preassign] [--out file]
 *
 * Occupancy is scaled uniformly on all levels. --cm auto applies the legal minimum ceil(N/250)
 * Crowd Managers at every level (the problem statement's rule); fixed keeps the base count.
 * For each level: mean T_evac with its 95% CI, P(T_evac <= 180 s) with a Wilson interval, and the
 * persons still inside at 180 s. N_max is the largest tested occupancy with P >= target
 * (default 0.95), refined by linear interpolation between the bracketing levels.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { batchSeeds, summarize, wilson } from '../src/simulation/MonteCarlo';
import type { SimConfig } from '../src/simulation/Params';
import { SCENARIOS, STRATEGIES } from '../src/simulation/Scenarios';
import type { ModelId } from './pool';
import { SimPool } from './pool';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const baseId = arg('base', 'concert-emergency')!;
  const runs = Number(arg('runs', '40'));
  const model = (arg('model', 'A') as ModelId) ?? 'A';
  const levels = (arg('levels', '0.4,0.5,0.6,0.7,0.8,0.9,1') ?? '').split(',').map(Number);
  const target = Number(arg('target', '0.95'));
  const def = SCENARIOS.find((s) => s.id === baseId) ?? STRATEGIES.find((s) => s.id === baseId);
  if (!def) throw new Error(`unknown base ${baseId}`);
  const base: SimConfig = def.build(BAILEY_HALL);
  const planFile = arg('plan');
  if (planFile) {
    const p = JSON.parse(readFileSync(planFile, 'utf8')).plan;
    base.crowdManagers.plan = { ...p };
    if (base.led.enabled) base.led.plan = { ...p };
    if (process.argv.includes('--preassign')) base.preassign = { ...base.preassign, enabled: true, plan: { ...p } };
  }
  const seeds = batchSeeds(Number(arg('seed', '777')), runs);
  const pool = new SimPool();
  const rows: { occ: number; N: number; cms: number; mean: number; ciLow: number; ciHigh: number; p: number; pLo: number; pHi: number; inside180: number; p95: number }[] = [];
  for (const occ of levels) {
    const cfg: SimConfig = structuredClone(base);
    cfg.occupancy = { ...cfg.occupancy, orchestra: occ, mezzanine: occ, balcony: occ };
    if (arg('cm', 'auto') === 'auto') cfg.crowdManagers.count = -1;
    cfg.label = `${base.label} @ ${(occ * 100).toFixed(0)}%`;
    const res = await pool.run(cfg, seeds, model);
    const T = summarize(res.map((r) => r.tEvac));
    const k = res.filter((r) => Number.isFinite(r.tEvac) && r.tEvac <= 180).length;
    const w = wilson(k, res.length);
    const N = res[0].N;
    rows.push({ occ, N, cms: cfg.crowdManagers.count < 0 ? Math.ceil(N / 250) : cfg.crowdManagers.count, mean: T.mean, ciLow: T.ciLow, ciHigh: T.ciHigh, p: w.p, pLo: w.lo, pHi: w.hi, inside180: res.reduce((s, r) => s + (r.insideAt180 ?? 0), 0) / res.length, p95: T.p95 });
    const r = rows[rows.length - 1];
    console.log(`occ ${(occ * 100).toFixed(0).padStart(3)}%  N ${String(N).padStart(4)}  CMs ${r.cms}  T ${r.mean.toFixed(1)} [${r.ciLow.toFixed(1)}, ${r.ciHigh.toFixed(1)}]  p95 ${r.p95.toFixed(0)}  P(T<=180) ${(r.p * 100).toFixed(0)}% [${(r.pLo * 100).toFixed(0)}, ${(r.pHi * 100).toFixed(0)}]  inside@180 ${r.inside180.toFixed(1)}`);
  }
  await pool.close();
  // largest occupancy meeting the target probability (interpolated between bracketing levels)
  let nMax = NaN;
  const sorted = [...rows].sort((a, b) => a.N - b.N);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].p >= target) nMax = sorted[i].N;
    else {
      if (i > 0 && sorted[i - 1].p >= target) {
        const a = sorted[i - 1];
        const b = sorted[i];
        nMax = Math.round(a.N + ((a.p - target) / Math.max(1e-9, a.p - b.p)) * (b.N - a.N));
      }
      break;
    }
  }
  // slope of T(N) above the knee (persons per second of extra time ~ effective capacity)
  const top = sorted.slice(-3);
  const slope = top.length >= 2 ? (top[top.length - 1].mean - top[0].mean) / (top[top.length - 1].N - top[0].N) : NaN;
  console.log(`largest audience with P(T<=180) >= ${(target * 100).toFixed(0)}%: ${Number.isFinite(nMax) ? nMax : 'none of the tested levels'}`);
  console.log(`slope of T(N) over the top levels: ${(slope * 100).toFixed(2)} s per 100 persons (effective capacity ${(1 / slope).toFixed(1)} p/s)`);
  const out = arg('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ base: baseId, model, planFile, runs, seeds, target, rows, nMax, slope }, null, 1));
    console.log(`written ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
