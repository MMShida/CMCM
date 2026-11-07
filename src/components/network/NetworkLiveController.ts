/**
 * Live driver for Model B (network simulation): steps the same headless engine used in batches,
 * writes one frame of circle positions (agents move along the network edges' polylines; queued
 * agents are laid out behind the door / stair they wait for), and keeps one snapshot per
 * simulated second for replay. Shared-clock mode: advanceTo(t).
 */
import type { GeometryData } from '../../geometry/types';
import { EXIT_GROUPS } from '../../geometry/types';
import { NetworkSimulation, PH } from '../../network/NetworkSimulation';
import type { NetAgent } from '../../network/NetworkSimulation';
import { ST } from '../../simulation/Agent';
import type { SimConfig } from '../../simulation/Params';
import type { Dyn, Frame } from '../MapRenderer';

export interface NetSnapshot {
  t: number;
  x: Float32Array;
  y: Float32Array;
  floor: Uint8Array;
  state: Uint8Array;
  stats: ReturnType<NetworkSimulation['liveStats']>;
  queue: Int32Array;
  passes: Int32Array;
}

export class NetworkLiveController {
  sim!: NetworkSimulation;
  running = false;
  speed = 5;
  frame!: Frame;
  snapshots: NetSnapshot[] = [];
  replay: number | null = null;
  version = 0;
  private acc = 0;
  /** detailed-link index -> network edge (feature edges only), for door/queue markers */
  private linkOfEdge: Int32Array = new Int32Array(0);
  private nDetailedLinks = 0;

  constructor(
    public geo: GeometryData,
    public cfg: SimConfig,
  ) {
    this.reset(cfg, geo);
  }

  reset(cfg: SimConfig, geo: GeometryData = this.geo) {
    this.cfg = cfg;
    this.geo = geo;
    this.sim = new NetworkSimulation(geo, cfg, cfg.seed);
    const n = this.sim.agents.length;
    this.frame = { n, x: new Float32Array(n), y: new Float32Array(n), floor: new Uint8Array(n), state: new Uint8Array(n), radius: new Float32Array(n) };
    this.sim.agents.forEach((a, i) => (this.frame.radius[i] = a.radius));
    const net = this.sim.net;
    this.nDetailedLinks = net.detailed.links.length;
    this.linkOfEdge = new Int32Array(net.edges.length).fill(-1);
    for (const E of net.edges) if (E.feature && E.links.length === 1) this.linkOfEdge[E.idx] = net.detailed.linkIndex.get(E.links[0]) ?? -1;
    this.snapshots = [];
    this.replay = null;
    this.acc = 0;
    this.running = false;
    this.writeFrame();
    this.takeSnapshot();
    this.version++;
  }

  private perLink(fromArcs: ArrayLike<number>): Int32Array {
    const out = new Int32Array(this.nDetailedLinks);
    const net = this.sim.net;
    for (let ai = 0; ai < net.arcs.length; ai++) {
      const li = this.linkOfEdge[net.arcs[ai].edge];
      if (li >= 0) out[li] += fromArcs[ai];
    }
    return out;
  }

  private takeSnapshot() {
    const f = this.frame;
    this.snapshots.push({
      t: this.sim.t,
      x: Float32Array.from(f.x),
      y: Float32Array.from(f.y),
      floor: Uint8Array.from(f.floor),
      state: Uint8Array.from(f.state),
      stats: this.sim.liveStats(),
      queue: this.perLink(this.sim.queues.map((q) => q.length)),
      passes: this.perLink(this.sim.passes),
    });
  }

  private stepEngine(): boolean {
    const before = Math.floor(this.sim.t + 1e-9);
    const wasFinished = this.sim.finished;
    this.sim.step();
    const crossed = Math.floor(this.sim.t + 1e-9) > before;
    if (crossed || (!wasFinished && this.sim.finished)) {
      this.writeFrame();
      this.takeSnapshot();
      return true;
    }
    return false;
  }

