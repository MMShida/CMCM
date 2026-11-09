/**
 * Headless, deterministic simulation engine (independent of React / rendering).
 *
 * Time advances in fixed steps dt (default 0.1 s). Per step:
 *   1. guidance (Crowd Managers broadcast once per second, LED activation)
 *   2. social influence (every 0.5 s) and the pre-movement state machine
 *   3. agents that are ready step from their seat into the row (gap acceptance)
 *   4. movement on links, gate admission and node transitions (Movement.ts)
 *   5. positions, density metrics, heat map, per-second time series
 * The whole state is a function of (geometry, config, seed), so the run is reproducible and
 * the update is Markovian in the full system state (Monte Carlo samples this chain).
 */
import type { Field } from '../geometry/NavigationGraph';
import { NavGraph, computeField } from '../geometry/NavigationGraph';
import type { GeometryData } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { Agent } from './Agent';
import { ST } from './Agent';
import { updatePremovement, updateSocialPhi } from './Behavior';
import { DensityField, HeatGrid } from './Congestion';
import type { DensityResult, HeatItem } from './DensityRegions';
import { DensityRecorder, buildRegions } from './DensityRegions';
import type { ManagerSummary } from './ManagerPolicy';
import { summarizeManagers } from './ManagerPolicy';
import { GuidanceSystem } from './Guidance';
import { MetricsRecorder, buildResult } from './Metrics';
import type { RunResult } from './Metrics';
import { MovementSystem } from './Movement';
import type { MovementObserver } from './MovementObserver';
import type { SimConfig } from './Params';
import { hardPanelIds } from './Barriers';
import { createPopulation } from './Population';
import { GateSystem, effectiveSpeedFactor } from './QueueSystem';
import { RNG } from './Random';
import { RouteSystem } from './Routing';

const graphCache = new WeakMap<GeometryData, NavGraph>();
export function graphFor(geo: GeometryData, laneWidth = 0.6): NavGraph {
  let g = graphCache.get(geo);
  if (!g || (g as any).__lane !== laneWidth) {
    g = new NavGraph(geo, laneWidth);
    (g as any).__lane = laneWidth;
    graphCache.set(geo, g);
  }
  return g;
}

export interface TraversalEvent {
  agent: number;
  from: number;
  to: number;
  t: number;
}

/** Optional model factories. Absent factories preserve the historical engines. */
export interface EngineExtensions {
  movement?: (sim: SimulationEngine) => MovementSystem;
  routing?: (sim: SimulationEngine) => RouteSystem;
  guidance?: (sim: SimulationEngine) => GuidanceSystem;
}

const GRID = { x0: -32, y0: -26, cell: 3, nx: 22, ny: 25 };

export class SimulationEngine {
  readonly geo: GeometryData;
  readonly graph: NavGraph;
  readonly cfg: SimConfig;
  readonly seed: number;
  readonly agents: Agent[];
  readonly groups: number[][];
  readonly groupBroken: Uint8Array;
  readonly groupWaitSince: Float64Array;
  readonly seatLink: Int32Array;
  readonly nodeFloorDisp: Int8Array;
  readonly rngDyn: RNG;
  readonly rngRoute: RNG;
  readonly gates: GateSystem;
  readonly density: DensityField;
  readonly movement: MovementSystem;
  readonly routing: RouteSystem;
  readonly guidance: GuidanceSystem;
  readonly metrics: MetricsRecorder;
  readonly heat: HeatGrid[];
  readonly visibilityRange: number;
  readonly envSpeed: number;
  readonly blockedLinks: number[];
  readonly barrierLinks: number[];
  t = 0;
  steps = 0;
  doneCount = 0;
  gridlock = false;
  finished = false;
  lastProgress = 0;
  traceHook: ((e: TraversalEvent) => void) | null = null;
  movementObserver: MovementObserver | null = null;
  /** true on steps where slowly varying quantities (group cohesion) are refreshed */
  cohesionTick = true;
  private densAcc = 0;
  private cohesionAcc = 0;
  private groupAcc = 0;
  /** time each assisting team is next free (wheelchair users) */
  private assistFree: number[] = [];
  private readonly rngAssist: RNG;
  private rowWaiting: number[] = [];
  private socialAcc = 0;
  private secondAcc = 0;
  private gridAcc = 0;
  private nearClosed: number[][];
  private nearSigns: number[][];
  /** junctions where a route decision is possible (>= 3 non-row links) */
  readonly decisionNode: Uint8Array;
  private staffFieldCache = new Map<string, Field[]>();
  private nominalFieldCache: Field[] | null = null;
  /** density measurement: region of every navigation link (-1 = not measured), recorder, heat-map links */
  readonly regionOfLink: Int16Array;
  readonly densityRec: DensityRecorder;
  private readonly heatLinks: number[];
  private lastDensitySample = -1;
  private staffAffected: Uint8Array;
  private gridHead: Int32Array;
  private gridNext: Int32Array;
  private wallStart = 0;

