/**
 * Shared experiment definitions for the model comparison (used by the browser dashboard and by
 * the CLI `npm run compare`), so both produce the same tables from the same configurations.
 */
import { slotId } from '../geometry/BaileyHall';
import type { GeometryData } from '../geometry/types';
import type { SimConfig } from '../simulation/Params';
import { cloneConfig, mergeConfig } from '../simulation/Params';
import { STRATEGIES, scenarioById } from '../simulation/Scenarios';
import type { ComparisonStats, PairRecord } from './Comparison';
import { comparisonStats, interventionEffect, physicalAnalysis, scaleWidths } from './Comparison';
import type { Summary } from '../simulation/MonteCarlo';

export interface InterventionDef {
  id: string;
  name: string;
  build: (geo: GeometryData) => SimConfig;
}

const strat = (id: string) => STRATEGIES.find((s) => s.id === id)!;

/** the seven interventions of the comparison (section 9 of the task) */
export const INTERVENTIONS: InterventionDef[] = [
  { id: 'S0', name: '1. Concert emergency, no guidance (baseline)', build: (g) => strat('S0').build(g) },
  { id: 'S1', name: '2. + Crowd Managers (6)', build: (g) => strat('S1').build(g) },
  { id: 'S2', name: '3. + LED guidance (with CMs)', build: (g) => strat('S2').build(g) },
  { id: 'S3', name: '4. + corridor barriers W1/E1 (with CMs)', build: (g) => strat('S3').build(g) },
  { id: 'S4', name: '5. CMs + LED + barriers', build: (g) => strat('S4').build(g) },
  { id: 'S5', name: '6. One blocked exit (FC2, discovered)', build: (g) => strat('S5').build(g) },
  { id: 'LEC', name: '7. Lecture, no Crowd Managers', build: () => scenarioById('lecture') },
];

export const OCCUPANCY_LEVELS = [0.1, 0.25, 0.5, 0.75, 1];

export function occupancyConfig(base: SimConfig, occ: number): SimConfig {
  const c = mergeConfig(base, { occupancy: { orchestra: occ, mezzanine: occ, balcony: occ }, crowdManagers: { count: -1 } });
  c.label = `${Math.round(occ * 100)}% occupancy (legal CM minimum)`;
  return c;
}

export interface SensitivityDef {
  key: string;
  label: string;
  levels: { label: string; cfg: (c: SimConfig) => SimConfig; geo?: (g: GeometryData) => GeometryData }[];
}

const tweak = (label: string, f: (c: SimConfig) => void) => (c: SimConfig) => {
  const x = cloneConfig(c);
  f(x);
  x.label = `${c.label} | ${label}`;
  return x;
};

/** one-at-a-time sensitivity factors (low / high around the baseline) */
export const SENSITIVITY: SensitivityDef[] = [
  {
    key: 'doorWidth',
    label: 'Door clear widths (all doors)',
    levels: [
      { label: 'x0.8', cfg: (c) => c, geo: (g) => scaleWidths(g, 0.8) },
      { label: 'x1.2', cfg: (c) => c, geo: (g) => scaleWidths(g, 1.2) },
    ],
  },
  {
    key: 'stairWidth',
    label: 'Stair / access-point widths',
    levels: [
      { label: 'x0.8', cfg: (c) => c, geo: (g) => scaleWidths(g, 1, 0.8) },
      { label: 'x1.2', cfg: (c) => c, geo: (g) => scaleWidths(g, 1, 1.2) },
    ],
  },
  {
    key: 'doorFlow',
    label: 'Door specific flow (p/(s m))',
    levels: [
      { label: '1.0', cfg: tweak('doorFlow 1.0', (x) => (x.movement.doorFlow = 1.0)) },
      { label: '1.6', cfg: tweak('doorFlow 1.6', (x) => (x.movement.doorFlow = 1.6)) },
    ],
  },
  {
    key: 'stairFlow',
    label: 'Stair specific flow (p/(s m))',
    levels: [
      { label: '0.8', cfg: tweak('stairFlow 0.8', (x) => (x.movement.stairFlow = 0.8)) },
      { label: '1.3', cfg: tweak('stairFlow 1.3', (x) => (x.movement.stairFlow = 1.3)) },
    ],
  },
  {
    key: 'reaction',
    label: 'Reaction times (recognition + response medians)',
    levels: [
      { label: 'x0.5', cfg: tweak('reaction x0.5', (x) => ((x.premovement.recognitionMedian *= 0.5), (x.premovement.responseMedian *= 0.5))) },
      { label: 'x1.5', cfg: tweak('reaction x1.5', (x) => ((x.premovement.recognitionMedian *= 1.5), (x.premovement.responseMedian *= 1.5))) },
    ],
  },
  {
    key: 'habit',
    label: 'Exit preference (share of habitual decision makers)',
    levels: [
      { label: '0.15', cfg: tweak('habitual 0.15', (x) => setHabitual(x, 0.15)) },
      { label: '0.55', cfg: tweak('habitual 0.55', (x) => setHabitual(x, 0.55)) },
    ],
  },
  {
    key: 'compliance',
    label: 'Crowd Manager compliance',
    levels: [
      { label: '0.5', cfg: tweak('compliance 0.5', (x) => (x.crowdManagers.complianceProb = 0.5)) },
      { label: '0.95', cfg: tweak('compliance 0.95', (x) => (x.crowdManagers.complianceProb = 0.95)) },
    ],
  },
  {
    key: 'speed',
    label: 'Mean walking speed (m/s)',
    levels: [
      { label: '1.0', cfg: tweak('speed 1.0', (x) => (x.population.speedMean = 1.0)) },
      { label: '1.4', cfg: tweak('speed 1.4', (x) => (x.population.speedMean = 1.4)) },
    ],
  },
  {
    key: 'cmEffect',
    label: 'Crowd Manager effectiveness (voice range, response factor)',
    levels: [
      { label: 'weak', cfg: tweak('CM weak', (x) => ((x.crowdManagers.radius = 7), (x.premovement.cmFactor = 0.8))) },
      { label: 'strong', cfg: tweak('CM strong', (x) => ((x.crowdManagers.radius = 18), (x.premovement.cmFactor = 0.3))) },
    ],
  },
];

