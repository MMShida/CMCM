/**
 * Browser worker pool for Monte Carlo batches. Seeds are split round-robin across
 * workers; results are returned in seed order so batches are reproducible and identical
 * to sequential execution (each replication is a pure function of config + seed).
 */
import type { GeometryData } from '../geometry/types';
import type { RunSummary } from './MonteCarlo';
import type { SimConfig } from './Params';

export interface BatchHandle {
  promise: Promise<RunSummary[]>;
  cancel: () => void;
}

let nextJob = 1;
let pool: Worker[] = [];

export function workerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(8, hc - 1));
}

function ensurePool(n: number) {
  while (pool.length < n) pool.push(new Worker(new URL('../workers/MonteCarloWorker.ts', import.meta.url), { type: 'module' }));
}

export function runBatchInWorkers(
  cfg: SimConfig,
  seeds: number[],
  onProgress: (done: number, total: number, last: RunSummary | null) => void,
  geo?: GeometryData,
  model: 'A' | 'B' = 'A',
): BatchHandle {
  const n = Math.min(workerCount(), Math.max(1, seeds.length));
  ensurePool(n);
  const jobId = nextJob++;
  const results: (RunSummary | null)[] = new Array(seeds.length).fill(null);
  let done = 0;
  let finishedWorkers = 0;
  let cancelled = false;
  const workers = pool.slice(0, n);
  const promise = new Promise<RunSummary[]>((resolve, reject) => {
    const handlers: ((ev: MessageEvent) => void)[] = [];
    const cleanup = () => workers.forEach((w, i) => w.removeEventListener('message', handlers[i]));
    workers.forEach((w, wi) => {
      const h = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.jobId !== jobId) return;
        if (m.type === 'run') {
          results[m.index] = m.summary;
          done++;
          onProgress(done, seeds.length, m.summary);
        } else if (m.type === 'error') {
          cleanup();
          reject(new Error(m.error));
        } else if (m.type === 'done') {
          finishedWorkers++;
          if (finishedWorkers === workers.length) {
            cleanup();
            if (cancelled) resolve(results.filter((r): r is RunSummary => r !== null));
            else resolve(results as RunSummary[]);
          }
        }
      };
      handlers.push(h);
      w.addEventListener('message', h);
      const idx = seeds.map((_, i) => i).filter((i) => i % workers.length === wi);
      w.postMessage({ jobId, cfg, seeds: idx.map((i) => seeds[i]), indices: idx, geo, model });
    });
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      workers.forEach((w) => w.postMessage({ type: 'cancel', jobId }));
    },
  };
}
