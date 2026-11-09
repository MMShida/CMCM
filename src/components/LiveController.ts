import {PlusSimulation} from '../plus/PlusSimulation';
/**
 * Drives a live simulation for the UI: fixed-step engine updates decoupled from
 * the render rate, linear interpolation between the last two engine states for
 * smooth motion, and one snapshot per simulated second for the replay slider.
 * The engine is exactly the same one used headlessly (no separate animation logic).
 */
import type { GeometryData } from '../geometry/types';
import { ST } from '../simulation/Agent';
import type { SimConfig } from '../simulation/Params';
import { planExitIndex, seatPlanKeys } from '../simulation/Plan';
import { LiteSimulation } from '../lite/LiteSimulation';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { computeField } from '../geometry/NavigationGraph';
import { EXIT_GROUPS } from '../geometry/types';
import type { Dyn, Frame } from './MapRenderer';
import {walkwayPoint} from './WalkwayInterpolation';

export interface Snapshot {
  t: number;
  x: Float32Array;
  y: Float32Array;
  floor: Uint8Array;
  state: Uint8Array;
  stats: ReturnType<SimulationEngine['liveStats']>;
}

export class LiveController {
  sim!: SimulationEngine;
  running = false;
  speed = 5;
  private acc = 0;
  private prevX!: Float32Array;
  private prevY!: Float32Array;
  private prevFloor!: Uint8Array;
  private prevLink!: Int32Array;
  private prevS!: Float64Array;
  private prevLat!: Float64Array;
  private framePoint = new Float64Array(2);
  frame!: Frame;
  snapshots: Snapshot[] = [];
  replay: number | null = null;
  version = 0;
  /** flows: passes per exit group in the last 10 s */
  private passHistory: Int32Array[] = [];
  heatMode: 'off' | 'current' | 'peak' = 'off';
  private curHeat: Float32Array[] = [];
  /** links carrying LED strips (guided paths of every zone) */
  ledLinks: { pts: [number, number][]; floor: number }[] = [];

  constructor(
    public geo: GeometryData,
    public cfg: SimConfig,
    public model: 'A' | 'Lite' | 'Plus' = 'A',
  ) {
    this.reset(cfg, geo);
  }

  reset(cfg: SimConfig, geo: GeometryData = this.geo) {
    this.cfg = cfg;
    this.geo = geo;
    this.sim = this.model === 'Plus' ? new PlusSimulation(geo,cfg,cfg.seed) : this.model === 'Lite' ? new LiteSimulation(geo, cfg, cfg.seed) : new SimulationEngine(geo, cfg, cfg.seed);
    const n = this.sim.agents.length;
    this.prevX = new Float32Array(n);
    this.prevY = new Float32Array(n);
    this.prevFloor = new Uint8Array(n);
    this.prevLink = new Int32Array(n);
    this.prevS = new Float64Array(n);
    this.prevLat = new Float64Array(n);
    this.frame = { n, x: new Float32Array(n), y: new Float32Array(n), floor: new Uint8Array(n), state: new Uint8Array(n), radius: new Float32Array(n) };
    this.sim.agents.forEach((a, i) => (this.frame.radius[i] = a.radius));
    this.capturePrev();
    this.snapshots = [];
    this.passHistory = [];
    this.replay = null;
    this.acc = 0;
    this.running = false;
    this.takeSnapshot();
    this.writeFrame(1);
    this.ledLinks = cfg.led.enabled && !cfg.led.spatial ? this.computeLedLinks() : [];
    this.version++;
  }

  /** Representative planned routes for each block (display only). */
  private computeLedLinks() {
    const sim = this.sim;
    const g = sim.graph;
    const closed = new Set([...sim.blockedLinks, ...sim.barrierLinks]);
    const fields = g.safeByGroup.map((t) => computeField(g, t, (li) => g.links[li].prohibited || (this.cfg.led.dynamic && closed.has(li)) || sim.barrierLinks.includes(li)));
    const used = new Set<number>();
    const seen = new Set<string>();
    for (let si=0;si<this.geo.seats.length;si++) {
      const key=seatPlanKeys(this.geo,si)[0];if(seen.has(key))continue;seen.add(key);
      const gi = planExitIndex(this.cfg.led.plan,this.geo,si);
      const seat = this.geo.seats[si];
      if (gi < 0) continue;
      const L = g.links[g.linkByIdOrThrow(seat.link)];
      const f = fields[gi];
      let node = [L.a, L.b].filter((n) => g.nodes[n].kind !== 'deadEnd').sort((x, y) => f.dist[x] - f.dist[y])[0];
      for (let hop = 0; hop < 80 && node !== undefined; hop++) {
        const k = f.next[node];
        if (k < 0) break;
        const e = g.adj[node][k];
        if (!g.links[e.link].exterior) used.add(e.link);
        else break;
        node = e.other;
      }
    }
    return [...used].map((li) => {
      const L = g.links[li];
      return { pts: Array.from(L.xs, (x, i) => [x, L.ys[i]] as [number, number]), floor: L.floor === 2 ? 2 : 1 };
    });
  }