  constructor(geo: GeometryData, cfg: SimConfig, seed?: number, movementFactory?: (sim: SimulationEngine) => MovementSystem, extensions: EngineExtensions = {}) {
    this.geo = geo;
    this.cfg = cfg;
    this.seed = seed ?? cfg.seed;
    this.graph = graphFor(geo, cfg.movement.laneWidth);
    const g = this.graph;
    this.nodeFloorDisp = Int8Array.from(g.nodes.map((n) => (n.floor === 2 ? 2 : 1)));
    const pop = createPopulation(geo, cfg, this.seed);
    this.agents = pop.agents;
    this.groups = pop.groups;
    this.groupBroken = new Uint8Array(this.groups.length);
    this.groupWaitSince = new Float64Array(this.groups.length).fill(NaN);
    this.seatLink = Int32Array.from(this.agents.map((a) => g.linkByIdOrThrow(geo.seats[a.seat].link)));
    this.rngDyn = new RNG(this.seed, 'dynamics');
    this.rngRoute = new RNG(this.seed, 'routing');
    this.rngAssist = new RNG(this.seed, 'assist');
    this.envSpeed = effectiveSpeedFactor(cfg);
    this.visibilityRange = cfg.routing.visibilityRange * (cfg.environment.darkness ? 0.4 : 1) * (1 - 0.7 * Math.min(1, cfg.environment.smoke));
    this.gates = new GateSystem(g, cfg);
    const resp = cfg.stress.responders?.links ?? [];
    if (resp.length) this.gates.setResponderLinks(resp.map((id) => g.linkByIdOrThrow(id)));
    this.density = new DensityField(g);
    this.movement = extensions.movement ? extensions.movement(this) : movementFactory ? movementFactory(this) : new MovementSystem(this);
    this.routing = extensions.routing ? extensions.routing(this) : new RouteSystem(this);
    this.metrics = new MetricsRecorder(this);
    this.heat = [new HeatGrid(-30, -26, 1, 60, 70), new HeatGrid(-30, -26, 1, 60, 50)];
    this.gridHead = new Int32Array(2 * GRID.nx * GRID.ny).fill(-1);
    this.gridNext = new Int32Array(this.agents.length).fill(-1);

    // physical closures
    this.blockedLinks = cfg.blocked.links.map((id) => g.linkByIdOrThrow(id));
    this.barrierLinks = hardPanelIds(cfg).map((id) => g.linkByIdOrThrow(id));
    for (const li of [...this.blockedLinks, ...this.barrierLinks]) this.movement.closed[li] = 1;
    this.staffAffected = this.computeStaffAffected();
    // density regions (geometry links -> regions) and the recorder (no effect on behaviour)
    const regions = buildRegions(geo, cfg);
    this.regionOfLink = Int16Array.from(g.links, (L) => regions.byLink.get(L.id) ?? -1);
    this.heatLinks = g.links.filter((L) => !L.isRow && !L.prohibited && L.kind !== 'outdoor').map((L) => L.idx);
    const heatItems: HeatItem[] | null = cfg.analysis?.keepSeries
      ? this.heatLinks.map((li) => {
          const L = g.links[li];
          const G = geo.links.find((x) => x.id === L.id)!;
          return { id: L.id, floor: L.floor === 2 ? 2 : L.floor === 0 ? 0 : 1, pts: G.pts, area: Math.max(0.05, L.len * L.width), region: this.regionOfLink[li] };
        })
      : null;
    this.densityRec = new DensityRecorder(regions, cfg, heatItems);
    this.guidance = extensions.guidance ? extensions.guidance(this) : new GuidanceSystem(this);

    this.decisionNode = Uint8Array.from(g.nodes.map((_, ni) => (g.adj[ni].filter((e) => !g.links[e.link].isRow).length >= 3 ? 1 : 0)));
    // obstruction visibility (discovery range) and exit-sign visibility per node
    this.nearClosed = g.nodes.map(() => []);
    this.nearSigns = g.nodes.map(() => []);
    const closed = [...this.blockedLinks, ...this.barrierLinks];
    g.nodes.forEach((n, ni) => {
      const fl = this.nodeFloorDisp[ni];
      for (const li of closed) {
        const L = g.links[li];
        const pa = g.nodes[L.a];
        const pb = g.nodes[L.b];
        const d = Math.min(Math.hypot(pa.x - n.x, pa.y - n.y), Math.hypot(pb.x - n.x, pb.y - n.y));
        if (d <= cfg.blocked.discoveryRange && (this.nodeFloorDisp[L.a] === fl || this.nodeFloorDisp[L.b] === fl)) this.nearClosed[ni].push(li);
      }
    });
    const signNodes: number[][] = EXIT_GROUPS.map(() => []);
    for (const L of g.links) {
      if (L.exterior && L.exitGroup >= 0) signNodes[L.exitGroup].push(L.a);
      if (/^SD[WE]$/.test(L.id)) signNodes[L.id === 'SDW' ? 3 : 4].push(L.a);
      if (/^BND[WE]$/.test(L.id)) signNodes[L.id === 'BNDW' ? 5 : 6].push(L.a);
    }
    g.nodes.forEach((n, ni) => {
      signNodes.forEach((arr, gi) => {
        for (const sn of arr) {
          const s = g.nodes[sn];
          if (this.nodeFloorDisp[sn] === this.nodeFloorDisp[ni] && Math.hypot(s.x - n.x, s.y - n.y) <= cfg.routing.noticeRange) {
            this.nearSigns[ni].push(gi);
            break;
          }
        }
      });
    });

    if (this.blockedLinks.length && cfg.blocked.knowledge === 'immediate') for (const a of this.agents) for (const li of this.blockedLinks) this.routing.learnBlocked(a, li);

    // separated group members start in the foyer / corridor (stress test)
    const standLinks = g.links.filter((L) => (L.kind === 'foyer' || L.kind === 'corridor') && L.floor === 1 && !L.barrierSlot && L.len > 1.5).map((L) => L.idx);
    const placeRng = new RNG(this.seed, 'placement');
    for (const a of this.agents) {
      if (!a.separated || a.group < 0) continue;
      const slot = this.movement.seatSlot[a.id];
      if (slot >= 0) this.movement.rowSeatAgent[this.seatLink[a.id]][slot] = -1;
      let placed = false;
      for (let tries = 0; tries < 30 && !placed; tries++) {
        const li = standLinks[placeRng.int(standLinks.length)];
        const L = g.links[li];
        placed = this.movement.placeAt(a, li, placeRng.random() < 0.5 ? 1 : -1, placeRng.uniform(0.3, L.len - 0.3));
      }
      if (!placed) {
        a.separated = false;
        continue;
      }
      const leader = this.agents[this.groups[a.group][0]];
      const lli = this.seatLink[leader.id];
      const LL = g.links[lli];
      const seat = geo.seats[leader.seat];
      const endA = g.nodes[LL.a].kind === 'deadEnd' ? Infinity : seat.s;
      const endB = g.nodes[LL.b].kind === 'deadEnd' ? Infinity : LL.len - seat.s;
      a.meetNode = endA <= endB ? LL.a : LL.b;
      a.knownExits |= 1;
    }
    this.movement.updatePositions(this.cfg.movement.dt);
    this.rebuildGrid();
    updateSocialPhi(this);
    this.metrics.sample();
    this.sampleDensity();
  }