  /** standalone mode: advance by real elapsed time */
  tick(realDt: number): boolean {
    if (!this.running || this.replay !== null || this.sim.finished) return false;
    const dt = this.sim.opt.dt;
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= dt && steps < 200 && !this.sim.finished) {
      this.stepEngine();
      this.acc -= dt;
      steps++;
    }
    if (steps >= 200) this.acc = 0;
    if (this.sim.finished) this.running = false;
    this.writeFrame();
    if (steps) this.version++;
    return steps > 0;
  }

  /** shared-clock mode: advance until simulated time >= t */
  advanceTo(t: number): boolean {
    if (this.replay !== null) return false;
    let steps = 0;
    while (!this.sim.finished && this.sim.t + 1e-9 < t && steps < 5000) {
      this.stepEngine();
      steps++;
    }
    this.writeFrame();
    if (steps) this.version++;
    return steps > 0;
  }

  stepOnce() {
    this.stepEngine();
    this.writeFrame();
    this.version++;
  }

  /** positions: edges' polylines for walkers, queues laid out behind the arc they wait for */
  private writeFrame() {
    const sim = this.sim;
    const net = sim.net;
    const f = this.frame;
    const rank = new Map<number, number>();
    for (let ai = 0; ai < sim.queues.length; ai++) sim.queues[ai].forEach((id, k) => rank.set(id, k));
    const lost = new Map<number, number>();
    for (const n of sim.na) {
      const i = n.a.id;
      let [x, y, fl] = sim.position(n);
      if (n.phase === PH.QUEUE || n.phase === PH.STUCK) {
        const k = rank.get(i) ?? (lost.set(n.node, (lost.get(n.node) ?? 0) + 1), lost.get(n.node)!);
        [x, y] = this.queueSpot(n, k, x, y);
      }
      f.x[i] = x;
      f.y[i] = y;
      f.floor[i] = fl;
      f.state[i] = n.phase === PH.OUT ? (n.a.wheelchair ? ST.AWAITING_ASSIST : 10) : n.a.state;
    }
    void net;
  }

  private queueSpot(n: NetAgent, k: number, x: number, y: number): [number, number] {
    const net = this.sim.net;
    let dx = 0;
    let dy = 1;
    let lanes = 2;
    if (n.arc >= 0) {
      const A = net.arcs[n.arc];
      const E = net.edges[A.edge];
      if (E.kind === 'rowExit') {
        const s = this.geo.seats[n.a.seat];
        dx = s.x - x;
        dy = s.y - y;
        lanes = 1;
      } else {
        const p = A.dir === 1 ? E.pts[Math.min(1, E.pts.length - 1)] : E.pts[Math.max(0, E.pts.length - 2)];
        dx = x - p[0];
        dy = y - p[1];
        lanes = Math.max(1, Math.min(4, Math.floor(E.width / 0.5)));
      }
    }
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const row = Math.floor(k / lanes);
    const col = (k % lanes) - (lanes - 1) / 2;
    return [x + dx * (0.35 + 0.46 * row) - dy * col * 0.46, y + dy * (0.35 + 0.46 * row) + dx * col * 0.46];
  }

  currentFrame(): Frame {
    if (this.replay !== null) {
      const s = this.snapshots[Math.min(this.replay, this.snapshots.length - 1)];
      return { n: s.x.length, x: s.x, y: s.y, floor: s.floor, state: s.state, radius: this.frame.radius };
    }
    return this.frame;
  }

  currentStats() {
    if (this.replay !== null) return this.snapshots[Math.min(this.replay, this.snapshots.length - 1)].stats;
    return this.sim.liveStats();
  }

  /** marker data for the shared renderer (closed doors, barriers, queues, exit counters) */
  dyn(selected: number, showQueues: boolean): Dyn {
    const sim = this.sim;
    const net = sim.net;
    const closed = new Uint8Array(this.nDetailedLinks);
    const barrier = new Uint8Array(this.nDetailedLinks);
    for (const e of sim.closed) for (const id of net.edges[e].links) closed[net.detailed.linkIndex.get(id)!] = 1;
    for (const e of sim.barrierEdges) for (const id of net.edges[e].links) barrier[net.detailed.linkIndex.get(id)!] = 1;
    const snap = this.replay !== null ? this.snapshots[Math.min(this.replay, this.snapshots.length - 1)] : null;
    return {
      closed,
      barrier,
      queue: showQueues ? (snap ? snap.queue : this.perLink(sim.queues.map((q) => q.length))) : undefined,
      passes: snap ? snap.passes : this.perLink(sim.passes),
      cms: this.cfg.crowdManagers.count === 0 ? [] : this.cmMarkers(),
      selected,
    };
  }

  private cmMarkers() {
    const C = this.cfg.crowdManagers;
    const n = C.count < 0 ? Math.ceil(this.sim.agents.length / 250) : C.count;
    return this.geo.crowdManagerPosts
      .filter((p) => !C.unavailable.includes(p.id))
      .slice(0, n)
      .map((p) => ({ x: p.x, y: p.y, floor: p.floor, active: true, id: p.id }));
  }

  findAgentAt(x: number, y: number, floor: number, maxDist = 0.8): number {
    const f = this.currentFrame();
    let best = -1;
    let bd = maxDist;
    for (let i = 0; i < f.n; i++) {
      if (f.floor[i] !== floor || f.state[i] === 10 || f.state[i] === ST.AWAITING_ASSIST) continue;
      const d = Math.hypot(f.x[i] - x, f.y[i] - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** human-readable description of an agent (inspector) */
  describe(i: number): [string, string][] {
    const n = this.sim.na[i];
    if (!n) return [];
    const a = n.a;
    const net = this.sim.net;
    const seat = this.geo.seats[a.seat];
    const phase = ['seated', 'walking along the row', 'queuing', 'walking an edge', 'left the building', 'stuck / trapped'][n.phase];
    const g = n.exitGroup >= 0 ? EXIT_GROUPS[n.exitGroup] : '-';
    return [
      ['Agent', `#${a.id} (${a.type}${a.elderly ? ', older' : ''}${a.wheelchair ? ', wheelchair' : ''})`],
      ['Seat', `${seat.id} (${seat.zone})`],
      ['Free speed', `${a.v0.toFixed(2)} m/s${n.vEff < a.v0 ? ` (group pace ${n.vEff.toFixed(2)})` : ''}`],
      ['Reaction (recognition / response / prep)', `${a.tRecognition.toFixed(1)} / ${a.tResponse.toFixed(1)} / ${a.tPrepare.toFixed(1)} s`],
      ['Phase', phase],
      ['Exit group', g],
      ['At node', n.node >= 0 ? net.nodes[n.node].id : '-'],
      ['Edge', n.arc >= 0 ? net.edges[net.arcs[n.arc].edge].label : '-'],
      ['Next edges', n.path.slice(n.pathPos, n.pathPos + 5).map((ai) => net.edges[net.arcs[ai].edge].label).join(' > ') || '-'],
      ['Guidance (CM / LED)', `${a.cmGroup >= 0 ? EXIT_GROUPS[a.cmGroup] : '-'} / ${a.ledGroup >= 0 ? EXIT_GROUPS[a.ledGroup] : '-'}`],
      ['Queue time so far', `${n.waitTotal.toFixed(1)} s`],
      ['Re-routes', String(n.reroutes)],
      ['Started / left', `${Number.isFinite(a.tStartMove) ? a.tStartMove.toFixed(1) : '-'} / ${Number.isFinite(n.tLeft) ? n.tLeft.toFixed(1) : '-'} s`],
    ];
  }
}