  private capturePrev() {
    const A = this.sim.agents;
    for (let i = 0; i < A.length; i++) {
      this.prevX[i] = A[i].x;
      this.prevY[i] = A[i].y;
      this.prevFloor[i] = A[i].floor;
      const a=A[i];this.prevLink[i]=a.link;
      this.prevS[i]=a.link>=0&&a.dir<0?this.sim.graph.links[a.link].len-a.sDir:a.sDir;
      this.prevLat[i]=a.latOffset;
    }
  }

  private takeSnapshot() {
    const A = this.sim.agents;
    const n = A.length;
    const s: Snapshot = { t: this.sim.t, x: new Float32Array(n), y: new Float32Array(n), floor: new Uint8Array(n), state: new Uint8Array(n), stats: this.sim.liveStats() };
    for (let i = 0; i < n; i++) {
      s.x[i] = A[i].x;
      s.y[i] = A[i].y;
      s.floor[i] = A[i].floor;
      s.state[i] = A[i].state;
    }
    this.snapshots.push(s);
    this.passHistory.push(Int32Array.from(this.sim.gates.passes));
  }

  /** Advance by real elapsed time (s). Returns true if the engine stepped. */
  tick(realDt: number): boolean {
    if (!this.running || this.replay !== null || this.sim.finished) return false;
    const dt = this.cfg.movement.dt;
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    const maxSteps = 120;
    while (this.acc >= dt && steps < maxSteps && !this.sim.finished) {
      this.capturePrev();
      const before = Math.floor(this.sim.t + 1e-9);
      this.sim.step();
      if (Math.floor(this.sim.t + 1e-9) > before) this.takeSnapshot();
      this.acc -= dt;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    if (this.sim.finished) {
      this.running = false;
      this.takeSnapshot();
    }
    this.writeFrame(Math.min(1, this.acc / dt));
    if (steps) this.version++;
    return steps > 0;
  }

  stepOnce() {
    this.capturePrev();
    const before = Math.floor(this.sim.t + 1e-9);
    this.sim.step();
    if (Math.floor(this.sim.t + 1e-9) > before || this.sim.finished) this.takeSnapshot();
    this.writeFrame(1);
    this.version++;
  }

  /** Shared-clock mode (model comparison): advance the engine until simulated time >= t. */
  advanceTo(t: number): boolean {
    if (this.replay !== null) return false;
    let steps = 0;
    const wasFinished = this.sim.finished;
    while (!this.sim.finished && this.sim.t + 1e-9 < t && steps < 5000) {
      this.capturePrev();
      const before = Math.floor(this.sim.t + 1e-9);
      this.sim.step();
      if (Math.floor(this.sim.t + 1e-9) > before) this.takeSnapshot();
      steps++;
    }
    if (!wasFinished && this.sim.finished) this.takeSnapshot();
    this.writeFrame(1);
    if (steps) this.version++;
    return steps > 0;
  }

  private writeFrame(alpha: number) {
    const A = this.sim.agents;
    const f = this.frame;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      const s=a.link>=0&&a.dir<0?this.sim.graph.links[a.link].len-a.sDir:a.sDir;
      if(this.prevFloor[i]===a.floor&&walkwayPoint(this.sim.graph,this.prevLink[i],a.link,this.prevS[i],s,this.prevLat[i],a.latOffset,alpha,this.framePoint)){
        f.x[i]=this.framePoint[0];f.y[i]=this.framePoint[1];
      } else if (this.prevFloor[i] === a.floor) {
        f.x[i] = this.prevX[i] + (a.x - this.prevX[i]) * alpha;
        f.y[i] = this.prevY[i] + (a.y - this.prevY[i]) * alpha;
      } else {
        f.x[i] = a.x;
        f.y[i] = a.y;
      }
      f.floor[i] = a.floor;
      f.state[i] = a.state === ST.OUTSIDE ? 10 : a.state;
    }
  }

