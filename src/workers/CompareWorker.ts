/// <reference lib="webworker" />
/**
 * Comparison worker: paired Model A / Model B runs, Model C benchmarks and physical analyses
 * off the UI thread.
 *   in : { type: 'job', jobId, index, job }   job = { kind: 'pair' | 'physical' | 'bench', ... }
 *        { type: 'cancel', jobId }
 *   out: { type: 'result', jobId, index, result } | { type: 'error', jobId, index, error }
 */
import { benchmark, physicalAnalysis, runPair } from '../compare/Comparison';
import type { PairOptions } from '../compare/Comparison';
import { BAILEY_HALL } from '../geometry/BaileyHall';
import type { GeometryData } from '../geometry/types';
import type { SimConfig } from '../simulation/Params';

export type CompareJob =
  | { kind: 'pair'; cfg: SimConfig; seed: number; opt?: PairOptions; geo?: GeometryData }
  | { kind: 'physical'; cfg: SimConfig; seed: number; geo?: GeometryData }
  | { kind: 'bench'; cfg: SimConfig; seed: number; starts: 'imm' | 'pre' | number[]; geo?: GeometryData };

const cancelled = new Set<number>();

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'cancel') {
    cancelled.add(m.jobId);
    return;
  }
  if (m.type !== 'job') return;
  const post = (x: unknown) => (self as unknown as Worker).postMessage(x);
  if (cancelled.has(m.jobId)) {
    post({ type: 'result', jobId: m.jobId, index: m.index, result: null, cancelled: true });
    return;
  }
  const job = m.job as CompareJob;
  const geo = job.geo ?? BAILEY_HALL;
  try {
    let result: unknown;
    if (job.kind === 'pair') result = runPair(geo, job.cfg, job.seed, job.opt);
    else if (job.kind === 'physical') result = physicalAnalysis(geo, job.cfg, job.seed);
    else {
      const r = benchmark(geo, job.cfg, job.seed, job.starts);
      result = { tStar: r.tStar, curve: r.curve, exitUsage: r.exitUsage };
    }
    post({ type: 'result', jobId: m.jobId, index: m.index, result });
  } catch (e) {
    post({ type: 'error', jobId: m.jobId, index: m.index, error: String(e) });
  }
};
