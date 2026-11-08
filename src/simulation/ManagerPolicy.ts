/**
 * Crowd Manager state and adaptive instruction policy, shared by Models A and B (docs/ADAPTIVE.md).
 *
 * Every manager m keeps
 *   - a FIXED post (position, floor, nearest network node) and a formal responsibility (zones);
 *   - its OWN knowledge of the building: the waits it has observed at gates it can see
 *     (`known`, with the time of observation), and whether it knows of a closure;
 *   - its current instruction per planned exit (`redirect`), the time of the last change and the
 *     instruction history;
 *   - workload / reach / influence time series (filled by the model every second).
 *
 * Information (adaptive.managers = true):
 *   observation  each second the manager reads the queues of the gates in its observation set
 *                (same floor, within observeRange, reachable on foot: walls block); the reading is
 *                usable after observeDelay s.
 *   radio        (comm = 'radio') each observation, closure and lead decision is sent to every
 *                other manager; each message arrives with probability commReliability after
 *                commDelay s. Nothing else is known: gates nobody watches count as "no queue".
 *
 * Policy, every decisionInterval s, or at once when a closure becomes known or a watched gate
 * on a current route exceeds criticalWait s:
 *   est_m(g | p) = walking time from the post to exit group g (staff route)
 *            + sum of the known waits at the gates on that route
 *            + announced load: p_comply x persons of OTHER planned exits already redirected to g
 *              (by this manager or, known by radio, by others) / capacity of g
 *            + own load (g != p): p_comply x persons in reach planned for p / capacity of g
 *              (the manager anticipates the queue its own instruction would create)
 *   No chained redirections: an exit the manager is sending its own planned people AWAY from is not
 *   offered to other planned exits, and an exit currently RECEIVING redirected people keeps its own
 *   planned people (unless it is closed).
 *   For each planned exit p of the manager's zones, with current instruction c:
 *     - c known to be closed                              -> switch to argmin est (no hold);
 *     - else, if held >= minHold and est(c) - min est > switchThreshold -> switch to argmin est;
 *     - else, if held >= minHold, c != p and est(p) <= est(c)           -> return to the plan;
 *     - otherwise keep c (hysteresis band: leave the plan when it is > switchThreshold worse, return
 *       only when it is no worse).
 *   Coordination (coordination = true, radio): PEERS are managers whose voice areas overlap (same
 *   room and floor, posts <= 2 x voice radius apart), i.e. who can address the same people. Among a
 *   manager and its peers there is ONE lead per planned exit (lowest index among the active ones that
 *   plan it); the others apply the lead's last decision received by radio (no message = the plan),
 *   for every planned exit of the peers, so two managers audible to the same person do not send the
 *   same seat block to different exits. Managers that are not peers decide for their own area (a
 *   decision is location dependent) but still use every radio message (observations, closures,
 *   announced load). Without radio every manager decides alone
 *   (contradictions are possible and are counted when a person receives them).
 *
 * With adaptive.managers = false the model keeps its previous behaviour (Guidance.ts rebalance or
 * fixed plan) and only the bookkeeping below is used (R/H/I, workload), with the previous reach rule.
 */
import type { CrowdManagerPost } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import type { AdaptiveConfig, SimConfig } from './Params';
import { RNG } from './Random';

export interface InstructionEvent {
  t: number;
  /** planned exit group (index) this instruction concerns */
  planned: number;
  from: number;
  to: number;
  reason: string;
}

export interface ManagerSeries {
  t: number[];
  /** R: persons inside whose seat zone is in the manager's formal responsibility */
  R: number[];
  /** H: persons currently within communication reach */
  H: number[];
  /** I: persons whose current exit choice follows this manager's (last adopted) instruction */
  I: number[];
  /** cumulative unique persons ever in reach */
  reached: number[];
  /** workload index (see workloadIndex) */
  W: number[];
  /** watched gates currently known to be critical */
  crit: number[];
  /** highest link density in the manager's observation area (p/m^2) */
  dens: number[];
}