function setHabitual(c: SimConfig, v: number) {
  const s = c.population.typeShares;
  const rest = 1 - s.habitual;
  const scale = rest > 0 ? (1 - v) / rest : 0;
  for (const k of Object.keys(s) as (keyof typeof s)[]) if (k !== 'habitual') s[k] *= scale;
  s.habitual = v;
}

export function baselineConfig(): SimConfig {
  return scenarioById('concert-emergency');
}

/** barrier slot ids for presets */
export function barrierIds(geo: GeometryData, slots = ['W1', 'E1']) {
  return slots.map((s) => slotId(geo, s));
}

// ------------------------------------------------------------------ report format

export interface PhysSummary {
  maxFlow: number;
  requiredRate: number;
  flowTime: number;
  tStarImm: number;
  tStarPre: number;
  cut: { id: string; label: string; capacity: number; region: string }[];
  exitUsageImm: Record<string, number>;
  curveImm?: number[];
  curvePre?: number[];
}

export function physSummary(geo: GeometryData, cfg: SimConfig, seed: number, curves = false): PhysSummary {
  const p = physicalAnalysis(geo, cfg, seed);
  return {
    maxFlow: p.maxFlow,
    requiredRate: p.requiredRate,
    flowTime: p.flowTime,
    tStarImm: p.tStarImm,
    tStarPre: p.tStarPre,
    cut: p.cut,
    exitUsageImm: p.exitUsageImm,
    curveImm: curves ? p.curveImm : undefined,
    curvePre: curves ? p.curvePre : undefined,
  };
}

export interface CellResult {
  id: string;
  name: string;
  stats: ComparisonStats;
  phys: PhysSummary;
  /** paired effects vs the reference cell (same seeds) */
  effectA?: Summary;
  effectB?: Summary;
  /** p95 individual-exit effect (tail risk) */
  effectP95A?: Summary;
  effectP95B?: Summary;
  /** mean curves (persons outside per second) */
  meanCurveA?: number[];
  meanCurveB?: number[];
  tEvacA?: number[];
  tEvacB?: number[];
}

export interface ComparisonReport {
  generated: string;
  source: 'browser' | 'cli';
  runsPerCell: number;
  baseSeed: number;
  models: string[];
  baseline?: CellResult;
  interventions?: CellResult[];
  occupancy?: (CellResult & { occ: number })[];
  sensitivity?: { key: string; label: string; levels: (CellResult & { level: string })[] }[];
  /** seeds per cell for each section (sections can come from separate CLI runs) */
  sectionRuns?: Record<string, number>;
  notes: string[];
}

export function meanCurve(curves: number[][]): number[] {
  const L = Math.max(0, ...curves.map((c) => c.length));
  const out: number[] = [];
  for (let t = 0; t < L; t++) {
    let s = 0;
    for (const c of curves) s += c[Math.min(t, c.length - 1)] ?? 0;
    out.push(curves.length ? s / curves.length : 0);
  }
  return out;
}

export function makeCell(id: string, name: string, recs: PairRecord[], phys: PhysSummary, ref?: PairRecord[]): CellResult {
  const stats = comparisonStats(name, recs);
  const cell: CellResult = {
    id,
    name,
    stats,
    phys,
    meanCurveA: recs.some((r) => r.A) ? meanCurve(recs.filter((r) => r.A).map((r) => r.A!.evacuated)) : undefined,
    meanCurveB: recs.some((r) => r.B) ? meanCurve(recs.filter((r) => r.B).map((r) => r.B!.evacuated)) : undefined,
    tEvacA: recs.filter((r) => r.A).map((r) => r.A!.tEvac),
    tEvacB: recs.filter((r) => r.B).map((r) => r.B!.tEvac),
  };
  if (ref) {
    if (recs.some((r) => r.A)) {
      cell.effectA = interventionEffect(ref, recs, 'A');
      cell.effectP95A = interventionEffect(ref, recs, 'A', (r) => r.p95Exit);
    }
    if (recs.some((r) => r.B)) {
      cell.effectB = interventionEffect(ref, recs, 'B');
      cell.effectP95B = interventionEffect(ref, recs, 'B', (r) => r.p95Exit);
    }
  }
  return cell;
}

