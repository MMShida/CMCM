/**
 * Experiments: previous fixed model vs dynamic individuals / adaptive Crowd Managers / both,
 * manager placements, blocked exits, congestion-information levels and compliance.
 * Paired seeds (same audiences in every configuration), Models A and B.
 *
 *   npx tsx scripts/adaptive-experiments.ts [--runs 40] [--seed 777] [--models A,B] [--only key1,key2]
 *
 * Writes results/adaptive/experiments.json and docs/ADAPTIVE_RESULTS.md (generated tables).
 * Nothing older is overwritten (results/adaptive/ is new).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { batchSeeds, quantileSorted, summarize, wilson } from '../src/simulation/MonteCarlo';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import type { PlacementId, SimConfig } from '../src/simulation/Params';
import { PLACEMENT_LABEL } from '../src/simulation/Placements';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimPool } from './pool';

const arg = (n: string, d: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const RUNS = Number(arg('runs', '40'));
const SEEDS = batchSeeds(Number(arg('seed', '777')), RUNS);
const MODELS = arg('models', 'A,B').split(',') as ('A' | 'B')[];
const ONLY = arg('only', '');

interface Exp {
  key: string;
  group: string;
  label: string;
  /** key of the paired reference configuration */
  ref?: string;
  build: () => SimConfig;
}

const mk = (scenario: string, f: (c: SimConfig) => void = () => {}) => () => {
  const c = scenarioById(scenario);
  f(c);
  return c;
};
const AG = (c: SimConfig) => (c.adaptive.agents = true);
const MG = (c: SimConfig) => (c.adaptive.managers = true);
const BOTH = (c: SimConfig) => {
  AG(c);
  MG(c);
};

const EXPS: Exp[] = [
  // 1-4: fixed vs dynamic
  { key: 'fixed', group: 'Policies', label: '1. Previous fixed behavioural model', build: mk('concert-emergency') },
  { key: 'agents', group: 'Policies', label: '2. Dynamic individuals only', ref: 'fixed', build: mk('concert-emergency', AG) },
  { key: 'managers', group: 'Policies', label: '3. Adaptive Crowd Managers only', ref: 'fixed', build: mk('concert-emergency', MG) },
  { key: 'both', group: 'Policies', label: '4. Both adaptive', ref: 'fixed', build: mk('concert-emergency', BOTH) },
  // 5: placements (both adaptive; paired against the existing posts)
  ...(['decision', 'bottleneck', 'hybrid222', 'robust'] as PlacementId[]).map((p) => ({
    key: `place-${p}`,
    group: 'Placements (both adaptive)',
    label: PLACEMENT_LABEL[p],
    ref: 'both',
    build: mk('concert-emergency', (c) => {
      BOTH(c);
      c.crowdManagers.placement = p;
    }),
  })),
  // diagnostic: adaptive instruction mechanics without any redirection (separates the policy from the voice rules)
  {
    key: 'place-decision-noredirect',
    group: 'Placements (both adaptive)',
    label: 'Decision points, adaptive but never redirecting (diagnostic)',
    ref: 'place-decision',
    build: mk('concert-emergency', (c) => {
      BOTH(c);
      c.crowdManagers.placement = 'decision';
      c.adaptive.switchThreshold = 1e9;
    }),
  },
  // placements with the previous fixed model (does the layout matter without adaptation?)
  ...(['decision', 'bottleneck', 'hybrid222', 'robust'] as PlacementId[]).map((p) => ({
    key: `fixed-place-${p}`,
    group: 'Placements (fixed model)',
    label: `${PLACEMENT_LABEL[p]} (fixed)`,
    ref: 'fixed',
    build: mk('concert-emergency', (c) => (c.crowdManagers.placement = p)),
  })),
  // 6: blocked exits
  { key: 'blk-fc2-fixed', group: 'Blocked exits', label: 'FC2 blocked (discovered), fixed', build: mk('blocked-discovery') },
  { key: 'blk-fc2-both', group: 'Blocked exits', label: 'FC2 blocked (discovered), both adaptive', ref: 'blk-fc2-fixed', build: mk('blocked-discovery', BOTH) },
  { key: 'blk-foyer-fixed', group: 'Blocked exits', label: 'Foyer blocked (FC1-3, announced 30 s), fixed', build: mk('blocked-foyer') },
  { key: 'blk-foyer-both', group: 'Blocked exits', label: 'Foyer blocked, both adaptive', ref: 'blk-foyer-fixed', build: mk('blocked-foyer', BOTH) },
  {
    key: 'blk-foyer-robust',
    group: 'Blocked exits',
    label: 'Foyer blocked, both adaptive, robust placement',
    ref: 'blk-foyer-both',
    build: mk('blocked-foyer', (c) => {
      BOTH(c);
      c.crowdManagers.placement = 'robust';
    }),
  },
  // 7: congestion information (both adaptive)
  { key: 'info-none', group: 'Congestion information (both adaptive)', label: 'No queue information', ref: 'both', build: mk('concert-emergency', (c) => (BOTH(c), (c.adaptive.congestionInfo = 'none'))) },
  { key: 'info-noshare', group: 'Congestion information (both adaptive)', label: 'Own sight only (managers do not share congestion)', ref: 'both', build: mk('concert-emergency', (c) => (BOTH(c), (c.adaptive.shareCongestion = false))) },
  { key: 'info-noradio', group: 'Congestion information (both adaptive)', label: 'No radio between managers', ref: 'both', build: mk('concert-emergency', (c) => (BOTH(c), (c.adaptive.comm = 'none'))) },
  { key: 'info-global', group: 'Congestion information (both adaptive)', label: 'Idealised: every queue visible to everyone', ref: 'both', build: mk('concert-emergency', (c) => (BOTH(c), (c.adaptive.congestionInfo = 'global'))) },
  // 8: compliance
  ...[0.5, 0.95].flatMap((p) => [
    { key: `comp${p}-fixed`, group: 'Compliance', label: `Compliance ${p}, fixed`, ref: 'fixed', build: mk('concert-emergency', (c) => (c.crowdManagers.complianceProb = p)) },
    { key: `comp${p}-both`, group: 'Compliance', label: `Compliance ${p}, both adaptive`, ref: `comp${p}-fixed`, build: mk('concert-emergency', (c) => (BOTH(c), (c.crowdManagers.complianceProb = p))) },
  ]),
  // the 180 s package from the previous round, with and without adaptation
  { key: 'pkg-fixed', group: '180 s package', label: '180 s package, fixed', build: mk('package-180') },
  { key: 'pkg-both', group: '180 s package', label: '180 s package, both adaptive', ref: 'pkg-fixed', build: mk('package-180', BOTH) },
];

