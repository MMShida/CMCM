/**
 * Density over time: measurement regions and the recorder shared by Models A and B.
 *
 * REGIONS. Every walkable link of the reconstructed geometry (except seat rows, the elevator and
 * the outdoor street links) belongs to AT MOST ONE region, so a person is never counted twice.
 * Region area = sum over its links of (polyline length x clear width). The widths come from the
 * reconstruction of the scanned plans (ASSUMPTION, +/- 0.3 m, see PARAMETERS.md), so every area
 * is labelled "derived from the reconstructed geometry", and regions containing links marked
 * approximate in the geometry are flagged `approx`. Seat rows are excluded: seated people are
 * not walking and a row's lane area says nothing about crowd density.
 *
 *   rho_A(t) = N_A(t) / Area(A)              (persons / m^2, region average)
 *
 * A region average hides local peaks; the local measure used for individual exposure (Model A)
 * is the 2 m forward window of Congestion.ts.
 *
 * CAPACITY (for "capacity utilisation" = outflow / capacity): sum over the links that leave the
 * region (boundary crossings in the outward direction) of their nominal flow capacity: gates
 * (doors / stair entries) specific flow x effective width, other links lanes x 0.94 p/s. This is
 * a nominal reference, not a measured value.
 *
 * Model B maps its contracted edges back onto these links (edge.links), so both models report
 * the same regions with the same areas.
 */
import type { GLink, GeometryData } from '../geometry/types';
import type { AnalysisConfig, SimConfig } from './Params';
import { OUTWARD_ONLY } from './Routing';

export interface RegionDef {
  id: string;
  label: string;
  test: (L: GLink, mid: [number, number]) => boolean;
}

const re = (r: RegExp) => (L: GLink) => r.test(L.id);
const corridorPart = (part: 'W' | 'S' | 'E') => (L: GLink, mid: [number, number]) => {
  if (!/^(CO_\d+|CFC_\d+)$/.test(L.id)) return false;
  if (L.id.startsWith('CFC')) return part === 'S';
  const x = mid[0];
  return part === 'W' ? x < -6.5 : part === 'E' ? x > 6.5 : Math.abs(x) <= 6.5;
};

/** Region definitions (order = display order). Links are assigned to the FIRST matching region. */
export const REGION_DEFS: RegionDef[] = [
  { id: 'orchCentralAisles', label: 'Central orchestra aisles (AW, AE)', test: re(/^A[WE]_L\d+$/) },
  { id: 'orchSideAisles', label: 'Side orchestra aisles (SPW, SPE)', test: re(/^SP[WE]_\d+$/) },
  { id: 'orchFrontCross', label: 'Orchestra front cross-aisle (FX)', test: re(/^FX_\d+$/) },
  { id: 'orchAccess', label: 'Orchestra-to-mezzanine access steps (OST)', test: re(/^OST_[A-Z]+$/) },
  { id: 'logeAisles', label: 'Loge cross-aisles (LN, LM, LS)', test: re(/^L[NMS][WE]_x\w+$/) },
  { id: 'mezzAisles', label: 'Mezzanine radial aisles (MRW, MRE, MC)', test: re(/^(MRW|MRE|MC)_x\w+$/) },
  { id: 'mezzWalkway', label: 'Loge / mezzanine rear walkway (WK)', test: re(/^WK_\d+$/) },
  { id: 'mezzExits', label: 'Auditorium exit doors D1-D9', test: re(/^D\d$/) },
  { id: 'corrWest', label: 'Western semicircular corridor', test: corridorPart('W') },
  { id: 'corrSouth', label: 'Southern corridor (incl. foyer connections)', test: corridorPart('S') },
  { id: 'corrEast', label: 'Eastern semicircular corridor', test: corridorPart('E') },
  { id: 'foyer', label: 'Foyer (incl. doors FC1-FC3)', test: re(/^(FY[LV]_\d+|FC\d)$/) },
  { id: 'mainDoors', label: 'Main exterior doorway approach (F1-F5, landing)', test: re(/^(F\d|FOL_\w+)$/) },
  { id: 'portico', label: 'Side portico exits (P1-P4, porticos)', test: re(/^(P\d|PO[WE]_\d+)$/) },
  { id: 'stageExits', label: 'Stage escape routes (SD, SEP, SES, XSE)', test: re(/^(SD[WE]|SEP[WE]|SES[WE]|XSE[WE])$/) },
  { id: 'balAisles', label: 'Balcony aisles and walkway', test: re(/^(B[NS2][WE]_x\w+|BC_x\w+|BWK_\d+)$/) },
  { id: 'balStairEntries', label: 'Balcony staircase entrances (BSD, BND doors)', test: re(/^(BSD[WE]|BND[WE])$/) },
  { id: 'balStairs', label: 'Balcony staircases (south and north)', test: re(/^(BSF\d[WE]|BSV[WE]|VSF[WE]|VSC[WE]|BNST[WE]|XBN[WE])$/) },
  { id: 'extStairs', label: 'External staircases (main stair, portico stairs)', test: re(/^(MS_\d+|PST_[WE])$/) },
];