  // ------------------------------------------------------------------------------------
  // main loop
  // ------------------------------------------------------------------------------------
  step(): void {
    if (this.finished) return;
    const dt = this.cfg.movement.dt;
    this.t = Math.round((this.t + dt) * 1e6) / 1e6;
    this.steps++;
    this.guidance.step(dt);
    this.socialAcc += dt;
    if (this.socialAcc >= 0.5 - 1e-9) {
      this.socialAcc = 0;
      updateSocialPhi(this);
    }
    updatePremovement(this, dt);
    this.groupTimeouts();
    // seat -> row entry
    if (this.rowWaiting.length) {
      const still: number[] = [];
      for (const id of this.rowWaiting) {
        const a = this.agents[id];
        if (a.link >= 0 || a.done) continue;
        if (!this.movement.tryEnterRow(a)) still.push(id);
        else this.guidance.ledPerceive(a);
      }
      this.rowWaiting = still;
    }
    // group cohesion caps are refreshed every 0.5 s of simulated time (dt-independent)
    this.cohesionAcc += dt;
    this.cohesionTick = this.cohesionAcc >= 0.5 - 1e-9 || this.steps === 1;
    if (this.cohesionTick) this.cohesionAcc = 0;
    this.movement.step(dt);
    this.gates.finishStep();
    for (const a of this.agents) if (a.rerouteFlash > 0) a.rerouteFlash -= dt;
    const G = this.gates;
    for (let i = 0; i < G.queueNow.length; i++) if (G.queueNow[i] > G.queueMax[i]) G.queueMax[i] = G.queueNow[i];
    this.movement.updatePositions(dt);
    this.densAcc += dt;
    if (this.densAcc >= 0.5 - 1e-9) {
      this.metrics.densityStep(this.densAcc);
      this.densAcc = 0;
    }
    this.gridAcc += dt;
    if (this.gridAcc >= 0.5 - 1e-9) {
      this.gridAcc = 0;
      this.rebuildGrid();
      this.shareInformation(0.5);
    }
    this.secondAcc += dt;
    if (this.secondAcc >= 1 - 1e-9) {
      this.secondAcc = 0;
      if (this.assistFree.length) this.completeAssists();
      this.metrics.sample();
      this.sampleHeat();
      this.sampleDensity();
      if (this.cfg.adaptive?.agents) this.perceive();
    }
    this.checkTermination();
    if (this.finished && this.lastDensitySample < this.t) this.sampleDensity();
  }

  run(maxSteps = Infinity): RunResult {
    this.wallStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let k = 0;
    while (!this.finished && k < maxSteps) {
      this.step();
      k++;
    }
    return this.result();
  }