const KEY_REGIONS = ['orchCentralAisles', 'orchAccess', 'mezzExits', 'corrSouth', 'foyer', 'portico', 'balStairs'];

function stats(runs: RunSummary[]) {
  const T = runs.map((r) => r.tEvac).filter(Number.isFinite);
  const s = summarize(T);
  const sorted = [...T].sort((a, b) => a - b);
  const w = wilson(runs.filter((r) => r.tEvac <= 180).length, runs.length);
  const mean = (f: (r: RunSummary) => number) => {
    const v = runs.map(f).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  const d0 = runs[0].density!;
  const ri = (id: string) => d0.regions.findIndex((x) => x.id === id);
  const k2 = d0.thresholds.indexOf(d0.ref);
  const usage: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.exitGroupUsage)) usage[k] = (usage[k] ?? 0) + v / runs.length;
  const mgr = runs[0].managers ?? [];
  return {
    n: runs.length,
    T: { mean: s.mean, ciLow: s.ciLow, ciHigh: s.ciHigh, sd: s.sd, p95: quantileSorted(sorted, 0.95), min: sorted[0], max: sorted[sorted.length - 1] },
    p180: w,
    meanExit: mean((r) => r.meanExit),
    insideAt180: mean((r) => r.insideAt180 ?? NaN),
    unresolved: mean((r) => r.unresolvedInside + r.trapped),
    regions: Object.fromEntries(
      KEY_REGIONS.map((id) => [
        id,
        { peak: mean((r) => r.density!.peak[ri(id)]), timeAboveRef: mean((r) => (k2 >= 0 ? r.density!.timeAbove[k2][ri(id)] : NaN)), peakOcc: mean((r) => r.density!.peakOcc[ri(id)]) },
      ]),
    ),
    personTimeAboveRef: mean((r) => r.density!.personTimeAbove),
    exposure: { mean: mean((r) => r.density!.exposure.mean), p95: mean((r) => r.density!.exposure.p95), shareExposed: mean((r) => r.density!.exposure.shareExposed) },
    usage,
    behaviour: {
      exitSwitches: mean((r) => r.behaviour!.exitSwitches),
      events: mean((r) => r.behaviour!.events),
      flipFlops: mean((r) => r.behaviour!.flipFlops),
      conflicts: mean((r) => r.behaviour!.conflicts),
      managerSwitches: mean((r) => r.behaviour!.managerSwitches),
      complied: mean((r) => r.behaviour!.complied),
      followedShare: mean((r) => r.behaviour!.followedShare),
      meanTrust: mean((r) => r.behaviour!.meanTrust),
    },
    managers: mgr.map((m, i) => ({
      id: m.id,
      maxR: mean((r) => r.managers![i].maxR),
      maxH: mean((r) => r.managers![i].maxH),
      meanH: mean((r) => r.managers![i].meanH),
      maxI: mean((r) => r.managers![i].maxI),
      reached: mean((r) => r.managers![i].uniqueReached),
      complied: mean((r) => r.managers![i].complied),
      changed: mean((r) => r.managers![i].changed),
      switches: mean((r) => r.managers![i].switches),
      overload: mean((r) => r.managers![i].overloadTime),
      maxW: mean((r) => r.managers![i].maxW),
      throughWall: mean((r) => r.managers![i].throughWall),
      conflicts: mean((r) => r.managers![i].conflicts),
    })),
  };
}