export interface RegionInfo {
  id: string;
  label: string;
  /** m^2, derived from the reconstructed geometry (length x clear width) */
  area: number;
  /** nominal outflow capacity (p/s) */
  capacity: number;
  floor: number;
  links: string[];
  /** contains links marked approximate in the geometry */
  approx: boolean;
}

export interface RegionMap {
  regions: RegionInfo[];
  /** region index by geometry link id (-1 = not measured) */
  byLink: Map<string, number>;
}

function polyLen(pts: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

function midpoint(pts: [number, number][]): [number, number] {
  const L = polyLen(pts);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= L / 2 && d > 0) {
      const f = (L / 2 - acc) / d;
      return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])];
    }
    acc += d;
  }
  return pts[0];
}

/** nominal flow capacity (p/s) of a link, as used for the utilisation reference */
export function linkCapacity(L: GLink, cfg: SimConfig): number {
  const M = cfg.movement;
  const isStair = L.kind === 'stair';
  if (L.gate || L.kind === 'door') {
    const bl = isStair ? M.boundaryLayerStair : M.boundaryLayerDoor;
    return Math.max(0.2, (L.width - 2 * bl) * (isStair ? M.stairFlow : M.doorFlow));
  }
  if (isStair) return Math.max(0.2, (L.width - 2 * M.boundaryLayerStair) * M.stairFlow);
  const lanes = L.lanes ?? Math.max(1, Math.floor(L.width / M.laneWidth));
  return lanes * 0.94;
}

const cache = new WeakMap<GeometryData, Map<string, RegionMap>>();

