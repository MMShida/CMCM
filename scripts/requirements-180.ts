/**
 * What does it take to empty Bailey Hall in 180 s? A ladder of operational and physical changes
 * evaluated with Model A on the same seeds (paired), from the baseline to hypothetical geometry.
 *
 *   npx tsx scripts/requirements-180.ts --runs 40 [--seed 777] [--out results/requirements-180.json] [--only id1,id2]
 *
 * Each case = scenario + parameter overrides + optional geometry patch (link widths / lanes).
 * Geometry cases are HYPOTHETICAL (what the building would need), not claims about Bailey Hall.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import { batchSeeds, pairedComparison, summarize, wilson } from '../src/simulation/MonteCarlo';
import type { DeepPartial, SimConfig } from '../src/simulation/Params';
import { mergeConfig } from '../src/simulation/Params';
import { scenarioById } from '../src/simulation/Scenarios';
import type { GeoPatch } from './pool';
import { SimPool } from './pool';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const aisleIds = BAILEY_HALL.links.filter((l) => /^A[WE]_L\d+$/.test(l.id)).map((l) => l.id);
const accessIds = BAILEY_HALL.links.filter((l) => /^OST_/.test(l.id)).map((l) => l.id);
const patch = (ids: string[], o: { width?: number; lanes?: number }): GeoPatch => Object.fromEntries(ids.map((id) => [id, o]));
const fastStart: DeepPartial<SimConfig> = { premovement: { recognitionMedian: 3, responseMedian: 7 }, crowdManagers: { activationMedian: 3 } };
const perfect: DeepPartial<SimConfig> = { crowdManagers: { complianceProb: 1 }, preassign: { reachProb: 1, complianceProb: 1 } };

interface Case {
  id: string;
  label: string;
  scenario: string;
  set?: DeepPartial<SimConfig>;
  geo?: GeoPatch;
  hypothetical?: boolean;
}

const CASES: Case[] = [
  { id: 'base', label: 'Baseline (6 CMs, zone plan)', scenario: 'concert-emergency' },
  { id: 'opt', label: 'Optimised seat-block plan', scenario: 'optimised-plan' },
  { id: 'pre', label: '+ pre-assigned exits', scenario: 'preassigned' },
  { id: 'pkg', label: '180 s operations package', scenario: 'package-180' },
  { id: 'pkg_perfect', label: 'package, everyone informed and compliant', scenario: 'package-180', set: perfect },
  { id: 'pkg_fast', label: 'package + fast start (rec 3 s, resp 7 s, CM 3 s)', scenario: 'package-180', set: fastStart },
  { id: 'pkg_stair13', label: 'package + stair flow 1.3 p/(s m)', scenario: 'package-180', set: { movement: { stairFlow: 1.3 } } },
  { id: 'pkg_access16', label: 'package + access stairs 1.6 m (H)', scenario: 'package-180', geo: patch(accessIds, { width: 1.6 }), hypothetical: true },
  { id: 'pkg_aisle3', label: 'package + centre aisles 3 lanes (~1.7 m) (H)', scenario: 'package-180', geo: patch(aisleIds, { lanes: 3, width: 1.7 }), hypothetical: true },
  { id: 'pkg_both', label: 'package + access 1.6 m + aisles 1.7 m (H)', scenario: 'package-180', geo: { ...patch(accessIds, { width: 1.6 }), ...patch(aisleIds, { lanes: 3, width: 1.7 }) }, hypothetical: true },
  { id: 'pkg_both_fast', label: 'package + both geometry + fast start (H)', scenario: 'package-180', set: fastStart, geo: { ...patch(accessIds, { width: 1.6 }), ...patch(aisleIds, { lanes: 3, width: 1.7 }) }, hypothetical: true },
  {
    id: 'pkg_all',
    label: 'package + both geometry + fast start + perfect compliance (H)',
    scenario: 'package-180',
    set: mergeConfig(mergeConfig(scenarioById('package-180'), fastStart), perfect) as DeepPartial<SimConfig>,
    geo: { ...patch(accessIds, { width: 1.6 }), ...patch(aisleIds, { lanes: 3, width: 1.7 }) },
    hypothetical: true,
  },
];

async function main() {
  const runs = Number(arg('runs', '40'));
  const seeds = batchSeeds(Number(arg('seed', '777')), runs);
  const only = arg('only')?.split(',');
  const pool = new SimPool();
  const out: { id: string; label: string; hypothetical: boolean; mean: number; ciLow: number; ciHigh: number; sd: number; min: number; p: number; pLo: number; pHi: number; inside180: number; p95Exit: number; exposure: number }[] = [];
  let baseRuns: RunSummary[] | null = null;
  for (const c of CASES) {
    if (only && !only.includes(c.id)) continue;
    const cfg = c.set ? mergeConfig(scenarioById(c.scenario), c.set) : scenarioById(c.scenario);
    const res = await pool.run(cfg, seeds, 'A', c.geo);
    if (c.id === 'base') baseRuns = res;
    const T = summarize(res.map((r) => r.tEvac));
    const w = wilson(res.filter((r) => r.tEvac <= 180).length, res.length);
    const m = (f: (r: RunSummary) => number) => res.reduce((s, r) => s + f(r), 0) / res.length;
    const row = { id: c.id, label: c.label, hypothetical: !!c.hypothetical, mean: T.mean, ciLow: T.ciLow, ciHigh: T.ciHigh, sd: T.sd, min: T.min, p: w.p, pLo: w.lo, pHi: w.hi, inside180: m((r) => r.insideAt180 ?? NaN), p95Exit: m((r) => r.p95Exit), exposure: m((r) => r.highDensityExposure) };
    out.push(row);
    const d = baseRuns && c.id !== 'base' ? pairedComparison(baseRuns, res).find((x) => x.metric === 'tEvac') : null;
    console.log(
      `${c.id.padEnd(14)} T ${T.mean.toFixed(1)} [${T.ciLow.toFixed(1)}, ${T.ciHigh.toFixed(1)}] min ${T.min.toFixed(0)}  P(<=180) ${(w.p * 100).toFixed(0)}% [${(w.lo * 100).toFixed(0)}, ${(w.hi * 100).toFixed(0)}]  inside@180 ${row.inside180.toFixed(0)}  p95 ${row.p95Exit.toFixed(0)}${d ? `  vs base ${d.meanDiff.toFixed(1)} [${d.ciLow.toFixed(1)}, ${d.ciHigh.toFixed(1)}]` : ''}`,
    );
  }
  await pool.close();
  const file = arg('out');
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ runs, seeds, cases: CASES.map(({ set, ...c }) => c), results: out }, null, 1));
    console.log(`written ${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