export interface ManagerState {
  idx: number;
  id: string;
  label: string;
  x: number;
  y: number;
  floor: number;
  /** nearest network node (staff routes start here) */
  node: number;
  /** coordination group id (room and floor of the post; diagnostics) */
  group: number;
  /** peers: managers whose voice areas overlap this one's (set by the model) */
  peers: number[];
  tActive: number;
  /** formal responsibility: zones assigned by the placement, plus co-responsibility after reassignment */
  baseZones: string[];
  zones: string[];
  /** planned exit groups of the zones in responsibility */
  planned: number[];
  knowsBlocked: boolean;
  /** information version broadcast to the audience (increments with every new instruction) */
  version: number;
  redirect: Map<number, number>;
  lastChange: Map<number, number>;
  /** gate id -> known wait (s) and time of observation */
  known: Map<number, { w: number; t: number }>;
  /** gates in the observation set */
  obsGates: number[];
  /** lead decisions received by radio: planned -> (to, time, persons concerned) */
  leadInfo: Map<number, { to: number; t: number; n: number; from: number }>;
  history: InstructionEvent[];
  lastReview: number;
  reviewNow: boolean;
  clearSince: number;
  /** persons in R per planned exit group (refreshed every second) */
  plannedCount: Map<number, number>;
  /** persons currently in reach (H) per planned exit group: the people an instruction would move */
  plannedReach: Map<number, number>;
  // ---- metrics ----
  series: ManagerSeries;
  uniqueReached: number;
  instructed: number;
  complied: number;
  changed: number;
  conflicts: number;
  overloadTime: number;
  maxW: number;
  /** legacy reach (straight line) that would be blocked by walls (diagnostic) */
  throughWall: number;
}

export interface ManagerSummary {
  id: string;
  label: string;
  x: number;
  y: number;
  floor: number;
  zones: string[];
  tActive: number;
  maxR: number;
  maxH: number;
  maxI: number;
  meanH: number;
  uniqueReached: number;
  instructed: number;
  complied: number;
  changed: number;
  conflicts: number;
  switches: number;
  overloadTime: number;
  maxW: number;
  throughWall: number;
  history: InstructionEvent[];
  series?: ManagerSeries;
}

/** people a new instruction for planned exit p would move (see ManagerPolicy.estimates) */
export function movable(m: ManagerState, p: number): number {
  return Math.max(m.plannedReach.get(p) ?? 0, m.plannedCount.get(p) ?? 0);
}

export function newManager(idx: number, post: CrowdManagerPost, node: number, tActive: number, planned: number[], knowsBlocked: boolean): ManagerState {
  return {
    idx,
    id: post.id,
    label: post.label,
    x: post.x,
    y: post.y,
    floor: post.floor,
    node,
    group: idx,
    peers: [],
    tActive,
    baseZones: [...post.zones],
    zones: [...post.zones],
    planned,
    knowsBlocked,
    version: 0,
    redirect: new Map(),
    lastChange: new Map(),
    known: new Map(),
    obsGates: [],
    leadInfo: new Map(),
    history: [],
    lastReview: -Infinity,
    reviewNow: false,
    clearSince: NaN,
    plannedCount: new Map(),
    plannedReach: new Map(),
    series: { t: [], R: [], H: [], I: [], reached: [], W: [], crit: [], dens: [] },
    uniqueReached: 0,
    instructed: 0,
    complied: 0,
    changed: 0,
    conflicts: 0,
    overloadTime: 0,
    maxW: 0,
    throughWall: 0,
  };
}

/** planned exit groups of a set of zones under a plan (zone keys or block keys ZONE:SIDE:BAND) */
export function plannedGroups(zones: string[], plan: Record<string, string>): number[] {
  const out = new Set<number>();
  for (const z of zones) {
    let any = false;
    for (const [k, v] of Object.entries(plan))
      if (k === z || k.startsWith(z + ':')) {
        out.add(EXIT_GROUPS.indexOf(v as any));
        any = true;
      }
    if (!any) out.add(0);
  }
  return [...out].filter((g) => g >= 0).sort((a, b) => a - b);
}

/**
 * Workload index (ASSUMPTION, an operational indicator, not a validated measure):
 *   W = H / H_ref + 0.5 x (critical bottlenecks watched) + 0.5 x max(0, rho_loc - rho_ref) / rho_ref
 * so a manager watching a critical staircase can be "loaded" with few people around.
 * Overload: W > 1.
 */
export function workloadIndex(H: number, crit: number, rhoLoc: number, cfg: SimConfig): number {
  const ref = cfg.analysis?.densityRef ?? 2;
  return H / Math.max(1, cfg.adaptive.workloadRef) + 0.5 * crit + (0.5 * Math.max(0, rhoLoc - ref)) / ref;
}

export interface PolicyEnv {
  /** true queue (persons) at a gate right now: read only through observation */
  queueAt(gate: number): number;
  capOf(gate: number): number;
  /** gate physically closed (blocked exit / barrier) */
  closedGate(gate: number): boolean;
  /** staff route from node to exit group gi; knowsBlocked selects true-state or nominal fields */
  route(node: number, gi: number, knowsBlocked: boolean): { walk: number; gates: number[] } | null;
  /** capacity (p/s) of exit group gi (sum of its exterior doors) */
  groupCap: number[];
}

