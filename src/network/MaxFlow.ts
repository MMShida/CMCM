/**
 * Maximum flow / minimum cut (Dinic's algorithm, a strongly-polynomial refinement of
 * Ford-Fulkerson: augmenting along shortest residual paths in blocking-flow phases).
 *
 * The network is stored in flat, growable typed arrays so that the time-expanded network
 * (Model C) can be extended one time layer at a time while keeping the current flow
 * (incremental augmentation). Arc e and its reverse arc e^1 are always stored as a pair.
 *
 *   max  sum_{e out of s} f_e   s.t.  0 <= f_e <= c_e,  flow conservation at v != s,t
 *
 * Max-flow = min-cut (Ford & Fulkerson 1956): after termination, the set S of nodes
 * reachable from s in the residual graph defines a cut (S, V\S) whose capacity equals the
 * flow value. `minCut()` returns the saturated arcs crossing that cut.
 */

const EPS = 1e-9;

export class FlowNetwork {
  n = 0;
  m = 0;
  head: Int32Array;
  next: Int32Array;
  to: Int32Array;
  cap: Float64Array;
  /** original capacity (for reporting flows and cuts) */
  cap0: Float64Array;
  /** caller-defined tag per arc (e.g. physical edge index), -1 = none */
  tag: Int32Array;
  private level: Int32Array;
  private it: Int32Array;

  constructor(nodeHint = 16, arcHint = 64) {
    this.head = new Int32Array(nodeHint).fill(-1);
    this.level = new Int32Array(nodeHint);
    this.it = new Int32Array(nodeHint);
    this.next = new Int32Array(arcHint);
    this.to = new Int32Array(arcHint);
    this.cap = new Float64Array(arcHint);
    this.cap0 = new Float64Array(arcHint);
    this.tag = new Int32Array(arcHint);
  }

  addNode(): number {
    if (this.n >= this.head.length) {
      const L = this.head.length * 2;
      const h = new Int32Array(L).fill(-1);
      h.set(this.head);
      this.head = h;
      this.level = new Int32Array(L);
      this.it = new Int32Array(L);
    }
    return this.n++;
  }

  addNodes(k: number): number {
    const first = this.n;
    for (let i = 0; i < k; i++) this.addNode();
    return first;
  }

  private growArcs() {
    const L = this.to.length * 2;
    const g = <T extends Int32Array | Float64Array>(a: T, C: new (n: number) => T): T => {
      const b = new C(L);
      b.set(a);
      return b;
    };
    this.next = g(this.next, Int32Array);
    this.to = g(this.to, Int32Array);
    this.cap = g(this.cap, Float64Array);
    this.cap0 = g(this.cap0, Float64Array);
    this.tag = g(this.tag, Int32Array);
  }

  /** Add arc u->v with capacity c (and its zero-capacity reverse). Returns the arc index. */
  addArc(u: number, v: number, c: number, tag = -1): number {
    if (this.m + 2 > this.to.length) this.growArcs();
    const e = this.m;
    this.to[e] = v;
    this.cap[e] = c;
    this.cap0[e] = c;
    this.tag[e] = tag;
    this.next[e] = this.head[u];
    this.head[u] = e;
    this.to[e + 1] = u;
    this.cap[e + 1] = 0;
    this.cap0[e + 1] = 0;
    this.tag[e + 1] = -1;
    this.next[e + 1] = this.head[v];
    this.head[v] = e + 1;
    this.m += 2;
    return e;
  }

  /** flow currently carried by arc e (forward arcs only) */
  flow(e: number): number {
    return this.cap0[e] - this.cap[e];
  }

  /** tail node of arc e */
  from(e: number): number {
    return this.to[e ^ 1];
  }

  private bfs(s: number, t: number): boolean {
    const level = this.level;
    level.fill(-1, 0, this.n);
    const q = new Int32Array(this.n);
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    level[s] = 0;
    while (qh < qt) {
      const u = q[qh++];
      for (let e = this.head[u]; e >= 0; e = this.next[e]) {
        const v = this.to[e];
        if (this.cap[e] > EPS && level[v] < 0) {
          level[v] = level[u] + 1;
          if (v === t) return true;
          q[qt++] = v;
        }
      }
    }
    return level[t] >= 0;
  }

  /** iterative blocking-flow DFS (no recursion limit on long time-expanded paths) */
  private augment(s: number, t: number, limit: number): number {
    const level = this.level;
    const it = this.it;
    const stackE: number[] = [];
    let u = s;
    let pushed = 0;
    while (pushed < limit - EPS) {
      if (u === t) {
        let f = limit - pushed;
        for (const e of stackE) f = Math.min(f, this.cap[e]);
        for (const e of stackE) {
          this.cap[e] -= f;
          this.cap[e ^ 1] += f;
        }
        pushed += f;
        // retreat to the first saturated arc
        let k = 0;
        while (k < stackE.length && this.cap[stackE[k]] > EPS) k++;
        stackE.length = k;
        u = k === 0 ? s : this.to[stackE[k - 1]];
        continue;
      }
      let e = it[u];
      while (e >= 0 && !(this.cap[e] > EPS && level[this.to[e]] === level[u] + 1)) e = this.next[e];
      it[u] = e;
      if (e >= 0) {
        stackE.push(e);
        u = this.to[e];
      } else {
        // dead end: remove u from the level graph and retreat
        level[u] = -1;
        if (stackE.length === 0) break;
        const back = stackE.pop()!;
        u = this.to[back ^ 1];
        it[u] = this.next[it[u]];
      }
    }
    return pushed;
  }

  /** Augment the current flow to a maximum s-t flow; returns the flow ADDED by this call. */
  maxflow(s: number, t: number, limit = Infinity): number {
    let total = 0;
    while (total < limit - EPS && this.bfs(s, t)) {
      for (let u = 0; u < this.n; u++) this.it[u] = this.head[u];
      const f = this.augment(s, t, limit - total);
      if (f <= EPS) break;
      total += f;
    }
    return total;
  }

  /** source side of the minimum cut: nodes reachable from s in the residual graph */
  sourceSide(s: number): Uint8Array {
    const seen = new Uint8Array(this.n);
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const u = st.pop()!;
      for (let e = this.head[u]; e >= 0; e = this.next[e])
        if (this.cap[e] > EPS && !seen[this.to[e]]) {
          seen[this.to[e]] = 1;
          st.push(this.to[e]);
        }
    }
    return seen;
  }

  /** forward arcs from S to V\S (all saturated at a maximum flow) */
  minCut(s: number): number[] {
    const side = this.sourceSide(s);
    const out: number[] = [];
    for (let e = 0; e < this.m; e += 2) if (side[this.to[e ^ 1]] && !side[this.to[e]]) out.push(e);
    return out;
  }
}
