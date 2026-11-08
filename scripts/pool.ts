/**
 * Persistent worker pool for many small batches (plan optimisation, sweeps).
 *
 * Unlike runParallel (one worker set per batch), workers stay alive and receive one
 * (config, seed, model) job at a time, so thousands of evaluations do not pay the
 * TypeScript-loader start-up cost again and again.
 */
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import type { SimConfig } from '../src/simulation/Params';

export type ModelId = 'A' | 'B';
/** geometry variant: link id -> overrides */
export type GeoPatch = Record<string, { width?: number; lanes?: number }>;

interface Job {
  id: number;
  cfg: SimConfig;
  seed: number;
  model: ModelId;
  geoPatch?: GeoPatch;
  resolve: (s: RunSummary) => void;
  reject: (e: Error) => void;
}

export class SimPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, Job>();
  private nextId = 0;
  readonly size: number;

  constructor(size = Math.max(1, cpus().length - 1)) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./pool-worker-boot.mjs', import.meta.url), { resourceLimits: { maxYoungGenerationSizeMb: 96 } });
      w.on('message', (m: { id: number; summary?: RunSummary; error?: string }) => {
        const job = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (job) {
          if (m.error) job.reject(new Error(m.error));
          else job.resolve(m.summary!);
        }
        this.idle.push(w);
        this.pump();
      });
      w.on('error', (e) => {
        for (const j of this.pending.values()) j.reject(e);
        this.pending.clear();
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.pending.set(job.id, job);
      w.postMessage({ id: job.id, cfg: job.cfg, seed: job.seed, model: job.model, geoPatch: job.geoPatch });
    }
  }

  runOne(cfg: SimConfig, seed: number, model: ModelId = 'A', geoPatch?: GeoPatch): Promise<RunSummary> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, cfg, seed, model, geoPatch, resolve, reject });
      this.pump();
    });
  }

  /** Runs cfg on all seeds; results in seed order. */
  run(cfg: SimConfig, seeds: number[], model: ModelId = 'A', geoPatch?: GeoPatch): Promise<RunSummary[]> {
    return Promise.all(seeds.map((s) => this.runOne(cfg, s, model, geoPatch)));
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