  result(opts: { agents?: boolean; heat?: boolean } = {}): RunResult {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return buildResult(this, this.wallStart ? now - this.wallStart : 0, opts);
  }

  private checkTermination() {
    const tMax = this.cfg.tMax;
    if (this.doneCount >= this.agents.length) {
      this.finished = true;
      this.metrics.sample();
      return;
    }
    if (this.t >= tMax) {
      this.finished = true;
      return;
    }
    if (this.t - this.lastProgress > 60) {
      let pending = false;
      let allTrapped = true;
      for (const a of this.agents) {
        if (a.done) continue;
        if (a.state <= ST.PREPARING || a.hesitate > 0 || a.state === ST.FALLEN) pending = true;
        if (a.state !== ST.TRAPPED) allTrapped = false;
      }
      if (!pending) {
        this.finished = true;
        this.gridlock = !allTrapped;
      }
    }
  }

  progress() {
    this.lastProgress = this.t;
  }

  // ------------------------------------------------------------------------------------
  // behaviour hooks
  // ------------------------------------------------------------------------------------
  makeAware(a: Agent) {
    if (a.state !== ST.UNAWARE) return;
    a.state = ST.AWARE;
    a.tAware = this.t;
    a.clock = 0;
    this.progress();
  }

  becomeReady(a: Agent) {
    a.state = ST.WAITING;
    a.clock = 0;
    this.progress();
    if (a.group >= 0 && !this.cfg.population.groupMeetOutside) {
      if (Number.isNaN(this.groupWaitSince[a.group])) this.groupWaitSince[a.group] = this.t;
      if (a.separated && a.link >= 0) {
        a.state = ST.REUNITING;
        a.reason = 11;
        if (Number.isNaN(a.tStartMove)) a.tStartMove = this.t;
      }
      this.checkGroup(a.group, false);
    } else this.startMoving(a);
  }

  private checkGroup(gid: number, force: boolean) {
    const members = this.groups[gid];
    let ready = true;
    for (const m of members) {
      const b = this.agents[m];
      if (b.done || !b.inside) continue;
      if (b.separated) {
        if (!b.arrivedMeet) ready = false;
      } else if (b.state < ST.WAITING) ready = false;
    }
    if (!ready && !force) return;
    for (const m of members) {
      const b = this.agents[m];
      if (b.separated) {
        if (b.state === ST.REUNITING || b.holdAtNode || b.meetNode >= 0) {
          b.meetNode = -1;
          b.holdAtNode = false;
          b.separated = false;
          b.state = ST.MOVING;
          b.pendingNext = -1;
          b.lastNode = -1;
          this.routing.chooseExit(b, 'start');
        }
        continue;
      }
      if (b.state === ST.WAITING && b.link < 0 && !this.rowWaiting.includes(b.id)) this.startMoving(b);
    }
    this.groupWaitSince[gid] = NaN;
  }

  private groupTimeouts() {
    if (!this.groups.length) return;
    // checked once per simulated second (dt-independent)
    this.groupAcc += this.cfg.movement.dt;
    if (this.groupAcc < 1 - 1e-9) return;
    this.groupAcc = 0;
    for (let gid = 0; gid < this.groups.length; gid++) {
      const t0 = this.groupWaitSince[gid];
      if (Number.isNaN(t0)) continue;
      if (this.t - t0 > (this.cfg.population.groupWaitMax ?? 90)) this.checkGroup(gid, true); // give up waiting
      else this.checkGroup(gid, false);
    }
  }

  startMoving(a: Agent) {
    this.routing.chooseExit(a, 'start');
    if (!a.pathValid && !a.wheelchair) {
      this.learnFromCrowd(a);
      this.routing.chooseExit(a, 'start');
    }
    if (!a.pathValid && a.wheelchair) {
      // no accessible route: remain at the wheelchair position awaiting assisted evacuation
      a.state = ST.TRAPPED;
      a.reason = 10;
      return;
    }
    if (!a.pathValid) {
      // no known reachable exit: step towards the open row end (will re-plan at the aisle)
      const L = this.graph.links[this.seatLink[a.id]];
      a.pendingRowDir = this.graph.nodes[L.b].kind === 'deadEnd' ? -1 : 1;
    }
    a.state = ST.WAITING;
    this.rowWaiting.push(a.id);
  }

  cueByPassing(id: number) {
    const b = this.agents[id];
    if (b.link >= 0) return;
    if (b.state === ST.UNAWARE) this.makeAware(b);
    else if (b.state === ST.AWARE) b.clock += this.cfg.movement.dt;
  }