interface Message {
  to: number;
  tAvail: number;
  kind: 'obs' | 'blocked' | 'decision';
  gate?: number;
  w?: number;
  tObs?: number;
  planned?: number;
  dest?: number;
  n?: number;
  from?: number;
}

export class ManagerPolicy {
  private pending: Message[] = [];
  private readonly A: AdaptiveConfig;
  private readonly rng: RNG;
  switches = 0;

  constructor(
    readonly cfg: SimConfig,
    readonly managers: ManagerState[],
    readonly env: PolicyEnv,
    seed: number,
    stream: string,
  ) {
    this.A = cfg.adaptive;
    this.rng = new RNG(seed, stream);
  }

  /** wait (s) the manager currently knows at gate g (0 if never observed / told) */
  knownWait(m: ManagerState, gate: number): number {
    const k = m.known.get(gate);
    return k ? k.w : 0;
  }

  /** known congestion per exit group from the manager's post (told to people when shareCongestion) */
  groupWaits(m: ManagerState): { w: number; t: number }[] {
    return EXIT_GROUPS.map((_, gi) => {
      const r = this.env.route(m.node, gi, m.knowsBlocked);
      if (!r) return { w: NaN, t: NaN };
      let w = 0;
      let t = Infinity;
      let any = false;
      for (const gt of r.gates) {
        const k = m.known.get(gt);
        if (!k) continue;
        any = true;
        w += k.w;
        t = Math.min(t, k.t);
      }
      return any ? { w, t } : { w: NaN, t: NaN };
    });
  }

  private send(from: ManagerState, msg: Omit<Message, 'to' | 'tAvail'>, t: number) {
    if (this.A.comm !== 'radio') return;
    for (const m of this.managers) {
      if (m === from) continue;
      if (this.rng.random() >= this.A.commReliability) continue;
      this.pending.push({ ...msg, to: m.idx, tAvail: t + this.A.commDelay, from: from.idx });
    }
  }

  /** once per simulated second */
  step(t: number) {
    const A = this.A;
    // 1. observation (usable after observeDelay)
    for (const m of this.managers) {
      if (t < m.tActive) continue;
      for (const gt of m.obsGates) {
        if (this.env.closedGate(gt)) {
          if (!m.knowsBlocked) this.pending.push({ to: m.idx, tAvail: t + A.observeDelay, kind: 'blocked', from: m.idx });
          continue;
        }
        const w = this.env.queueAt(gt) / Math.max(0.2, this.env.capOf(gt));
        this.pending.push({ to: m.idx, tAvail: t + A.observeDelay, kind: 'obs', gate: gt, w, tObs: t, from: m.idx });
      }
    }
    // 2. delivery (own observations and radio)
    const still: Message[] = [];
    for (const msg of this.pending) {
      if (msg.tAvail > t + 1e-9) {
        still.push(msg);
        continue;
      }
      const m = this.managers[msg.to];
      const own = msg.from === m.idx;
      if (msg.kind === 'obs') {
        const prev = m.known.get(msg.gate!);
        if (!prev || prev.t <= msg.tObs!) {
          m.known.set(msg.gate!, { w: msg.w!, t: msg.tObs! });
          // a watched gate on a current route becomes critical: review at once
          if (msg.w! > A.criticalWait && (!prev || prev.w <= A.criticalWait) && this.onCurrentRoute(m, msg.gate!)) m.reviewNow = true;
        }
        if (own && t >= m.tActive) this.send(m, { kind: 'obs', gate: msg.gate, w: msg.w, tObs: msg.tObs }, t);
      } else if (msg.kind === 'blocked') {
        if (!m.knowsBlocked) {
          m.knowsBlocked = true;
          m.version++;
          m.reviewNow = true;
          if (own) this.send(m, { kind: 'blocked' }, t);
        }
      } else if (msg.kind === 'decision') {
        const prev = m.leadInfo.get(msg.planned!);
        if (!prev || prev.t <= msg.tObs!) m.leadInfo.set(msg.planned!, { to: msg.dest!, t: msg.tObs!, n: msg.n!, from: msg.from! });
        m.reviewNow = true;
      }
    }
    this.pending = still;
    // 3. decisions
    for (const m of this.managers) {
      if (t < m.tActive) continue;
      const due = t - m.lastReview >= A.decisionInterval - 1e-9;
      if (!due && !m.reviewNow) {
        // a closure on a current instruction is handled at once even between reviews
        continue;
      }
      m.lastReview = t;
      m.reviewNow = false;
      this.review(m, t);
    }
  }