  /** Frame to render (live interpolated or a replay snapshot). */
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

  /** persons through each exit group in the last `window` seconds */
  recentFlows(window = 10): number[] {
    const g = this.sim.graph;
    const H = this.passHistory;
    const idx = this.replay ?? H.length - 1;
    if (idx < 1) return new Array(7).fill(0);
    const a = H[idx];
    const b = H[Math.max(0, idx - window)];
    const out = new Array(7).fill(0);
    for (const L of g.links) if (L.exterior && L.exitGroup >= 0) out[L.exitGroup] += a[L.idx] - b[L.idx];
    return out.map((v) => v / Math.min(window, idx));
  }

  dyn(selected: number, showQueues: boolean): Dyn {
    const sim = this.sim;
    const dyn: Dyn = {
      closed: sim.movement.closed,
      barrier: (() => {
        const b = new Uint8Array(sim.graph.links.length);
        for (const li of sim.barrierLinks) b[li] = 1;
        return b;
      })(),
      rope: Uint8Array.from(sim.graph.links,L=>sim.cfg.barriers.includes(L.id)&&sim.cfg.barrierTypes?.[L.id]==='soft-rope'?1:0),
      queue: showQueues && this.replay === null ? sim.gates.queueNow : undefined,
      passes: this.replay === null ? sim.gates.passes : this.passHistory[this.replay],
      cms: sim.guidance.cms.map((c) => ({ x: c.post.x, y: c.post.y, floor: c.post.floor, active: sim.t >= c.tActive, id: c.post.id })),
      selected,
      ledOn: this.cfg.led.enabled && sim.guidance.ledActive,
      ledLinks: this.ledLinks,
      signs: this.sim instanceof PlusSimulation ? [] : this.cfg.led.spatial?.signs,
    };
    if (this.heatMode === 'peak') {
      dyn.heats = sim.heat.map((h) => ({ x0: h.x0, y0: h.y0, cell: h.cell, nx: h.nx, ny: h.ny, data: h.maxD }));
    } else if (this.heatMode === 'current') {
      dyn.heats = sim.heat.map((h, f) => {
        if (!this.curHeat[f] || this.curHeat[f].length !== h.nx * h.ny) this.curHeat[f] = new Float32Array(h.nx * h.ny);
        const buf = this.curHeat[f];
        buf.fill(0);
        for (const a of sim.agents) {
          if (a.link < 0 || a.floor !== f + 1) continue;
          const k = h.index(a.x, a.y);
          if (k >= 0 && a.densityHere > buf[k]) buf[k] = a.densityHere;
        }
        return { x0: h.x0, y0: h.y0, cell: h.cell, nx: h.nx, ny: h.ny, data: buf };
      });
    }
    if (selected >= 0 && this.replay === null) {
      const a = sim.agents[selected];
      if (a && a.pathValid) {
        const fl = (ni: number) => sim.nodeFloorDisp[ni];
        const pts: [number, number, number][] = [[a.x, a.y, a.floor]];
        for (let i = a.pathPos; i < a.pathNodes.length; i++) {
          const n = sim.graph.nodes[a.pathNodes[i]];
          pts.push([n.x, n.y, fl(a.pathNodes[i])]);
        }
        const last = a.pathNodes[a.pathNodes.length - 1];
        const e = sim.graph.adj[last]?.[a.pathAdj[a.pathAdj.length - 1]];
        if (e) pts.push([sim.graph.nodes[e.other].x, sim.graph.nodes[e.other].y, fl(e.other)]);
        dyn.selectedPath = pts;
      }
    }
    return dyn;
  }

  findAgentAt(x: number, y: number, floor: number, maxDist = 0.8): number {
    const f = this.currentFrame();
    let best = -1;
    let bd = maxDist;
    for (let i = 0; i < f.n; i++) {
      if (f.floor[i] !== floor || f.state[i] === ST.EXITED) continue;
      const d = Math.hypot(f.x[i] - x, f.y[i] - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}