  groupSpeedCap(a: Agent): number {
    const gid = a.group;
    if (gid < 0 || this.groupBroken[gid] || a.separated || this.cfg.population.groupMeetOutside) return Infinity;
    if (this.cfg.simplification?.groupPaceOnly)
      return Math.min(...this.groups[gid].filter(id => this.agents[id].inside).map(id => this.agents[id].v0 * this.envSpeed));
    const M = this.cfg.movement;
    let cap = Infinity;
    for (const m of this.groups[gid]) {
      if (m === a.id) continue;
      const b = this.agents[m];
      if (b.done || !b.inside || b.separated) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > M.groupBreakDist && b.link >= 0) {
        this.groupBroken[gid] = 1; // separated in the crowd: continue independently
        return Infinity;
      }
      if (d > M.groupCohesionDist) {
        const bRem = b.link < 0 ? 1e9 : b.remCost;
        if (bRem > a.remCost + 1) cap = Math.min(cap, 0.3);
      } else if (b.link >= 0) cap = Math.min(cap, b.v0 * this.envSpeed);
    }
    return cap;
  }

  fall(a: Agent) {
    a.state = ST.FALLEN;
    a.v = 0;
    a.fallTimer = this.rngDyn.lognormalMedian(this.cfg.stress.fallDurationMedian, 0.5);
  }

  onArrive(a: Agent, n: number, cur: number) {
    const g = this.graph;
    const L = g.links[cur];
    if (L.exterior && a.inside) {
      a.tLeftBuilding = this.t;
      a.exitLink = cur;
      a.state = ST.OUTSIDE;
    }
    let infoChanged = false;
    for (const li of this.nearClosed[n]) if (this.canObserve(a, g.nodes[g.links[li].a].x, g.nodes[g.links[li].a].y, this.nodeFloorDisp[g.links[li].a]) && this.routing.learnBlocked(a, li)) infoChanged = true;
    const signs = this.physicalSignsOnly() ? [] : this.nearSigns[n];
    if (signs.length) {
      const p = this.cfg.routing.noticeProb * (this.cfg.environment.darkness ? 0.6 : 1) * (1 - 0.5 * Math.min(1, this.cfg.environment.smoke));
      for (const gi of signs) {
        if (a.knownExits & (1 << gi)) continue;
        if (this.rngDyn.random() < p) {
          a.knownExits |= 1 << gi;
          infoChanged = true;
        }
      }
    }
    if (a.meetNode === n) {
      a.holdAtNode = true;
      a.arrivedMeet = true;
      if (a.group >= 0) this.checkGroup(a.group, false);
      return;
    }
    // update remaining cost for group cohesion
    a.remCost = this.routing.staticRemaining(a, n);
    if (!a.inside && a.state === ST.OUTSIDE) return; // outside: just walk to the street
    const w = this.cfg.routing.weights[a.type];
    if (infoChanged) this.routing.chooseExit(a, 'info', n);
    else if (this.decisionNode[n] && a.meetNode < 0 && this.rngDyn.random() < w.reeval) this.routing.chooseExit(a, 'node', n);
  }

  discoverBlocked(a: Agent, li: number, node: number) {
    this.routing.learnBlocked(a, li);
    a.pendingNext = -1;
    this.routing.chooseExit(a, 'info', node);
  }

  /** an agent waiting a long time at a node may reconsider (sees the queue ahead) */
  reconsiderWhileWaiting(a: Agent, node: number) {
    if (a.blockedTime < 6 || a.meetNode >= 0 || !a.inside) return;
    const w = this.cfg.routing.weights[a.type];
    // reconsideration rate 0.06 (0.3 + reeval) per second of waiting (dt-independent)
    if (this.rngDyn.random() < 0.06 * (0.3 + w.reeval) * this.cfg.movement.dt) {
      a.pendingNext = -1;
      // after 20 s stuck, turning back is allowed (people do turn round in a jammed aisle)
      this.routing.chooseExit(a, a.blockedTime > 20 ? 'stuck' : 'node', node);
    }
  }

  noRoute(a: Agent, n: number, dt: number) {
    const before = a.noRouteTime;
    a.noRouteTime += dt;
    if (Math.floor(before / 2) !== Math.floor(a.noRouteTime / 2)) {
      // lost: look for exit signs and follow the people one can see
      this.learnFromCrowd(a);
      for (const gi of (this.physicalSignsOnly() ? [] : this.nearSigns[n])) if (this.rngDyn.random() < Math.min(1, 2 * this.cfg.routing.noticeProb)) a.knownExits |= 1 << gi;
      this.routing.chooseExit(a, 'info', n);
    }
    if (a.noRouteTime > 30 && a.state !== ST.TRAPPED) {
      // stranded: step aside so as not to block others; reported as trapped (NOT evacuated)
      a.state = ST.TRAPPED;
      this.movement.stepAside(a);
    }
  }

  /** an agent without a usable route adopts the exits it sees other people heading to */
  learnFromCrowd(a: Agent) {
    const r = Math.max(6, this.visibilityRange);
    this.forEachNear(a.x, a.y, a.floor, r, (b) => {
      if (b === a || b.targetGroup < 0 || b.link < 0) return;
      if (b.state < ST.MOVING || b.state > ST.OUTSIDE) return;
      a.knownExits |= 1 << b.targetGroup;
    });
  }

  markSafe(a: Agent, n: number) {
    const node = this.graph.nodes[n];
    if (a.link >= 0) this.densityRec.cross(this.regionOfLink[a.link], -1);
    a.state = ST.EXITED;
    a.tSafe = this.t;
    if (Number.isNaN(a.tLeftBuilding)) a.tLeftBuilding = this.t;
    a.link = -1;
    a.x = node.x;
    a.y = node.y;
    a.floor = 1;
    this.doneCount++;
    this.progress();
  }

  markAwaitingAssist(a: Agent, n: number) {
    const node = this.graph.nodes[n];
    if (a.link >= 0) this.densityRec.cross(this.regionOfLink[a.link], -1);
    a.state = ST.AWAITING_ASSIST;
    a.link = -1;
    a.x = node.x + ((a.id % 3) - 1) * 0.6;
    a.y = node.y;
    a.floor = 1;
    this.doneCount++;
    this.progress();
    const S = this.cfg.assist;
    if (S && S.enabled) {
      // the first free assisting team carries the person to the street (closed form: nothing
      // else interacts with the assisted descent, so the completion time is known on arrival)
      if (!this.assistFree.length) this.assistFree = new Array(Math.max(1, S.teams)).fill(S.staffAvailableAt);
      let k = 0;
      for (let i = 1; i < this.assistFree.length; i++) if (this.assistFree[i] < this.assistFree[k]) k = i;
      const start = Math.max(this.t, this.assistFree[k]);
      const dur = this.rngAssist.lognormalMedian(S.descentMedian, S.descentSigma);
      a.assistDue = start + dur;
      this.assistFree[k] = a.assistDue + 0.5 * S.descentMedian; // walk back up for the next person
    }
  }

  /** assisted descents complete (display / live statistics; results use the closed form) */
  private completeAssists() {
    for (const a of this.agents)
      if (a.state === ST.AWAITING_ASSIST && this.t >= a.assistDue) {
        a.state = ST.EXITED;
        a.tSafe = a.assistDue;
        a.x = this.graph.nodes[this.graph.safeByGroup[0][0]].x;
        a.y = this.graph.nodes[this.graph.safeByGroup[0][0]].y;
      }
  }

  /** Additional physical visibility filter; legacy geometry rules remain unchanged. */
  canObserve(_a: {x:number;y:number;floor:number}, _x:number, _y:number, _floor:number): boolean { return true; }
  prepareQueueObservations(_a:Agent):void {}
  perceivedGateQueue(_a:Agent,li:number):number { return this.gates.queueNow[li]; }
  perceivedGateCapacity(_a:Agent,li:number):number { return this.gates.cap[li]; }
  physicalSignsOnly(): boolean { return false; }
  managerAcceptance(a: Agent): number { return this.cfg.crowdManagers.complianceProb * a.trust; }
  managerMessage(_a: Agent, _gi:number, _accepted:boolean, _manager:number): void {}

  recordTraversal(a: Agent, from: number, to: number) {
    this.densityRec.cross(from >= 0 ? this.regionOfLink[from] : -1, this.regionOfLink[to]);
    const L = this.graph.links[to];
    a.remCost = this.routing.staticRemaining(a, a.dir > 0 ? L.b : L.a);
    if (this.traceHook) this.traceHook({ agent: a.id, from, to, t: this.t });
  }

  // ------------------------------------------------------------------------------------
  // staff (Crowd Manager) knowledge of the true building state
  // ------------------------------------------------------------------------------------
  staffFields(wheelchair: boolean): Field[] {
    const k = wheelchair ? 'A' : 'N';
    let f = this.staffFieldCache.get(k);
    if (!f) {
      const closed = new Set([...this.blockedLinks, ...this.barrierLinks]);
      const g = this.graph;
      f = g.safeByGroup.map((targets) => computeField(g, targets, (li) => closed.has(li) || g.links[li].prohibited || (wheelchair && !g.links[li].accessible)));
      this.staffFieldCache.set(k, f);
    }
    return f;
  }

  /** nominal fields (ignoring closures): what staff assume before they know of a closure */
  nominalFields(): Field[] {
    if (!this.nominalFieldCache) {
      const g = this.graph;
      this.nominalFieldCache = g.safeByGroup.map((targets) => computeField(g, targets, (li) => g.links[li].prohibited));
    }
    return this.nominalFieldCache;
  }

  staffPlanBlocked(gi: number): boolean {
    return this.staffAffected[gi] === 1;
  }

  private computeStaffAffected(): Uint8Array {
    const out = new Uint8Array(EXIT_GROUPS.length);
    if (!this.blockedLinks.length) return out;
    const g = this.graph;
    const base = g.safeByGroup.map((t) => computeField(g, t, (li) => g.links[li].prohibited));
    const closed = new Set(this.blockedLinks);
    const blk = g.safeByGroup.map((t) => computeField(g, t, (li) => closed.has(li) || g.links[li].prohibited));
    for (const li of this.blockedLinks) {
      const L = g.links[li];
      if (L.exitGroup >= 0) out[L.exitGroup] = 1;
      for (let gi = 0; gi < out.length; gi++) if (blk[gi].dist[L.a] - base[gi].dist[L.a] > 15 || !Number.isFinite(blk[gi].dist[L.a])) out[gi] = 1;
    }
    return out;
  }

  // ------------------------------------------------------------------------------------
  // spatial queries
  // ------------------------------------------------------------------------------------
  private rebuildGrid() {
    const head = this.gridHead;
    const next = this.gridNext;
    head.fill(-1);
    const per = GRID.nx * GRID.ny;
    for (const a of this.agents) {
      if (a.done) continue;
      const i = Math.floor((a.x - GRID.x0) / GRID.cell);
      const j = Math.floor((a.y - GRID.y0) / GRID.cell);
      if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.ny) continue;
      const c = (a.floor === 2 ? per : 0) + j * GRID.nx + i;
      next[a.id] = head[c];
      head[c] = a.id;
    }
  }

  forEachNear(x: number, y: number, floor: number, r: number, cb: (a: Agent) => void) {
    const per = GRID.nx * GRID.ny;
    const i0 = Math.max(0, Math.floor((x - r - GRID.x0) / GRID.cell));
    const i1 = Math.min(GRID.nx - 1, Math.floor((x + r - GRID.x0) / GRID.cell));
    const j0 = Math.max(0, Math.floor((y - r - GRID.y0) / GRID.cell));
    const j1 = Math.min(GRID.ny - 1, Math.floor((y + r - GRID.y0) / GRID.cell));
    const off = floor === 2 ? per : 0;
    const r2 = r * r;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        let id = this.gridHead[off + j * GRID.nx + i];
        while (id >= 0) {
          const a = this.agents[id];
          const dx = a.x - x;
          const dy = a.y - y;
          if (dx * dx + dy * dy <= r2) cb(a);
          id = this.gridNext[id];
        }
      }
  }

  /** share of visible moving neighbours heading to each exit group (damped by min(1, n/3)) */
  socialShares(a: Agent): number[] {
    const counts = new Array(EXIT_GROUPS.length).fill(0);
    let n = 0;
    const r = Math.min(this.cfg.routing.socialRadius, this.visibilityRange);
    this.forEachNear(a.x, a.y, a.floor, r, (b) => {
      if (b.id === a.id || b.link < 0 || b.targetGroup < 0 || (a.group >= 0 && b.group === a.group)) return;
      if (b.state < ST.MOVING || b.state > ST.OUTSIDE) return;
      counts[b.targetGroup]++;
      n++;
    });
    if (n === 0) return counts;
    const damp = Math.min(1, n / 3) / n;
    // followers can learn of an exit simply by seeing people go there
    if (a.type === 'follower' || a.type === 'cooperative') {
      for (let gi = 0; gi < counts.length; gi++)
        if (counts[gi] > 0 && !(a.knownExits & (1 << gi)) && this.rngRoute.random() < this.cfg.routing.socialLearnProb) a.knownExits |= 1 << gi;
    }
    return counts.map((c) => c * damp);
  }

  /** word-of-mouth diffusion of blocked-exit knowledge between nearby agents */
  private shareInformation(dt: number) {
    if (!this.blockedLinks.length) return;
    const p = 1 - Math.exp(-this.cfg.routing.shareInfoRate * dt);
    for (const a of this.agents) {
      if (a.done || a.knownBlocked.length === 0 || !a.inside) continue;
      this.forEachNear(a.x, a.y, a.floor, 2, (b) => {
        if (b === a || b.done || !b.inside) return;
        let learned = false;
        for (const li of a.knownBlocked) {
          if (!this.blockedLinks.includes(li) || b.knownBlocked.includes(li)) continue;
          if (this.rngDyn.random() < p) {
            this.routing.learnBlocked(b, li);
            learned = true;
          }
        }
        if (learned && b.state >= ST.MOVING && b.state <= ST.REUNITING) {
          b.pendingNext = -1;
          this.routing.chooseExit(b, 'info');
        }
      });
    }
  }

  // ------------------------------------------------------------------------------------
  // density over time (DensityRegions.ts)
  // ------------------------------------------------------------------------------------
  private sampleDensity() {
    const nR = this.densityRec.nR;
    const occ = new Int32Array(nR);
    const spd = new Float64Array(nR);
    const que = new Int32Array(nR);
    for (const a of this.agents) {
      if (a.link < 0 || a.done) continue;
      const r = this.regionOfLink[a.link];
      if (r < 0) continue;
      occ[r]++;
      spd[r] += a.v;
      if (a.state === ST.QUEUING) que[r]++;
    }
    const heat = this.cfg.analysis?.keepSeries ? this.heatLinks.map((li) => this.movement.linkCount[li]) : null;
    this.densityRec.sample(this.t, occ, spd, que, heat);
    this.lastDensitySample = this.t;
  }

  densityResult(): DensityResult {
    const ex = this.agents.map((a) => a.exposure);
    const ta = this.agents.map((a) => a.timeAboveRef);
    return this.densityRec.finish(ex, ta, 'Model A: local density = persons in the 2 m window ahead / (2 m x width), links >= 1.5 m, every 0.5 s');
  }

  managerSummaries(): ManagerSummary[] {
    return summarizeManagers(this.guidance.cms, !!this.cfg.analysis?.keepSeries);
  }

  // ------------------------------------------------------------------------------------
  // dynamic behaviour (adaptive.agents): perception, urgency, trust, event-triggered review
  // ------------------------------------------------------------------------------------
  /**
   * Once per simulated second for every aware person still inside:
   *   urgency  u <- u + (u* - u)(1 - e^{-1/10}),  u* = min(1, b + 0.2 [instructed] + 0.3 [knows a closure]
   *            + 0.15 min(1, rho/3) + 0.15 min(1, wait/60)),  b = 0.35 (voice alarm) or 0.2 (tone)
   *   trust    following a manager's instruction and queuing more than max(30, 2 x expected + 20) s
   *            since the decision costs trustLoss (once per decision)
   *   events   a moving person re-evaluates (cause 'event') when
   *              (a) time spent queuing since the last decision > max(waitExcessMin, waitExcessFactor x expected), or
   *              (b) the visible queue on the current route > expected + max(queueSurpriseMin, 50 % of expected),
   *            at most once per eventCooldown s. The commitment interval and route inertia still apply.
   */
  protected perceive() {
    const A = this.cfg.adaptive;
    const t = this.t;
    const base = this.cfg.alarm?.mode === 'voice' ? 0.35 : 0.2;
    const k = 1 - Math.exp(-1 / 10);
    for (const a of this.agents) {
      if (a.done || !a.inside || a.state === ST.UNAWARE) continue;
      let blockedKnown = false;
      for (const li of a.knownBlocked) if (this.blockedLinks.includes(li)) blockedKnown = true;
      const target = Math.min(1, base + (a.instructedCM ? 0.2 : 0) + (blockedKnown ? 0.3 : 0) + 0.15 * Math.min(1, a.densityHere / 3) + 0.15 * Math.min(1, a.waitTotal / 60));
      a.urgency += (target - a.urgency) * k;
      if (a.state < ST.MOVING || a.state > ST.REUNITING || a.link < 0 || a.meetNode >= 0 || a.wheelchair) continue;
      if (this.graph.links[a.link].isRow) continue;
      if (a.state === ST.QUEUING) a.delaySince += 1;
      if (a.cmSource >= 0 && a.targetGroup === a.cmGroup && a.delaySince > Math.max(30, 2 * a.expDelay + 20) && a.cmTime <= a.lastDecisionT && a.trustHitT !== a.lastDecisionT) {
        a.trustHitT = a.lastDecisionT;
        a.trust = Math.max(0.2, a.trust - A.trustLoss);
      }
      if (t < a.nextEventT) continue;
      let fire = a.delaySince > Math.max(A.waitExcessMin, A.waitExcessFactor * a.expDelay);
      if (!fire && A.congestionInfo !== 'none') {
        const vq = this.routing.visibleQueueOnPath(a);
        fire = vq > a.expDelay + Math.max(A.queueSurpriseMin, 0.5 * a.expDelay);
      }
      if (!fire) continue;
      a.events++;
      a.nextEventT = t + A.eventCooldown;
      a.pendingNext = -1;
      this.routing.chooseExit(a, 'event');
    }
  }

  private sampleHeat() {
    for (const a of this.agents) {
      if (a.link < 0) continue;
      const L = this.graph.links[a.link];
      if (L.isRow) continue;
      this.heat[a.floor === 2 ? 1 : 0].add(a.x, a.y, a.densityHere);
    }
    this.heat[0].samples++;
    this.heat[1].samples++;
  }

  // ------------------------------------------------------------------------------------
  // live statistics for the UI
  // ------------------------------------------------------------------------------------
  liveStats() {
    let notStarted = 0;
    let moving = 0;
    let queuing = 0;
    let left = 0;
    let safe = 0;
    for (const a of this.agents) {
      if (!a.inside) left++;
      if (a.state === ST.EXITED) safe++;
      if (a.state === ST.QUEUING) queuing++;
      else if (a.state >= ST.MOVING && a.state <= ST.OUTSIDE) moving++;
      if (a.link < 0 && a.state <= ST.WAITING) notStarted++;
    }
    let worst = -1;
    let worstQ = 0;
    for (let i = 0; i < this.gates.queueNow.length; i++)
      if (this.gates.queueNow[i] > worstQ) {
        worstQ = this.gates.queueNow[i];
        worst = i;
      }
    return {
      t: this.t,
      N: this.agents.length,
      left,
      safe,
      inside: this.agents.length - left,
      notStarted,
      moving,
      queuing,
      worstGate: worst >= 0 ? this.graph.links[worst].label : '-',
      worstQueue: worstQ,
    };
  }
}

/** Convenience: run one complete simulation headlessly. */
export function runSimulation(geo: GeometryData, cfg: SimConfig, seed?: number, opts: { agents?: boolean; heat?: boolean } = {}): RunResult {
  const sim = new SimulationEngine(geo, cfg, seed);
  sim.run();
  return sim.result(opts);
}
