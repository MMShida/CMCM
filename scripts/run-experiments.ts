/**
 * Reproducible experiment suite. Writes results/experiments/*.json|csv and docs/RESULTS.md.
 *
 *   npm run experiments -- [--runs 40] [--seed 2026] [--workers 8] [--only A,B,...] [--force]
 *
 * A scenarios, B strategy comparison (paired), C occupancy curve, D sensitivity,
 * E flow bounds, F barrier positions, G Crowd Manager count.
 * Each experiment is cached in results/experiments/<id>.json (use --force to recompute).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BAILEY_HALL, slotId } from '../src/geometry/BaileyHall';
import { EXIT_GROUPS } from '../src/geometry/types';
import type { BatchStats, RunSummary } from '../src/simulation/MonteCarlo';
import { PERTURBATIONS, batchSeeds, batchStats, pairedComparison, perturbed } from '../src/simulation/MonteCarlo';
import type { SimConfig } from '../src/simulation/Params';
import { cloneConfig, mergeConfig } from '../src/simulation/Params';
import { maxFlowBound } from '../src/simulation/QueueModel';
import { SCENARIOS, STRATEGIES, scenarioById } from '../src/simulation/Scenarios';
import { runsToCsv } from './csv';
import { runParallel } from './parallel';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const R = Number(arg('runs', '40'));
const SEED = Number(arg('seed', '2026'));
const WORKERS = arg('workers') ? Number(arg('workers')) : undefined;
const ONLY = arg('only')?.split(',');
const FORCE = process.argv.includes('--force');
const DIR = 'results/experiments';
mkdirSync(DIR, { recursive: true });
const geo = BAILEY_HALL;
const seeds = batchSeeds(SEED, R);
const half = seeds.slice(0, Math.max(10, Math.ceil(R / 2)));

interface Entry {
  key: string;
  label: string;
  runs: RunSummary[];
  stats: BatchStats;
}

async function batch(key: string, label: string, cfg: SimConfig, s: number[]): Promise<Entry> {
  const t0 = Date.now();
  const runs = await runParallel(cfg, s, WORKERS, (d, n) => process.stdout.write(`\r   ${label}: ${d}/${n}   `));
  process.stdout.write(`\r   ${label}: ${s.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s${' '.repeat(20)}\n`);
  return { key, label, runs, stats: batchStats(label, runs) };
}

async function experiment(id: string, title: string, fn: () => Promise<Entry[]>): Promise<Entry[] | null> {
  if (ONLY && !ONLY.some((o) => id.startsWith(o))) {
    const f = `${DIR}/${id}.json`;
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).entries : null;
  }
  const f = `${DIR}/${id}.json`;
  if (!FORCE && existsSync(f)) {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (d.R === R && d.seed === SEED) {
      console.log(`[${id}] ${title}: cached`);
      return d.entries;
    }
  }
  console.log(`[${id}] ${title}`);
  const entries = await fn();
  writeFileSync(f, JSON.stringify({ id, title, R, seed: SEED, entries: entries.map((e) => ({ ...e, runs: e.runs.map(({ inside, ...r }) => r) })) }));
  writeFileSync(`${DIR}/${id}.runs.csv`, entries.map((e) => runsToCsv(e.runs.map((r) => ({ ...r, label: e.label })))).join('\n'));
  // evacuation curves (mean persons inside per second)
  const curves = entries.map((e) => meanInside(e.runs));
  const len = Math.max(...curves.map((c) => c.length));
  const rows = [['t', ...entries.map((e) => JSON.stringify(e.label))].join(',')];
  for (let t = 0; t < len; t++) rows.push([t, ...curves.map((c) => (t < c.length ? c[t].toFixed(1) : '0'))].join(','));
  writeFileSync(`${DIR}/${id}.curves.csv`, rows.join('\n'));
  return entries;
}

function meanInside(runs: RunSummary[]): number[] {
  const len = Math.max(...runs.map((r) => r.inside?.length ?? 0));
  const out: number[] = [];
  for (let t = 0; t < len; t++) out.push(runs.reduce((a, r) => a + (t < r.inside.length ? r.inside[t] : r.inside[r.inside.length - 1] ?? 0), 0) / runs.length);
  return out;
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : 'n/a');
const pc = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : 'n/a');

function statsTable(entries: Entry[], ref?: Entry): string {
  const head = '| Configuration | N | Mean T (s) [95% CI] | Median | SD | p5-p95 | Mean T ambulatory (s) | P(T<=180 s) [95% CI] | Mean p95 indiv. exit | Peak density (p/m2) | Exposure >3.5 p/m2 (person-s) | Unresolved runs |' + (ref ? ' Paired dT vs ref [95% CI] |' : '');
  const sep = '|' + '---|'.repeat(ref ? 13 : 12);
  const rows = entries.map((e) => {
    const s = e.stats;
    let paired = '';
    if (ref) {
      if (e === ref) paired = ' (reference) |';
      else {
        const d = pairedComparison(ref.runs, e.runs).find((x) => x.metric === 'tEvac')!;
        paired = ` ${f1(d.meanDiff)} [${f1(d.ciLow)}, ${f1(d.ciHigh)}] |`;
      }
    }
    return `| ${e.label} | ${e.runs[0]?.N ?? ''} | ${f1(s.tEvac.mean)} [${f1(s.tEvac.ciLow)}, ${f1(s.tEvac.ciHigh)}] | ${f1(s.tEvac.median)} | ${f1(s.tEvac.sd)} | ${f0(s.tEvac.p5)}-${f0(s.tEvac.p95)} | ${f1(s.tEvacAmbulatory.mean)} | ${pc(s.pMeet.p)} [${pc(s.pMeet.lo)}, ${pc(s.pMeet.hi)}] | ${f1(s.p95Exit.mean)} | ${s.peakDensity.mean.toFixed(2)} | ${f0(s.exposure.mean)} | ${pc(s.fracUnresolved)} |${paired}`;
  });
  return [head, sep, ...rows].join('\n');
}

function usageTable(entries: Entry[]): string {
  const head = `| Configuration | ${EXIT_GROUPS.join(' | ')} | Imbalance (max/mean) |`;
  const sep = '|' + '---|'.repeat(EXIT_GROUPS.length + 2);
  return [head, sep, ...entries.map((e) => `| ${e.label} | ${EXIT_GROUPS.map((g) => f0(e.stats.meanUsage[g])).join(' | ')} | ${e.stats.imbalance.mean.toFixed(2)} |`)].join('\n');
}

async function main() {
  const t0 = Date.now();
  const md: string[] = [];
  md.push('# Example simulation results', '');
  md.push(`Generated by \`npm run experiments -- --runs ${R} --seed ${SEED}\` on ${new Date().toISOString().slice(0, 10)}.`);
  md.push(`Each configuration uses the same ${R} seeds (common random numbers) unless stated otherwise; sensitivity, occupancy, barrier and staffing sweeps use the first ${half.length}.`);
  md.push('All times are SIMULATED under the documented assumptions (docs/PARAMETERS.md); they are not calibrated predictions and do not prove regulatory compliance.', '');
  md.push('T = total evacuation time (last person leaves the building). Unfinished runs count as failing the 180 s benchmark. Raw data: `results/experiments/`.', '');

  // ---- E: flow bounds (instant) ----
  const cfg0 = scenarioById('concert-emergency');
  const fb = [
    ['Whole building, exterior doors', maxFlowBound(geo, cfg0, 1329, [], { sink: 'exterior' })],
    ['Whole building, street level', maxFlowBound(geo, cfg0, 1329, [], { sink: 'street' })],
    ['FC2 blocked, exterior doors', maxFlowBound(geo, cfg0, 1329, ['FC2'], { sink: 'exterior' })],
    ['Foyer blocked (FC1-3), exterior doors', maxFlowBound(geo, cfg0, 1329, ['FC1', 'FC2', 'FC3'], { sink: 'exterior' })],
    ['Orchestra only (527)', maxFlowBound(geo, cfg0, 527, [], { sink: 'exterior', level: 'orchestra' })],
    ['Mezzanine/loge only (486)', maxFlowBound(geo, cfg0, 486, [], { sink: 'exterior', level: 'mezzanine' })],
    ['Balcony only (316)', maxFlowBound(geo, cfg0, 316, [], { sink: 'exterior', level: 'balcony' })],
  ] as const;
  md.push('## E. Network-flow bounds (independent cross-check)', '');
  md.push('Maximum flow F* through the capacitated network (gates at their capacities, other links lanes x 0.94 p/s, storey stairs downward only). N/F* is a hard lower bound on the pure flow time, before adding pre-movement and walking time.', '');
  md.push('| Case | F* (p/s) | N/F* (s) | Minimum cut (bottleneck links) |', '|---|---|---|---|');
  for (const [name, b] of fb) md.push(`| ${name} | ${b.maxFlow.toFixed(2)} | ${b.flowTime.toFixed(1)} | ${b.cut.map((c) => c.label).join(', ')} |`);
  md.push('');
  writeFileSync(`${DIR}/E_flow_bounds.json`, JSON.stringify(fb.map(([n, b]) => ({ case: n, ...b })), null, 1));

  // ---- A: scenarios ----
  const scenIds = ['concert-departure', 'concert-emergency', 'no-guidance', 'blocked-discovery', 'blocked-announced', 'blocked-immediate', 'lecture', 'barriers', 'led', 'led-barriers', 'led-conflict', 'cm-missing', 'older', 'younger', 'winter', 'darkness', 'smoke', 'fire-stage', 'blocked-foyer', 'falls', 'reunite', 'competitive', 'uneven'];
  const A = await experiment('A_scenarios', 'All scenarios', async () => {
    const out: Entry[] = [];
    for (const id of scenIds) {
      const def = SCENARIOS.find((s) => s.id === id)!;
      out.push(await batch(id, def.name + (def.approximate ? ' *' : ''), def.build(geo), seeds));
    }
    return out;
  });
  if (A) {
    const ref = A.find((e) => e.key === 'concert-emergency');
    md.push('## A. Scenarios', '', '`*` = simplified stress test (not a validated physical mechanism). Paired differences are relative to the concert emergency baseline.', '');
    md.push(statsTable(A, ref), '');
    md.push('### Exit-group usage (mean persons per run)', '', usageTable(A), '');
  }

  // ---- B: strategies ----
  const B = await experiment('B_strategies', 'Strategy comparison (paired seeds)', async () => {
    const out: Entry[] = [];
    for (const s of STRATEGIES) out.push(await batch(s.id, s.name, s.build(geo), seeds));
    return out;
  });
  if (B) {
    const ref = B.find((e) => e.key === 'S1')!;
    md.push('## B. Strategy comparison (common random numbers, reference S1 = Crowd Managers only)', '');
    md.push(statsTable(B, ref), '');
    md.push('### Paired differences vs S1 (negative = better)', '');
    md.push('| Strategy | dT mean [95% CI] | d p95 indiv. exit | d peak density | d exposure | d imbalance | Seeds where faster |', '|---|---|---|---|---|---|---|');
    for (const e of B) {
      if (e === ref) continue;
      const d = Object.fromEntries(pairedComparison(ref.runs, e.runs).map((x) => [x.metric, x]));
      const c = (x: any, k = 1) => `${x.meanDiff.toFixed(k)} [${x.ciLow.toFixed(k)}, ${x.ciHigh.toFixed(k)}]`;
      md.push(`| ${e.label} | ${c(d.tEvac)} | ${c(d.p95Exit)} | ${c(d.peakDensity, 2)} | ${c(d.highDensityExposure, 0)} | ${c(d.exitImbalance, 2)} | ${pc(d.tEvac.fracBBetter)} |`);
    }
    md.push('', '### Exit-group usage', '', usageTable(B), '');
  }

  // ---- C: occupancy ----
  const C = await experiment('C_occupancy', 'Occupancy curve T(N)', async () => {
    const out: Entry[] = [];
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
      const c = mergeConfig(scenarioById('concert-emergency'), { occupancy: { orchestra: f, mezzanine: f, balcony: f }, crowdManagers: { count: -1 } });
      c.label = `${Math.round(f * 100)}% occupancy (CM = ceil(N/250))`;
      out.push(await batch(`occ${f}`, c.label, c, half));
    }
    return out;
  });
  if (C) {
    md.push('## C. Occupancy curve T(N)', '', 'Crowd Managers follow the legal minimum ceil(N/250). The slope of T(N) after the knee reflects the capacity of the binding cut (see E).', '');
    md.push(statsTable(C), '');
  }

  // ---- D: sensitivity ----
  const D = await experiment('D_sensitivity', 'One-at-a-time sensitivity (baseline)', async () => {
    const base = scenarioById('concert-emergency');
    const out: Entry[] = [await batch('base', 'Baseline', base, half)];
    for (const p of PERTURBATIONS.filter((x) => x.key !== 'ledCompliance')) {
      out.push(await batch(`${p.key}-low`, `${p.label} = ${p.low}${p.unit === 'x' ? 'x' : ` ${p.unit}`}`, perturbed(base, p, p.low), half));
      out.push(await batch(`${p.key}-high`, `${p.label} = ${p.high}${p.unit === 'x' ? 'x' : ` ${p.unit}`}`, perturbed(base, p, p.high), half));
    }
    // LED compliance sweep on the LED scenario
    for (const v of [0.3, 0.5, 0.7, 0.9]) {
      const c = cloneConfig(scenarioById('led'));
      c.led.complianceProb = v;
      c.label = `LED scenario, LED compliance = ${v}`;
      out.push(await batch(`led-comp-${v}`, c.label, c, half));
    }
    return out;
  });
  if (D) {
    const base = D[0];
    md.push('## D. Sensitivity analysis (one at a time, concert emergency baseline)', '');
    md.push('| Parameter | Low value: mean T | High value: mean T | Swing (s) | P180 low / high |', '|---|---|---|---|---|');
    const rows: [string, Entry, Entry][] = [];
    for (const p of PERTURBATIONS.filter((x) => x.key !== 'ledCompliance')) {
      const lo = D.find((e) => e.key === `${p.key}-low`);
      const hi = D.find((e) => e.key === `${p.key}-high`);
      if (lo && hi) rows.push([`${p.label} (${p.low} / ${p.high} ${p.unit})`, lo, hi]);
    }
    rows.sort((a, b) => Math.abs(b[2].stats.tEvac.mean - b[1].stats.tEvac.mean) - Math.abs(a[2].stats.tEvac.mean - a[1].stats.tEvac.mean));
    for (const [name, lo, hi] of rows) md.push(`| ${name} | ${f1(lo.stats.tEvac.mean)} | ${f1(hi.stats.tEvac.mean)} | ${f1(Math.abs(hi.stats.tEvac.mean - lo.stats.tEvac.mean))} | ${pc(lo.stats.pMeet.p)} / ${pc(hi.stats.pMeet.p)} |`);
    md.push('', `Baseline (same seeds): mean T = ${f1(base.stats.tEvac.mean)} s.`, '');
    md.push('LED compliance sweep (LED scenario):', '', statsTable(D.filter((e) => e.key.startsWith('led-comp'))), '');
  }

  // ---- F: barrier positions ----
  const F = await experiment('F_barriers', 'Barrier position sensitivity', async () => {
    const out: Entry[] = [];
    const sets: [string, string[]][] = [
      ['No barriers (CM only)', []],
      ['W0+E0 (between D1/P1 and D2)', ['W0', 'E0']],
      ['W1+E1 (between P2 and D3)', ['W1', 'E1']],
      ['W2+E2 (between D3 and D4)', ['W2', 'E2']],
      ['W1+E1+W2+E2', ['W1', 'E1', 'W2', 'E2']],
    ];
    for (const [name, slots] of sets) {
      const c = cloneConfig(scenarioById('concert-emergency'));
      c.barriers = slots.map((s) => slotId(geo, s));
      c.label = `Barriers: ${name}`;
      out.push(await batch(`bar-${slots.join('')}`, c.label, c, half));
    }
    return out;
  });
  if (F) {
    md.push('## F. Corridor barrier positions (Crowd Managers present)', '');
    md.push(statsTable(F, F[0]), '', usageTable(F), '');
  }

  // ---- G: Crowd Manager count ----
  const G = await experiment('G_crowd_managers', 'Number of Crowd Managers', async () => {
    const out: Entry[] = [];
    for (const n of [0, 2, 4, 6, 8, 10]) {
      const c = mergeConfig(scenarioById('concert-emergency'), { crowdManagers: { count: n } });
      c.label = `${n} Crowd Managers`;
      out.push(await batch(`cm${n}`, c.label, c, half));
    }
    for (const n of [6, 10]) {
      const c = mergeConfig(scenarioById('led'), { crowdManagers: { count: n } });
      c.label = `${n} Crowd Managers + LED`;
      out.push(await batch(`cm${n}led`, c.label, c, half));
    }
    return out;
  });
  if (G) {
    md.push('## G. Staffing: number of Crowd Managers (for the cost-effectiveness question)', '');
    md.push(statsTable(G, G.find((e) => e.key === 'cm6')), '');
  }

  md.push(`_Total wall time of this generation: ${((Date.now() - t0) / 60000).toFixed(1)} min._`, '');
  writeFileSync('docs/RESULTS.md', md.join('\n'));
  console.log(`docs/RESULTS.md written (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