  private onCurrentRoute(m: ManagerState, gate: number): boolean {
    for (const p of m.planned) {
      const c = m.redirect.get(p) ?? p;
      const r = this.env.route(m.node, c, m.knowsBlocked);
      if (r && r.gates.includes(gate)) return true;
    }
    return false;
  }

  private leadOf(p: number, t: number, self: ManagerState): number {
    let lead = -1;
    for (const m of this.managers) if ((m === self || self.peers.includes(m.idx)) && t >= m.tActive && m.planned.includes(p)) {
      lead = m.idx;
      break;
    }
    return lead;
  }

  /**
   * estimates for deciding about planned exit p. With t given and coordination on, the people that
   * the peers following this manager's decision for p move their people too, so they are counted as
   * load (their counts are taken as reported by radio; the report delay is not modelled).
   * An instruction stays in force and is given to everyone who comes into earshot later, so the
   * people a NEW decision moves are forecast as max(in reach now, still inside in the responsibility
   * zones) for planned exit p (conservative: some of the latter may already queue at p).
   */
  estimates(m: ManagerState, p = -1, t = -Infinity): number[] {
    const load = new Array(EXIT_GROUPS.length).fill(0);
    const pc = this.cfg.crowdManagers.complianceProb;
    // announced load: redirections of OTHER planned exits, decided by others (radio) or by this manager
    const own = new Set<number>();
    for (const [q, to] of m.redirect)
      if (to !== q && q !== p) {
        load[to] += pc * (m.plannedReach.get(q) ?? 0);
        own.add(q);
      }
    for (const [q, info] of m.leadInfo) if (info.to !== q && q !== p && !own.has(q)) load[info.to] += pc * info.n;
    // the people this decision would move (in reach, planned for p) load every destination they would
    // have to be MOVED to. Their current instructed destination (cur) is assessed from what is
    // observed there: those already queuing at it are in its observed wait, so adding them again
    // would double count and make every redirection look wrong right after it was made (oscillation).
    // the decision is applied by the lead AND the peers following it: its route cost is the average
    // over their posts, weighted by the people each one would move (walk and the gates on the route
    // differ between a front and a back post), with this manager's knowledge of the waits
    const members: [ManagerState, number][] = [[m, 1]];
    if (p >= 0) {
      const cur = m.redirect.get(p) ?? p;
      let moved = movable(m, p);
      members[0][1] = moved + 1;
      if (this.A.coordination && this.A.comm === 'radio' && Number.isFinite(t))
        for (const o of this.managers)
          if (m.peers.includes(o.idx) && t >= o.tActive && this.leadOf(p, t, o) === m.idx) {
            const k = movable(o, p);
            moved += k;
            members.push([o, k + 1]);
          }
      const mine = pc * moved;
      for (let g = 0; g < load.length; g++) if (g !== cur) load[g] += mine;
    }
    return EXIT_GROUPS.map((_, gi) => {
      let sum = 0;
      let wsum = 0;
      for (const [o, wt] of members) {
        const r = this.env.route(o.node, gi, m.knowsBlocked);
        if (!r) return Infinity;
        let w = 0;
        for (const gt of r.gates) w += this.knownWait(m, gt);
        sum += wt * (r.walk + w);
        wsum += wt;
      }
      return sum / wsum + load[gi] / Math.max(0.5, this.env.groupCap[gi]);
    });
  }

