/** Node-side parallel Monte Carlo (worker_threads + tsx loader). */
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import type { SimConfig } from '../src/simulation/Params';

export async function runParallel(cfg: SimConfig, seeds: number[], workers = Math.max(1, cpus().length - 1), onProgress?: (d: number, n: number) => void): Promise<RunSummary[]> {
  const n = Math.max(1, Math.min(workers, seeds.length));
  const out: RunSummary[] = new Array(seeds.length);
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, (_, w) => {
      const idx = seeds.map((_, i) => i).filter((i) => i % n === w);
      return new Promise<void>((resolve, reject) => {
        const wk = new Worker(new URL('./batch-worker-boot.mjs', import.meta.url), {
          workerData: { cfg, seeds: idx.map((i) => seeds[i]), indices: idx },
          resourceLimits: { maxYoungGenerationSizeMb: 96 },

        });
        wk.on('message', (m: { index: number; summary: RunSummary }) => {
          out[m.index] = m.summary;
          done++;
          onProgress?.(done, seeds.length);
        });
        wk.on('error', reject);
        wk.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}`))));
      });
    }),
  );
  return out;
}