export function buildRegions(geo: GeometryData, cfg: SimConfig): RegionMap {
  const key = `${cfg.movement.doorFlow}|${cfg.movement.stairFlow}|${cfg.movement.laneWidth}|${cfg.movement.boundaryLayerDoor}|${cfg.movement.boundaryLayerStair}`;
  let m = cache.get(geo);
  if (!m) cache.set(geo, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const byLink = new Map<string, number>();
  const regions: RegionInfo[] = REGION_DEFS.map((d) => ({ id: d.id, label: d.label, area: 0, capacity: 0, floor: 1, links: [], approx: false }));
  const floors: number[][] = regions.map(() => []);
  for (const L of geo.links) {
    if (L.kind === 'row' || L.prohibited || L.kind === 'outdoor') continue;
    const mid = midpoint(L.pts);
    const r = REGION_DEFS.findIndex((d) => d.test(L, mid));
    if (r < 0) continue;
    byLink.set(L.id, r);
    const R = regions[r];
    R.area += polyLen(L.pts) * L.width;
    R.links.push(L.id);
    if (L.approx) R.approx = true;
    floors[r].push(L.floor);
  }
  regions.forEach((R, i) => (R.floor = floors[i].includes(2) ? 2 : floors[i].length ? Math.max(...floors[i]) : 1));
  // outflow capacity over boundary crossings
  const nodeLinks = new Map<string, GLink[]>();
  for (const L of geo.links) {
    if (L.kind === 'row' || L.prohibited) continue;
    for (const n of [L.a, L.b]) {
      let arr = nodeLinks.get(n);
      if (!arr) nodeLinks.set(n, (arr = []));
      arr.push(L);
    }
  }
  regions.forEach((R, ri) => {
    const seen = new Set<string>();
    for (const id of R.links) {
      const L = geo.links.find((x) => x.id === id)!;
      for (const n of [L.a, L.b])
        for (const M of nodeLinks.get(n) ?? []) {
          if (byLink.get(M.id) === ri || seen.has(M.id)) continue;
          // directed links (doors into the corridor / foyer, access steps, exterior doors) only count leaving
          const directed = OUTWARD_ONLY.test(M.id) || M.exterior;
          if (directed && n !== M.a) continue;
          seen.add(M.id);
          R.capacity += linkCapacity(M, cfg);
        }
    }
    R.area = Math.round(R.area * 10) / 10;
    R.capacity = Math.round(R.capacity * 100) / 100;
  });
  const out = { regions, byLink };
  m.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// recorder
// ---------------------------------------------------------------------------------------------
export interface HeatItem {
  id: string;
  floor: number;
  pts: [number, number][];
  area: number;
  region: number;
}

export interface DensitySeries {
  t: number[];
  /** [region][sample] */
  occ: number[][];
  dens: number[][];
  inflow: number[][];
  outflow: number[][];
  speed: number[][];
  queue: number[][];
  util: number[][];
  /** m^2 of regions above rho_ref, and number of such regions, per sample */
  congestedArea: number[];
  regionsAbove: number[];
}

export interface DensityResult {
  ref: number;
  thresholds: number[];
  regions: { id: string; label: string; area: number; capacity: number; floor: number; approx: boolean }[];
  /** per region: peak region-average density, its time, peak occupancy, time-averaged density over the run */
  peak: number[];
  peakT: number[];
  peakOcc: number[];
  meanDensity: number[];
  /** [threshold index][region]: seconds with region density above the threshold */
  timeAbove: number[][];
  /** persons x seconds spent in regions whose density exceeds rho_ref */
  personTimeAbove: number;
  maxCongestedArea: number;
  maxRegionsAbove: number;
  /** individual exposure E_i = int max(0, rho(x_i, t) - rho_ref) dt  (p s / m^2) */
  exposure: { mean: number; median: number; p90: number; p95: number; max: number; shareExposed: number; meanTimeAbove: number; local: string };
  series?: DensitySeries;
  heat?: { items: HeatItem[]; frames: number[][] };
  exposureValues?: number[];
}

export class DensityRecorder {
  readonly nR: number;
  readonly inflow: Int32Array;
  readonly outflow: Int32Array;
  private readonly an: AnalysisConfig;
  private readonly keep: boolean;
  private series: DensitySeries;
  private peak: Float64Array;
  private peakT: Float64Array;
  private peakOcc: Int32Array;
  private sumDens: Float64Array;
  private timeAbove: Float64Array[];
  private personTimeAbove = 0;
  private maxArea = 0;
  private maxRegions = 0;
  private samples = 0;
  private lastT = 0;
  private frames: number[][] = [];

  constructor(
    readonly map: RegionMap,
    cfg: SimConfig,
    readonly heatItems: HeatItem[] | null,
  ) {
    this.nR = map.regions.length;
    this.an = cfg.analysis ?? { densityRef: 2, thresholds: [1, 2, 3, 4], keepSeries: false };
    this.keep = !!this.an.keepSeries;
    this.inflow = new Int32Array(this.nR);
    this.outflow = new Int32Array(this.nR);
    const mk = () => map.regions.map(() => [] as number[]);
    this.series = { t: [], occ: mk(), dens: mk(), inflow: mk(), outflow: mk(), speed: mk(), queue: mk(), util: mk(), congestedArea: [], regionsAbove: [] };
    this.peak = new Float64Array(this.nR);
    this.peakT = new Float64Array(this.nR);
    this.peakOcc = new Int32Array(this.nR);
    this.sumDens = new Float64Array(this.nR);
    this.timeAbove = this.an.thresholds.map(() => new Float64Array(this.nR));
  }

  /** latest per-link (heat item) density frame, for live display (null unless keepSeries) */
  lastFrame(): number[] | null {
    return this.frames.length ? this.frames[this.frames.length - 1] : null;
  }

  /** flows across region boundaries (called by the model on every crossing) */
  cross(from: number, to: number) {
    if (from === to) return;
    if (from >= 0) this.outflow[from]++;
    if (to >= 0) this.inflow[to]++;
  }

  /**
   * One sample at time t (the models call it once per simulated second).
   * occ / speedSum / queue are per region; heatOcc (optional) per heat item.
   */
  sample(t: number, occ: ArrayLike<number>, speedSum: ArrayLike<number>, queue: ArrayLike<number>, heatOcc: ArrayLike<number> | null) {
    const dt = this.samples === 0 ? 0 : t - this.lastT;
    this.lastT = t;
    this.samples++;
    const R = this.map.regions;
    const ref = this.an.densityRef;
    let area = 0;
    let nAbove = 0;
    const S = this.series;
    if (this.keep) S.t.push(t);
    for (let r = 0; r < this.nR; r++) {
      const d = occ[r] / Math.max(0.1, R[r].area);
      if (d > this.peak[r]) {
        this.peak[r] = d;
        this.peakT[r] = t;
      }
      if (occ[r] > this.peakOcc[r]) this.peakOcc[r] = occ[r];
      this.sumDens[r] += d * dt;
      this.an.thresholds.forEach((thr, k) => {
        if (d > thr) this.timeAbove[k][r] += dt;
      });
      if (d > ref) {
        area += R[r].area;
        nAbove++;
        this.personTimeAbove += occ[r] * dt;
      }
      if (this.keep) {
        S.occ[r].push(occ[r]);
        S.dens[r].push(Math.round(d * 1000) / 1000);
        S.inflow[r].push(this.inflow[r]);
        S.outflow[r].push(this.outflow[r]);
        S.speed[r].push(occ[r] > 0 ? Math.round((speedSum[r] / occ[r]) * 100) / 100 : NaN);
        S.queue[r].push(queue[r]);
        S.util[r].push(R[r].capacity > 0 ? Math.round((this.outflow[r] / Math.max(1e-9, dt || 1) / R[r].capacity) * 1000) / 1000 : NaN);
      }
      this.inflow[r] = 0;
      this.outflow[r] = 0;
    }
    if (area > this.maxArea) this.maxArea = area;
    if (nAbove > this.maxRegions) this.maxRegions = nAbove;
    if (this.keep) {
      S.congestedArea.push(Math.round(area * 10) / 10);
      S.regionsAbove.push(nAbove);
      if (this.heatItems && heatOcc) this.frames.push(this.heatItems.map((h, i) => Math.round((heatOcc[i] / Math.max(0.05, h.area)) * 100) / 100));
    }
  }

  finish(exposures: number[], timesAbove: number[], localRule: string): DensityResult {
    const T = Math.max(1e-9, this.lastT);
    const sorted = [...exposures].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : NaN);
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const out: DensityResult = {
      ref: this.an.densityRef,
      thresholds: [...this.an.thresholds],
      regions: this.map.regions.map((R) => ({ id: R.id, label: R.label, area: R.area, capacity: R.capacity, floor: R.floor, approx: R.approx })),
      peak: Array.from(this.peak, r3),
      peakT: Array.from(this.peakT),
      peakOcc: Array.from(this.peakOcc),
      meanDensity: Array.from(this.sumDens, (s) => r3(s / T)),
      timeAbove: this.timeAbove.map((a) => Array.from(a, (v) => Math.round(v * 10) / 10)),
      personTimeAbove: Math.round(this.personTimeAbove),
      maxCongestedArea: Math.round(this.maxArea * 10) / 10,
      maxRegionsAbove: this.maxRegions,
      exposure: {
        mean: r3(exposures.reduce((s, v) => s + v, 0) / Math.max(1, exposures.length)),
        median: r3(q(0.5)),
        p90: r3(q(0.9)),
        p95: r3(q(0.95)),
        max: r3(sorted.length ? sorted[sorted.length - 1] : NaN),
        shareExposed: r3(exposures.filter((v) => v > 0).length / Math.max(1, exposures.length)),
        meanTimeAbove: r3(timesAbove.reduce((s, v) => s + v, 0) / Math.max(1, timesAbove.length)),
        local: localRule,
      },
    };
    if (this.keep) {
      out.series = this.series;
      if (this.heatItems) out.heat = { items: this.heatItems, frames: this.frames };
      out.exposureValues = exposures.map(r3);
    }
    return out;
  }
}