  private review(m: ManagerState, t: number) {
    const A = this.A;
    let est: number[];
    let changed = false;
    // a manager instructs everyone in earshot: with coordination it applies the room's decisions for
    // every planned exit of the room, not only for the exits planned for its own zones
    const coord = A.coordination && A.comm === 'radio';
    const ps = new Set<number>(m.planned);
    if (coord) for (const o of this.managers) if (m.peers.includes(o.idx) && t >= o.tActive) for (const q of o.planned) ps.add(q);
    for (const p of [...ps].sort((x, y) => x - y)) {
      const cur = m.redirect.get(p) ?? p;
      const lead = coord ? this.leadOf(p, t, m) : m.idx;
      if (lead >= 0 && lead !== m.idx) {
        // the room's lead decides this planned exit: follow its last decision received by radio
        // (no message = the lead keeps the plan); a lost message leaves the old instruction in place
        const info = m.leadInfo.get(p);
        const target = info && info.from === lead ? info.to : p;
        if (target !== cur && (info?.from === lead || !m.leadInfo.has(p))) {
          this.apply(m, p, cur, target, t, `follows lead ${this.managers[lead].id} (radio)`);
          changed = true;
        }
        continue;
      }
      est = this.estimates(m, p, t);
      // never offer an exit whose own planned people are being sent away (no chained redirections)
      const away = (gi: number) => gi !== p && ((m.redirect.has(gi) && m.redirect.get(gi) !== gi) || (m.leadInfo.has(gi) && m.leadInfo.get(gi)!.to !== gi));
      let best = cur;
      for (let gi = 0; gi < est.length; gi++) if (!away(gi) && est[gi] < est[best]) best = gi;
      const held = t - (m.lastChange.get(p) ?? -Infinity);
      let to = cur;
      let why = '';
      // an exit that currently RECEIVES people redirected by this manager keeps its own people (unless closed)
      const receiving = [...m.redirect.entries()].some(([q, d]) => q !== p && d === p);
      if (receiving && Number.isFinite(est[cur])) best = cur;
      if (!Number.isFinite(est[cur]) && Number.isFinite(est[best])) {
        to = best;
        why = 'instructed exit closed / unreachable';
      } else if (!A.staticPlan && held >= A.minHold - 1e-9 && best !== cur && est[cur] - est[best] > A.switchThreshold) {
        to = best;
        why = `${EXIT_GROUPS[best]} better by ${Math.round(est[cur] - est[best])} s`;
      } else if (held >= A.minHold - 1e-9 && cur !== p && Number.isFinite(est[p]) && est[p] <= est[cur]) {
        to = p;
        why = 'planned exit competitive again';
      }
      if (to !== cur) {
        this.apply(m, p, cur, to, t, why);
        changed = true;
        if (lead === m.idx || lead < 0) this.send(m, { kind: 'decision', planned: p, dest: to, n: movable(m, p), tObs: t }, t);
      }
    }
    if (changed) m.version++;
  }

  private apply(m: ManagerState, p: number, from: number, to: number, t: number, reason: string) {
    if (to === p) m.redirect.delete(p);
    else m.redirect.set(p, to);
    m.lastChange.set(p, t);
    m.history.push({ t, planned: p, from, to, reason });
    this.switches++;
  }
}

/** formal reassignment policy 'whenClear' (see AdaptiveConfig.reassign); returns true if responsibilities changed */
export function reassign(managers: ManagerState[], t: number, dist: (a: ManagerState, b: ManagerState) => number, plan: Record<string, string>): boolean {
  let changed = false;
  for (const m of managers) {
    const R = m.series.R.length ? m.series.R[m.series.R.length - 1] : 1;
    if (R > 0 || t < m.tActive) {
      m.clearSince = NaN;
      continue;
    }
    if (Number.isNaN(m.clearSince)) m.clearSince = t;
    if (t - m.clearSince < 10) continue;
    // co-supervise the zones of the nearest busy manager on the same floor
    let best: ManagerState | null = null;
    let bd = Infinity;
    for (const o of managers) {
      if (o === m || o.floor !== m.floor) continue;
      const Ro = o.series.R.length ? o.series.R[o.series.R.length - 1] : 0;
      if (Ro <= 0) continue;
      const d = dist(m, o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) continue;
    const add = best.zones.filter((z) => !m.zones.includes(z));
    if (!add.length) continue;
    m.zones.push(...add);
    m.planned = plannedGroups(m.zones, plan);
    m.history.push({ t, planned: -1, from: -1, to: -1, reason: `co-responsibility for ${add.join(', ')} (own area clear)` });
    m.clearSince = NaN;
    changed = true;
  }
  return changed;
}

export function summarizeManagers(managers: ManagerState[], keepSeries: boolean): ManagerSummary[] {
  const max = (a: number[]) => (a.length ? Math.max(...a) : 0);
  return managers.map((m) => ({
    id: m.id,
    label: m.label,
    x: m.x,
    y: m.y,
    floor: m.floor,
    zones: [...m.zones],
    tActive: Math.round(m.tActive * 10) / 10,
    maxR: max(m.series.R),
    maxH: max(m.series.H),
    maxI: max(m.series.I),
    meanH: m.series.H.length ? Math.round((m.series.H.reduce((s, v) => s + v, 0) / m.series.H.length) * 10) / 10 : 0,
    uniqueReached: m.uniqueReached,
    instructed: m.instructed,
    complied: m.complied,
    changed: m.changed,
    conflicts: m.conflicts,
    switches: m.history.filter((h) => h.planned >= 0).length,
    overloadTime: m.overloadTime,
    maxW: Math.round(m.maxW * 100) / 100,
    throughWall: m.throughWall,
    history: m.history,
    series: keepSeries ? m.series : undefined,
  }));
}
