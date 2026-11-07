/**
 * Browser worker pool for comparison jobs, with dynamic load balancing (each idle worker gets
 * the next job). Results are returned in job order, so batches are reproducible and identical
 * to sequential execution.
 */
import type { CompareJob } from '../workers/CompareWorker';
import { workerCount } from '../simulation/WorkerPool';

let pool: Worker[] = [];
let nextJob = 1;
const busy = new Set<Worker>();

function ensure(n: number) {
  while (pool.length < n) pool.push(new Worker(new URL('../workers/CompareWorker.ts', import.meta.url), { type: 'module' }));
}

export interface JobHandle<T> {
  promise: Promise<T[]>;
  cancel: () => void;
}

export function runCompareJobs<T>(jobs: CompareJob[], onProgress?: (done: number, total: number, last: T | null, index: number) => void): JobHandle<T> {
  const n = Math.max(1, Math.min(workerCount(), jobs.length));
  ensure(n);
  const workers = pool.filter((w) => !busy.has(w)).slice(0, n);
  if (!workers.length) workers.push(pool[0]);
  const jobId = nextJob++;
  const results: (T | null)[] = new Array(jobs.length).fill(null);
  let next = 0;
  let done = 0;
  let cancelled = false;
  const promise = new Promise<T[]>((resolve, reject) => {
    const handlers = new Map<Worker, (ev: MessageEvent) => void>();
    const finish = () => {
      for (const [w, h] of handlers) {
        w.removeEventListener('message', h);
        busy.delete(w);
      }
      // always in job order; cancelled jobs are null
      resolve(results as T[]);
    };
    const feed = (w: Worker) => {
      if (cancelled || next >= jobs.length) return false;
      const index = next++;
      w.postMessage({ type: 'job', jobId, index, job: jobs[index] });
      return true;
    };
    let inflight = 0;
    for (const w of workers) {
      busy.add(w);
      const h = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.jobId !== jobId) return;
        inflight--;
        if (m.type === 'error') {
          cancelled = true;
          for (const [ww, hh] of handlers) {
            ww.removeEventListener('message', hh);
            busy.delete(ww);
          }
          reject(new Error(m.error));
          return;
        }
        if (m.result !== null) {
          results[m.index] = m.result as T;
          done++;
          onProgress?.(done, jobs.length, m.result as T, m.index);
        }
        if (feed(w)) inflight++;
        if (inflight === 0) finish();
      };
      handlers.set(w, h);
      w.addEventListener('message', h);
      if (feed(w)) inflight++;
    }
    if (inflight === 0) finish();
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
  };
}