export const REPORT_NOTES = [
  'All numbers are model outputs under the documented assumptions (docs/PARAMETERS.md, docs/NETWORK_MODEL.md); they do not demonstrate regulatory compliance or real-world safety.',
  'A and B use identical audiences for each seed (shared createPopulation); each engine uses separate random streams for its own dynamics.',
  'B - A mixes spatial representation, collision rules, queue implementation, geometry simplification, time step and speed model; it is not a pure behavioural effect.',
  'Model C is an idealised benchmark: perfectly coordinated routing at the representative free walking speed on the same graph and capacities as Model B.',
];

// ------------------------------------------------------------------ planning / assembly (browser + CLI)

export type ExperimentKind = 'baseline' | 'interventions' | 'occupancy' | 'sensitivity';

export interface PlannedCell {
  kind: ExperimentKind;
  id: string;
  name: string;
  cfg: SimConfig;
  /** geometry variant (door-width sensitivity); undefined = bundled geometry */
  geo?: GeometryData;
  occ?: number;
  factor?: string;
  factorLabel?: string;
  level?: string;
}

export function planCells(kinds: ExperimentKind[], geo: GeometryData, base: SimConfig = baselineConfig()): PlannedCell[] {
  const cells: PlannedCell[] = [];
  if (kinds.includes('baseline')) cells.push({ kind: 'baseline', id: 'BASE', name: base.label, cfg: base });
  if (kinds.includes('interventions')) for (const d of INTERVENTIONS) cells.push({ kind: 'interventions', id: d.id, name: d.name, cfg: d.build(geo) });
  if (kinds.includes('occupancy')) for (const o of OCCUPANCY_LEVELS) cells.push({ kind: 'occupancy', id: `OCC${Math.round(o * 100)}`, name: `${Math.round(o * 100)}% occupancy`, cfg: occupancyConfig(base, o), occ: o });
  if (kinds.includes('sensitivity')) {
    cells.push({ kind: 'sensitivity', id: 'SENS:base', name: 'baseline', cfg: base, factor: 'base', factorLabel: 'baseline', level: 'base' });
    for (const f of SENSITIVITY)
      for (const L of f.levels) cells.push({ kind: 'sensitivity', id: `SENS:${f.key}:${L.label}`, name: `${f.label} ${L.label}`, cfg: L.cfg(base), geo: L.geo ? L.geo(geo) : undefined, factor: f.key, factorLabel: f.label, level: L.label });
  }
  return cells;
}

export function assembleReport(
  cells: PlannedCell[],
  records: PairRecord[][],
  phys: PhysSummary[],
  meta: { source: 'browser' | 'cli'; runs: number; baseSeed: number; models: string[] },
): ComparisonReport {
  const rep: ComparisonReport = { generated: new Date().toISOString(), source: meta.source, runsPerCell: meta.runs, baseSeed: meta.baseSeed, models: meta.models, notes: REPORT_NOTES };
  const idx = (pred: (c: PlannedCell) => boolean) => cells.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0);
  const b = idx((c) => c.kind === 'baseline');
  if (b.length) rep.baseline = makeCell(cells[b[0]].id, cells[b[0]].name, records[b[0]], phys[b[0]]);
  const iv = idx((c) => c.kind === 'interventions');
  if (iv.length) {
    const ref = records[iv[0]];
    rep.interventions = iv.map((i, k) => makeCell(cells[i].id, cells[i].name, records[i], phys[i], k === 0 ? undefined : ref));
  }
  const oc = idx((c) => c.kind === 'occupancy');
  if (oc.length) rep.occupancy = oc.map((i) => ({ ...makeCell(cells[i].id, cells[i].name, records[i], phys[i]), occ: cells[i].occ! }));
  const se = idx((c) => c.kind === 'sensitivity');
  if (se.length) {
    const baseI = se.find((i) => cells[i].factor === 'base')!;
    const ref = records[baseI];
    const factors = [...new Set(se.map((i) => cells[i].factor!))];
    rep.sensitivity = factors.map((f) => ({
      key: f,
      label: cells[se.find((i) => cells[i].factor === f)!].factorLabel!,
      levels: se.filter((i) => cells[i].factor === f).map((i) => ({ ...makeCell(cells[i].id, cells[i].name, records[i], phys[i], f === 'base' ? undefined : ref), level: cells[i].level! })),
    }));
  }
  return rep;
}
