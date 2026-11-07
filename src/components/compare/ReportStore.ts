/** In-memory store of the latest comparison report produced in this browser session. */
import type { ComparisonReport } from '../../compare/Experiments';

let current: ComparisonReport | null = null;
const listeners = new Set<(r: ComparisonReport | null) => void>();

export function setReport(r: ComparisonReport | null) {
  current = r;
  for (const l of listeners) l(r);
}

export function getReport(): ComparisonReport | null {
  return current;
}

export function subscribeReport(fn: (r: ComparisonReport | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
