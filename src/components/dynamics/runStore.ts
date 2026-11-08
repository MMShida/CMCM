/**
 * One recorded run shared by the "Density over time" and "Crowd Managers" tabs.
 * The run is advanced in small chunks on the UI thread so the heat map updates live; when it
 * finishes the full result (regional time series, per-link density frames, manager series) is kept
 * for replay and export. Nothing here changes the simulation: it only sets analysis.keepSeries.
 */
import type { GeometryData } from '../../geometry/types';
import { NetworkSimulation } from '../../network/NetworkSimulation';
import type { HeatItem } from '../../simulation/DensityRegions';
import type { RunResult } from '../../simulation/Metrics';
import type { SimConfig } from '../../simulation/Params';
import { cloneConfig } from '../../simulation/Params';
import { SimulationEngine } from '../../simulation/SimulationEngine';

export type ModelId = 'A' | 'B';

export interface RecordedRun {
  model: ModelId;
  seed: number;
  label: string;
  cfg: SimConfig;
  result: RunResult;
}

export interface LivePost {
  id: string;
  x: number;
  y: number;
  floor: number;
  active: boolean;
  H: number;
  W: number;
}

export class IncrementalRun {
  readonly model: ModelId;
  readonly cfg: SimConfig;
  private readonly a: SimulationEngine | null;
  private readonly b: NetworkSimulation | null;
  constructor(
    readonly geo: GeometryData,
    cfg0: SimConfig,
    readonly seed: number,
    model: ModelId,
  ) {
    this.model = model;
    const cfg = cloneConfig(cfg0);
    cfg.analysis = { ...(cfg.analysis ?? { densityRef: 2, thresholds: [1, 2, 3, 4] }), keepSeries: true };
    this.cfg = cfg;
    this.a = model === 'A' ? new SimulationEngine(geo, cfg, seed) : null;
    this.b = model === 'B' ? new NetworkSimulation(geo, cfg, seed) : null;
  }
  get t(): number {
    return this.a ? this.a.t : this.b!.t;
  }
  get finished(): boolean {
    return this.a ? this.a.finished : this.b!.finished;
  }
  /** advance by `seconds` of simulated time (or to the end) */
  advance(seconds: number) {
    const target = this.t + seconds;
    if (this.a) while (!this.a.finished && this.a.t < target - 1e-9) this.a.step();
    else while (!this.b!.finished && this.b!.t < target - 1e-9) this.b!.step();
  }
  heatItems(): HeatItem[] {
    return (this.a ? this.a.densityRec.heatItems : this.b!.densityRec.heatItems) ?? [];
  }
  liveFrame(): number[] | null {
    return this.a ? this.a.densityRec.lastFrame() : this.b!.densityRec.lastFrame();
  }
  inside(): number {
    return this.a ? this.a.agents.filter((x) => x.inside).length : this.b!.agents.filter((x) => x.inside).length;
  }
  posts(): LivePost[] {
    const list = this.a ? this.a.guidance.cms : this.b!.cmTimes;
    return list.map((m) => ({ id: m.id, x: m.x, y: m.y, floor: m.floor, active: this.t >= m.tActive, H: m.series.H[m.series.H.length - 1] ?? 0, W: m.series.W[m.series.W.length - 1] ?? 0 }));
  }
  result(): RunResult {
    return this.a ? this.a.result() : this.b!.result();
  }
}

type Listener = (r: RecordedRun | null) => void;
let current: RecordedRun | null = null;
const listeners = new Set<Listener>();

export const runStore = {
  get: () => current,
  set(r: RecordedRun | null) {
    current = r;
    for (const l of listeners) l(r);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
