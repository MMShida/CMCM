/** Paired effects of interventions relative to S1 (Crowd Managers only), from the comparison cache. */
import { readFileSync } from 'node:fs';
import { interventionEffect } from '../src/compare/Comparison';
const runs = process.argv[2] ?? '30';
const load = (id: string) => JSON.parse(readFileSync(`results/comparison/cache/${id}-r${runs}-s2026-AB.json`, 'utf8')).records;
const ref = load('S1');
for (const id of ['S2', 'S3', 'S4', 'S5']) {
  const alt = load(id);
  for (const m of ['A', 'B'] as const) {
    const t = interventionEffect(ref, alt, m);
    const p = interventionEffect(ref, alt, m, (r) => r.p95Exit);
    const q = interventionEffect(ref, alt, m, (r) => r.meanQueueTime);
    const e = interventionEffect(ref, alt, m, (r) => r.highDensityExposure);
    const f = (s: any) => `${s.mean.toFixed(1)} [${s.ciLow.toFixed(1)}, ${s.ciHigh.toFixed(1)}]${s.ciLow > 0 || s.ciHigh < 0 ? ' *' : ''}`;
    console.log(`${id} vs S1, model ${m}: dT ${f(t)} | dp95exit ${f(p)} | dqueue ${f(q)} | dexposure ${f(e)}`);
  }
}
