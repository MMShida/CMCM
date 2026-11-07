/** Markdown rendering of a ComparisonReport (docs/COMPARISON_RESULTS.md). */
import { EXIT_GROUPS } from '../geometry/types';
import type { Summary } from '../simulation/MonteCarlo';
import type { CellResult, ComparisonReport } from './Experiments';

const f = (x: number | undefined, d = 1) => (x !== undefined && Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const ci = (s?: Summary, d = 0) => (s && s.n ? `${f(s.mean, d)} [${f(s.ciLow, d)}, ${f(s.ciHigh, d)}]` : 'n/a');
const pm = (p?: { p: number; lo: number; hi: number }) => (p ? `${(p.p * 100).toFixed(0)}% [${(p.lo * 100).toFixed(0)}, ${(p.hi * 100).toFixed(0)}]` : 'n/a');
const sig = (s?: Summary) => (s && s.n > 1 && Number.isFinite(s.ciLow) ? (s.ciLow > 0 || s.ciHigh < 0 ? ' *' : '') : '');

function cellRow(c: CellResult): string {
  const A = c.stats.A;
  const B = c.stats.B;
  const C = c.stats.C;
  return `| ${c.name} | ${ci(A?.tEvac)} | ${ci(B?.tEvac)} | ${f(C?.imm.mean, 0)} / ${f(C?.pre.mean, 0)} | ${pm(A?.pMeet)} | ${pm(B?.pMeet)} | ${f(c.phys.maxFlow, 2)} | ${f(c.phys.tStarImm, 0)} |`;
}

export function reportMarkdown(r: ComparisonReport): string {
  const L: string[] = [];
  L.push('# Model comparison results (generated)');
  L.push('');
  L.push(`Generated ${r.generated} by \`npm run compare\` (${r.source}); ${r.runsPerCell} paired seeds per cell (base seed ${r.baseSeed}); models ${r.models.join(', ')}.`);
  L.push('A = detailed agent-based simulator, B = network behavioural simulator, C = ideal time-expanded network flow (benchmark).');
  L.push('Values are mean [95% CI]; P(T <= 180 s) with Wilson 95% interval; * = paired difference whose 95% CI excludes 0.');
  L.push('');
  for (const n of r.notes) L.push(`> ${n}`);
  L.push('');
  if (r.baseline) {
    const c = r.baseline;
    const A = c.stats.A;
    const B = c.stats.B;
    const C = c.stats.C;
    L.push(`## 1. Baseline: ${c.name} (${r.sectionRuns?.baseline ?? r.runsPerCell} paired seeds)`);
    L.push('');
    L.push('| Metric | Model A | Model B | Model C |');
    L.push('|---|---|---|---|');
    L.push(`| Evacuation time T (s) | ${ci(A?.tEvac, 1)} | ${ci(B?.tEvac, 1)} | T*: ${f(C?.imm.mean, 0)} (ready at 0), ${ci(C?.pre)} (sampled pre-movement) |`);
    L.push(`| Median / SD of T (s) | ${f(A?.tEvac.median)} / ${f(A?.tEvac.sd)} | ${f(B?.tEvac.median)} / ${f(B?.tEvac.sd)} | |`);
    L.push(`| 95th percentile of T across runs (s) | ${f(A?.tEvac.p95)} | ${f(B?.tEvac.p95)} | |`);
    L.push(`| P(T <= 180 s) | ${pm(A?.pMeet)} | ${pm(B?.pMeet)} | ${pm(C?.pMeetImm)} (t=0), ${pm(C?.pMeetPre)} (pre) |`);
    L.push(`| p95 individual exit time (s) | ${ci(A?.p95Exit)} | ${ci(B?.p95Exit)} | |`);
    L.push(`| Mean queue time per person (s) | ${ci(A?.meanQueueTime, 1)} | ${ci(B?.meanQueueTime, 1)} | |`);
    L.push(`| Largest queue (persons), most frequent location | ${f(A?.maxQueue.mean, 0)} (${A?.topBottleneck ?? ''}) | ${f(B?.maxQueue.mean, 0)} (${B?.topBottleneck ?? ''}) | |`);
    L.push(`| Unresolved runs | ${f((A?.fracUnresolved ?? NaN) * 100, 0)}% | ${f((B?.fracUnresolved ?? NaN) * 100, 0)}% | |`);
    L.push(`| Exit usage (mean persons) | ${EXIT_GROUPS.map((g) => `${g} ${f(A?.meanUsage[g], 0)}`).join(', ')} | ${EXIT_GROUPS.map((g) => `${g} ${f(B?.meanUsage[g], 0)}`).join(', ')} | ${EXIT_GROUPS.map((g) => `${g} ${f(c.phys.exitUsageImm[g] ?? 0, 0)}`).join(', ')} |`);
    L.push('');
    L.push(`Static max flow F* = ${f(c.phys.maxFlow, 2)} persons/s versus the ${f(c.phys.requiredRate, 2)} persons/s needed on average to evacuate ${Math.round(c.phys.requiredRate * 180)} people in 180 s; N/F* = ${f(c.phys.flowTime, 0)} s (a rate statement, not an evacuation time). Minimum cut: ${c.phys.cut.map((x) => `${x.label} (${f(x.capacity, 2)})`).join(', ')}.`);
    L.push('');
    L.push('### Paired decomposition (same seeds)');
    L.push('');
    L.push('| Difference | Mean [95% CI] (s) | n |');
    L.push('|---|---|---|');
    for (const d of c.stats.diffs) L.push(`| ${d.label} | ${ci(d, 1)}${sig(d)} | ${d.n} |`);
    L.push('');
  }
  if (r.interventions) {
    L.push(`## 2. Interventions (${r.sectionRuns?.interventions ?? r.runsPerCell} paired seeds per configuration)`);
    L.push('');
    L.push('| Configuration | A: T (s) | B: T (s) | C: T* t=0 / pre (s) | A: P(T<=180) | B: P(T<=180) | F* (p/s) | T*_imm (s) |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const c of r.interventions) L.push(cellRow(c));
    L.push('');
    L.push('Paired effects versus configuration 1 (no guidance), negative = faster:');
    L.push('');
    L.push('| Configuration | A: delta T | B: delta T | A: delta p95 exit | B: delta p95 exit | A: top bottleneck | B: top bottleneck | min cut (C) |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const c of r.interventions.slice(1))
      L.push(`| ${c.name} | ${ci(c.effectA, 1)}${sig(c.effectA)} | ${ci(c.effectB, 1)}${sig(c.effectB)} | ${ci(c.effectP95A, 1)}${sig(c.effectP95A)} | ${ci(c.effectP95B, 1)}${sig(c.effectP95B)} | ${c.stats.A?.topBottleneck ?? ''} | ${c.stats.B?.topBottleneck ?? ''} | ${c.phys.cut.map((x) => x.label).join(', ')} |`);
    L.push('');
  }
  if (r.occupancy) {
    L.push(`## 3. Occupancy, legal Crowd Manager minimum (${r.sectionRuns?.occupancy ?? r.runsPerCell} paired seeds per level)`);
    L.push('');
    L.push('| Occupancy | N | A: T (s) | B: T (s) | B - A (s) | C: T*_imm | C: T*_pre | A: P(T<=180) | B: P(T<=180) |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const c of r.occupancy) {
      const d = c.stats.diffs.find((x) => x.label.startsWith('B - A'));
      L.push(`| ${Math.round(c.occ * 100)}% | ${c.stats.A?.runs ? Math.round(c.phys.requiredRate * 180) : Math.round(c.phys.requiredRate * 180)} | ${ci(c.stats.A?.tEvac)} | ${ci(c.stats.B?.tEvac)} | ${ci(d, 1)}${sig(d)} | ${f(c.phys.tStarImm, 0)} | ${ci(c.stats.C?.pre)} | ${pm(c.stats.A?.pMeet)} | ${pm(c.stats.B?.pMeet)} |`);
    }
    L.push('');
  }
  if (r.sensitivity) {
    L.push(`## 4. Sensitivity, one factor at a time, paired with the baseline (${r.sectionRuns?.sensitivity ?? r.runsPerCell} seeds per level)`);
    L.push('');
    L.push('| Factor | Level | A: delta T (s) | B: delta T (s) | C: F* (p/s) | C: T*_imm (s) |');
    L.push('|---|---|---|---|---|---|');
    for (const s of r.sensitivity)
      for (const l of s.levels) L.push(`| ${s.label} | ${l.level} | ${s.key === 'base' ? ci(l.stats.A?.tEvac) + ' (T)' : ci(l.effectA, 1) + sig(l.effectA)} | ${s.key === 'base' ? ci(l.stats.B?.tEvac) + ' (T)' : ci(l.effectB, 1) + sig(l.effectB)} | ${f(l.phys.maxFlow, 2)} | ${f(l.phys.tStarImm, 0)} |`);
    L.push('');
  }
  return L.join('\n');
}
