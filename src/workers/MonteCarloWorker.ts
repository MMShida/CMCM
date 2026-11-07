/// <reference lib="webworker" />
/**
 * Monte Carlo worker: runs complete headless simulations off the UI thread.
 * Message in : { jobId, cfg, seeds, geo? }
 * Messages out: { type: 'run', jobId, index, summary } per replication, then { type: 'done', jobId }
 */
import { BAILEY_HALL } from '../geometry/BaileyHall';
import type { GeometryData } from '../geometry/types';
import { toRunSummary } from '../simulation/MonteCarlo';
import type { SimConfig } from '../simulation/Params';
import { runSimulation } from '../simulation/SimulationEngine';

interface Job {
  jobId: number;
  cfg: SimConfig;
  seeds: number[];
  indices: number[];
  geo?: GeometryData;
}

let cancelled = new Set<number>();

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.jobId);
    return;
  }
  const job = msg as Job;
  const geo = job.geo ?? BAILEY_HALL;
  for (let k = 0; k < job.seeds.length; k++) {
    if (cancelled.has(job.jobId)) break;
    try {
      const r = runSimulation(geo, job.cfg, job.seeds[k]);
      (self as unknown as Worker).postMessage({ type: 'run', jobId: job.jobId, index: job.indices[k], summary: toRunSummary(r) });
    } catch (e) {
      (self as unknown as Worker).postMessage({ type: 'error', jobId: job.jobId, index: job.indices[k], error: String(e) });
    }
  }
  (self as unknown as Worker).postMessage({ type: 'done', jobId: job.jobId });
  cancelled = new Set([...cancelled].filter((id) => id !== job.jobId));
};
