/**
 * Seeded, reproducible pseudorandom numbers.
 *
 * xoshiro128** generator seeded through splitmix32. Independent named streams
 * (e.g. "population", "dynamics") are derived from (seed, streamName) so that
 * changing how often one part of the model draws random numbers does not shift
 * the numbers used by another part. This gives common random numbers (CRN)
 * for paired strategy comparisons: the same seed produces the same audience
 * (seats, speeds, reaction times, types) regardless of the intervention.
 */

function splitmix32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class RNG {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spareNormal: number | null = null;

  constructor(seed: number, stream = 'main') {
    const sm = splitmix32((seed >>> 0) ^ hashString(stream));
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(this.rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = this.rotl(this.s3, 11);
    return result;
  }

  private rotl(x: number, k: number): number {
    return (x << k) | (x >>> (32 - k));
  }

  /** Uniform on [0,1). */
  random(): number {
    return this.nextU32() / 4294967296;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  int(n: number): number {
    return Math.floor(this.random() * n);
  }

  bernoulli(p: number): boolean {
    return this.random() < p;
  }

  /** Standard normal via Box-Muller (cached spare). */
  normal(mean = 0, sd = 1): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal;
      this.spareNormal = null;
      return mean + sd * v;
    }
    let u = 0;
    let v = 0;
    while (u <= 1e-12) u = this.random();
    v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }

  truncNormal(mean: number, sd: number, lo: number, hi: number): number {
    for (let i = 0; i < 100; i++) {
      const x = this.normal(mean, sd);
      if (x >= lo && x <= hi) return x;
    }
    return Math.min(hi, Math.max(lo, mean));
  }

  /** Lognormal parameterised by its MEDIAN and log-standard-deviation sigma. */
  lognormalMedian(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  exponential(rate: number): number {
    return -Math.log(1 - this.random()) / rate;
  }

  /** Gumbel(0,1) draw (used for multinomial-logit choice). */
  gumbel(): number {
    let u = this.random();
    if (u < 1e-12) u = 1e-12;
    return -Math.log(-Math.log(u));
  }

  /** Sample an index from (unnormalised) weights. */
  categorical(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    if (total <= 0) return this.int(weights.length);
    let r = this.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
}

/** Deterministic per-run seeds for a Monte Carlo batch. */
export function batchSeeds(baseSeed: number, n: number): number[] {
  const sm = splitmix32(baseSeed ^ 0x5bd1e995);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(sm() % 2147483647);
  return out;
}