function paired(a: RunSummary[], b: RunSummary[]) {
  const by = new Map(a.map((r) => [r.seed, r.tEvac]));
  const d = b.filter((r) => by.has(r.seed)).map((r) => r.tEvac - by.get(r.seed)!).filter(Number.isFinite);
  const s = summarize(d);
  return { meanDiff: s.mean, ciLow: s.ciLow, ciHigh: s.ciHigh, worseShare: d.filter((x) => x > 0).length / Math.max(1, d.length) };
}

async function main() {
  const pool = new SimPool();
  const runsBy = new Map<string, RunSummary[]>();
  const out: Record<string, unknown> = {};
  const t0 = Date.now();
  const exps = ONLY ? EXPS.filter((e) => ONLY.split(',').includes(e.key) || ONLY.split(',').includes(e.ref ?? '')) : EXPS;
  // references first
  const ordered = [...exps].sort((x, y) => (x.ref ? 1 : 0) - (y.ref ? 1 : 0));
  for (const model of MODELS)
    for (const e of ordered) {
      if (e.ref && !runsBy.has(`${model}|${e.ref}`) && !exps.some((x) => x.key === e.ref)) {
        const ref = EXPS.find((x) => x.key === e.ref)!;
        runsBy.set(`${model}|${ref.key}`, await pool.run(ref.build(), SEEDS, model));
      }
      const runs = await pool.run(e.build(), SEEDS, model);
      runsBy.set(`${model}|${e.key}`, runs);
      const st = stats(runs);
      const pr = e.ref ? paired(runsBy.get(`${model}|${e.ref}`)!, runs) : null;
      out[`${model}|${e.key}`] = { model, key: e.key, group: e.group, label: e.label, ref: e.ref ?? null, ...st, pairedVsRef: pr };
      console.log(
        `${model} ${e.key.padEnd(22)} T ${st.T.mean.toFixed(1)} [${st.T.ciLow.toFixed(1)}, ${st.T.ciHigh.toFixed(1)}] p95 ${st.T.p95.toFixed(0)} P180 ${(st.p180.p * 100).toFixed(0)}%` +
          `  CA peak ${st.regions.orchCentralAisles.peak.toFixed(2)} foyer ${st.regions.foyer.peak.toFixed(2)} expo ${st.exposure.mean.toFixed(1)} sw ${st.behaviour.exitSwitches.toFixed(0)} mgrSw ${st.behaviour.managerSwitches.toFixed(1)}` +
          (pr ? `  vs ${e.ref}: ${pr.meanDiff >= 0 ? '+' : ''}${pr.meanDiff.toFixed(1)} [${pr.ciLow.toFixed(1)}, ${pr.ciHigh.toFixed(1)}] worse in ${(pr.worseShare * 100).toFixed(0)}%` : '') +
          `  (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
      );
    }
  await pool.close();
  mkdirSync('results/adaptive', { recursive: true });
  const file = ONLY ? `results/adaptive/experiments-${ONLY.replace(/[^a-z0-9,-]/gi, '').slice(0, 40)}.json` : 'results/adaptive/experiments.json';
  writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), runs: RUNS, seeds: SEEDS, models: MODELS, results: out }, null, 1));
  console.log('written', file);
  if (!ONLY) writeFileSync('docs/ADAPTIVE_RESULTS.md', markdown(out));
}

function markdown(out: Record<string, any>): string {
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
  const lines: string[] = [
    '# Adaptive behaviour experiments (generated)',
    '',
    `Generated by \`scripts/adaptive-experiments.ts\` on ${new Date().toISOString().slice(0, 10)}: ${RUNS} paired runs per configuration (seeds ${SEEDS[0]}...), Models A and B. ` +
      'T = time the last person leaves the building. "vs ref" = paired difference against the reference configuration on the same audiences (95 % CI); "worse" = share of seeds where the configuration is slower. ' +
      'Densities are region averages (persons/m^2) on the regions of `src/simulation/DensityRegions.ts`; "time > 2" = seconds with region density above the analytical reference 2 p/m^2 (not a safety limit). ' +
      'Exposure = individual int max(0, rho - 2) dt (p s/m^2), Model A with the local 2 m window, Model B with the edge density.',
    '',
  ];
  for (const model of MODELS) {
    lines.push(`## Model ${model}`, '');
    let group = '';
    for (const r of Object.values(out).filter((x: any) => x.model === model) as any[]) {
      if (r.group !== group) {
        group = r.group;
        lines.push('', `### ${group}`, '', '| Configuration | Mean T (s) [95 % CI] | p95 T | P(T <= 180) | vs ref (s) [CI], worse | Central aisles peak / time > 2 | Foyer peak | Person-s > 2 | Exposure mean / p95 | Exit switches | Mgr switches | Followed CM |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
      }
      const pr = r.pairedVsRef;
      lines.push(
        `| ${r.label} | ${f(r.T.mean)} [${f(r.T.ciLow)}, ${f(r.T.ciHigh)}] | ${f(r.T.p95, 0)} | ${f(r.p180.p * 100, 0)} % | ${pr ? `${pr.meanDiff >= 0 ? '+' : ''}${f(pr.meanDiff)} [${f(pr.ciLow)}, ${f(pr.ciHigh)}], ${f(pr.worseShare * 100, 0)} %` : 'reference'} | ${f(r.regions.orchCentralAisles.peak, 2)} / ${f(r.regions.orchCentralAisles.timeAboveRef, 0)} s | ${f(r.regions.foyer.peak, 2)} | ${f(r.personTimeAboveRef, 0)} | ${f(r.exposure.mean)} / ${f(r.exposure.p95)} | ${f(r.behaviour.exitSwitches, 0)} | ${f(r.behaviour.managerSwitches, 1)} | ${f(r.behaviour.followedShare * 100, 0)} % |`,
      );
    }
    lines.push('', `#### Exit utilisation (mean persons per exit group), Model ${model}`, '', '| Configuration | ' + ['FOYER', 'PORTICO_W', 'PORTICO_E', 'STAGE_W', 'STAGE_E', 'BAL_NW', 'BAL_NE'].join(' | ') + ' |', '|---|---|---|---|---|---|---|---|');
    for (const r of Object.values(out).filter((x: any) => x.model === model) as any[])
      lines.push(`| ${r.label} | ${['FOYER', 'PORTICO_W', 'PORTICO_E', 'STAGE_W', 'STAGE_E', 'BAL_NW', 'BAL_NE'].map((k) => f(r.usage[k] ?? 0, 0)).join(' | ')} |`);
    lines.push('', `#### Crowd Manager workload, Model ${model} (mean over runs)`, '', '| Configuration | Manager | max R | max H | mean H | reached | complied | changed route | switches | overload (s) | max W | conflicts | reach through walls (previous rule) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of Object.values(out).filter((x: any) => x.model === model && ['fixed', 'both', 'place-decision', 'place-bottleneck', 'place-hybrid222', 'place-robust'].includes(x.key)) as any[])
      for (const m of r.managers)
        lines.push(`| ${r.label} | ${m.id} | ${f(m.maxR, 0)} | ${f(m.maxH, 0)} | ${f(m.meanH, 0)} | ${f(m.reached, 0)} | ${f(m.complied, 0)} | ${f(m.changed, 1)} | ${f(m.switches, 1)} | ${f(m.overload, 0)} | ${f(m.maxW, 2)} | ${f(m.conflicts, 1)} | ${f(m.throughWall, 0)} |`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
