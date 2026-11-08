import type { RunSummary } from '../src/simulation/MonteCarlo';

export function runsToCsv(runs: RunSummary[]): string {
  const groups = ['FOYER', 'PORTICO_W', 'PORTICO_E', 'STAGE_W', 'STAGE_E', 'BAL_NW', 'BAL_NE'];
  const head = ['seed', 'label', 'N', 'tEvac', 'tEvacAmbulatory', 'tSafe', 'meanExit', 'medianExit', 'p95Exit', 'medianStart', 'p95Start', 'peakDensity', 'peakDensityWhere', 'highDensityExposure', 'reroutedAgents', 'completed', 'allLeftBuilding', 'gridlock', 'unresolvedInside', 'awaitingAssistance', 'trapped', 'exitImbalance', 'tSafeAll', 'p90Exit', 'p99Exit', 'insideAt180', 'clearOrchestra', 'clearMezzanine', 'clearBalcony', 'last20Elderly', 'last20Group', 'last20Start', 'last20Wait', ...groups.map((g) => `use_${g}`)];
  const rows = runs.map((r) => [r.seed, JSON.stringify(r.label), r.N, r.tEvac, r.tEvacAmbulatory, r.tSafe, r.meanExit, r.medianExit, r.p95Exit, r.medianStart, r.p95Start, r.peakDensity, JSON.stringify(r.peakDensityWhere), r.highDensityExposure, r.reroutedAgents, r.completed, r.allLeftBuilding, r.gridlock, r.unresolvedInside, r.awaitingAssistance, r.trapped, r.exitImbalance, r.tSafeAll ?? NaN, r.p90Exit ?? NaN, r.p99Exit ?? NaN, r.insideAt180 ?? NaN, r.clearanceByLevel?.orchestra ?? NaN, r.clearanceByLevel?.mezzanine ?? NaN, r.clearanceByLevel?.balcony ?? NaN, r.lastOut?.elderlyShare ?? NaN, r.lastOut?.groupShare ?? NaN, r.lastOut?.meanStart ?? NaN, r.lastOut?.meanWait ?? NaN, ...groups.map((g) => r.exitGroupUsage[g] ?? 0)].map((v) => (typeof v === 'number' ? (Number.isFinite(v) ? +v.toFixed(3) : '') : v)).join(','));
  return [head.join(','), ...rows].join('\n');
}

