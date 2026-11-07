/**
 * Density estimation and speed-density relation.
 *
 * Local density at position s on a link of width w (persons/m^2):
 *     rho(s) = (n[s, s+W) + c * n_opp[s, s+W)) / (W * w)
 * using 1 m occupancy bins and a forward-looking window W = 2 m (opposing flow
 * weighted by the friction coefficient c). Speed follows Weidmann's fundamental diagram
 *     v = v0 * (1 - exp(-gamma (1/rho - 1/rho_max))),
 * clipped to [0.05 v0, v0].
 */
import type { NavGraph } from '../geometry/NavigationGraph';

export function weidmannFactor(rho: number, gamma: number, rhoMax: number): number {
  if (rho <= 0.3) return 1;
  if (rho >= rhoMax) return 0.05;
  const f = 1 - Math.exp(-gamma * (1 / rho - 1 / rhoMax));
  return Math.max(0.05, Math.min(1, f));
}

export class DensityField {
  /** occupancy bins per link, per direction: binsPos (a->b movers), binsNeg (b->a movers) */
  readonly binsPos: Float32Array[];
  readonly binsNeg: Float32Array[];
  readonly peakByLink: Float64Array;
  constructor(private g: NavGraph) {
    this.binsPos = g.links.map((L) => new Float32Array(Math.max(1, Math.ceil(L.len))));
    this.binsNeg = g.links.map((L) => new Float32Array(Math.max(1, Math.ceil(L.len))));
    this.peakByLink = new Float64Array(g.links.length);
  }
  clearList(links: number[]) {
    for (const i of links) {
      this.binsPos[i].fill(0);
      this.binsNeg[i].fill(0);
    }
  }
  clear(active: Uint8Array) {
    for (let i = 0; i < this.binsPos.length; i++) {
      if (!active[i]) continue;
      this.binsPos[i].fill(0);
      this.binsNeg[i].fill(0);
    }
  }
  add(li: number, sAbs: number, dir: number) {
    const b = dir > 0 ? this.binsPos[li] : this.binsNeg[li];
    const k = Math.min(b.length - 1, Math.max(0, Math.floor(sAbs)));
    b[k] += 1;
  }
  /** Density ahead of sAbs in travel direction dir (window W metres). */
  densityAhead(li: number, sAbs: number, dir: number, friction: number): number {
    const L = this.g.links[li];
    const same = dir > 0 ? this.binsPos[li] : this.binsNeg[li];
    const opp = dir > 0 ? this.binsNeg[li] : this.binsPos[li];
    const nb = same.length;
    let k0 = Math.floor(sAbs);
    if (k0 >= nb) k0 = nb - 1;
    if (k0 < 0) k0 = 0;
    let n = 0;
    let m = 0;
    let cnt = 0;
    if (dir > 0) {
      for (let k = k0; k < Math.min(nb, k0 + 2); k++) {
        n += same[k];
        m += opp[k];
        cnt++;
      }
    } else {
      for (let k = k0; k > Math.max(-1, k0 - 2); k--) {
        n += same[k];
        m += opp[k];
        cnt++;
      }
    }
    const len = Math.min(L.len, cnt);
    return (n + friction * m) / (Math.max(0.5, len) * L.width);
  }
  /** Maximum 2 m window density on a link right now (both directions). */
  linkPeak(li: number): number {
    const L = this.g.links[li];
    const a = this.binsPos[li];
    const b = this.binsNeg[li];
    let best = 0;
    for (let k = 0; k < a.length; k++) {
      const n = a[k] + b[k] + (k + 1 < a.length ? a[k + 1] + b[k + 1] : 0);
      const len = Math.min(L.len, k + 1 < a.length ? 2 : 1);
      const d = n / (Math.max(0.5, len) * L.width);
      if (d > best) best = d;
    }
    return best;
  }
}

/** Heat-map accumulator on a regular grid (per floor). */
export class HeatGrid {
  readonly nx: number;
  readonly ny: number;
  readonly maxD: Float32Array;
  readonly sumD: Float32Array;
  samples = 0;
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly cell: number,
    readonly w: number,
    readonly h: number,
  ) {
    this.nx = Math.ceil(w / cell);
    this.ny = Math.ceil(h / cell);
    this.maxD = new Float32Array(this.nx * this.ny);
    this.sumD = new Float32Array(this.nx * this.ny);
  }
  index(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((y - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }
  add(x: number, y: number, d: number) {
    const k = this.index(x, y);
    if (k < 0) return;
    if (d > this.maxD[k]) this.maxD[k] = d;
    this.sumD[k] += d;
  }
}
