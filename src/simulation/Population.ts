/**
 * Builds the audience: chooses occupied seats, samples individual attributes
 * from the configured distributions (seeded stream "population"), forms social
 * groups and the seated social-influence neighbourhoods.
 *
 * All random draws happen in a fixed order that does NOT depend on
 * interventions (guidance, barriers, blocked exits), so two strategies run with
 * the same seed see exactly the same audience (common random numbers).
 */
import type { GeometryData, Seat } from '../geometry/types';
import { EXIT_GROUPS } from '../geometry/types';
import { Agent, ST } from './Agent';
import { RNG } from './Random';
import type { BehaviorType, SimConfig } from './Params';
import { BEHAVIOR_TYPES } from './Params';

export interface PopulationResult {
  agents: Agent[];
  groups: number[][];
}

/** Euclidean distance (m) from each seat to the nearest mezzanine/balcony door, used by the exit-distance term. */
function nearestDoorDistance(geo: GeometryData, seat: Seat): number {
  let best = Infinity;
  const floor = seat.level === 'balcony' ? 2 : 1;
  for (const l of geo.links) {
    if (l.kind !== 'door') continue;
    if ((l.floor === 2 ? 2 : 1) !== floor) continue;
    const p = l.pts[0];
    const d = Math.hypot(p[0] - seat.x, p[1] - seat.y);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : 20;
}

export function selectSeats(geo: GeometryData, cfg: SimConfig, rng: RNG): number[] {
  const occ = cfg.occupancy;
  const chosen: number[] = [];
  const nWheel = Math.min(cfg.population.wheelchairCount, Math.round(3 * occ.mezzanine));
  for (const level of ['orchestra', 'mezzanine', 'balcony'] as const) {
    const frac = Math.max(0, Math.min(1, occ[level]));
    const cap = geo.capacity[level];
    let n = Math.round(frac * cap);
    const idx: number[] = [];
    const keys: number[] = [];
    geo.seats.forEach((s, i) => {
      if (s.level !== level || s.wheelchair) return;
      idx.push(i);
    });
    // one uniform per candidate seat, always drawn (CRN)
    for (let k = 0; k < idx.length; k++) keys.push(rng.random());
    if (level === 'mezzanine') {
      const wheel = geo.seats.map((s, i) => (s.wheelchair ? i : -1)).filter((i) => i >= 0);
      for (let w = 0; w < Math.min(nWheel, wheel.length); w++) chosen.push(wheel[w]);
      n -= Math.min(nWheel, wheel.length);
    }
    const order = idx.map((_, k) => k);
    if (occ.pattern === 'random') order.sort((a, b) => keys[a] - keys[b]);
    else {
      const sign = occ.pattern === 'frontFirst' ? 1 : -1;
      order.sort((a, b) => sign * (geo.seats[idx[a]].rowIndex + 3 * keys[a] - (geo.seats[idx[b]].rowIndex + 3 * keys[b])));
    }
    for (let k = 0; k < Math.max(0, Math.min(n, order.length)); k++) chosen.push(idx[order[k]]);
  }
  return chosen.sort((a, b) => a - b);
}

export function createPopulation(geo: GeometryData, cfg: SimConfig, seed: number): PopulationResult {
  const rng = new RNG(seed, 'population');
  const P = cfg.population;
  const R = cfg.premovement;
  const seatIdx = selectSeats(geo, cfg, rng);
  const shares = BEHAVIOR_TYPES.map((t) => Math.max(0, P.typeShares[t]));
  const agents: Agent[] = [];
  for (let i = 0; i < seatIdx.length; i++) {
    const seat = geo.seats[seatIdx[i]];
    // --- fixed-order draws ------------------------------------------------
    const uType = rng.random();
    const zSpeed = rng.normal();
    const uElder = rng.random();
    const zRadius = rng.normal();
    const uFam = rng.random();
    const zRec = rng.normal();
    const zResp = rng.normal();
    const uBel = rng.random();
    const zBel = rng.normal();
    const uCM = rng.random();
    const uLED = rng.random();
    const uLEDsee = rng.random();
    const zImp = rng.normal();
    const uKnow = EXIT_GROUPS.map(() => rng.random());
    // ----------------------------------------------------------------------
    let type: BehaviorType = BEHAVIOR_TYPES[BEHAVIOR_TYPES.length - 1];
    {
      const tot = shares.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      for (let k = 0; k < shares.length; k++) {
        acc += shares[k] / tot;
        if (uType < acc) {
          type = BEHAVIOR_TYPES[k];
          break;
        }
      }
    }
    const a = new Agent(i, seatIdx[i], type);
    a.elderly = uElder < P.elderlyFraction;
    const f = a.elderly ? P.elderlySpeedFactor : 1;
    a.v0 = Math.min(P.speedMax, Math.max(P.speedMin, P.speedMean * f + P.speedSd * f * zSpeed));
    a.stairRatio = a.elderly ? P.stairRatioElderly : P.stairRatio;
    a.stairRatioUp = a.elderly ? (P.stairRatioUpElderly ?? a.stairRatio) : (P.stairRatioUp ?? a.stairRatio);
    a.radius = Math.min(0.3, Math.max(0.17, P.radiusMean + P.radiusSd * zRadius));
    a.familiar = uFam < P.familiarityProb;
    a.uCM = uCM;
    a.uLED = uLED;
    a.uLEDsee = uLEDsee;
    const baseImp = type === 'impatient' ? 0.85 : type === 'cooperative' ? 0.1 : 0.35;
    a.impatience = Math.min(1, Math.max(0, baseImp + 0.1 * zImp));
    if (seat.wheelchair) {
      a.wheelchair = true;
      a.v0 = P.wheelchairSpeed;
      a.radius = 0.45;
      a.stairRatio = 0;
      a.stairRatioUp = 0;
    }
    // pre-movement: lognormal; median depends on seat position, level, familiarity, alarm type
    const voice = cfg.alarm.mode === 'voice';
    const recMedian = (R.recognitionMedian * (cfg.environment.darkness ? 1.3 : 1) + cfg.alarm.recognitionExtra) * (voice ? cfg.alarm.voiceRecognitionFactor : 1);
    // nobody can recognise the alarm before it starts (declarationDelay after the declaration)
    a.tRecognition = Math.max(0, cfg.alarm.declarationDelay ?? 0) + Math.max(0, recMedian) * Math.exp(R.recognitionSigma * zRec);
    const lvl = R.levelFactor[seat.level];
    const doorDist = nearestDoorDistance(geo, seat);
    const respMedian =
      R.responseMedian *
      lvl *
      (voice ? cfg.alarm.voiceResponseFactor : 1) *
      Math.exp(R.aisleCoef * Math.min(seat.aisleDist, 15) + R.exitDistCoef * (doorDist / 10) - (a.familiar ? R.familiarityCoef : 0));
    a.tResponse = respMedian * Math.exp(R.responseSigma * zResp);
    a.tPrepare = uBel < P.belongingsProb ? P.belongingsMedian * Math.exp(P.belongingsSigma * zBel) : 1.5 * Math.exp(0.3 * zBel);
    // exit knowledge (bitmask)
    let mask = 0;
    EXIT_GROUPS.forEach((g, k) => {
      if (g === 'FOYER' || a.familiar || uKnow[k] < P.exitKnowledge[g]) mask |= 1 << k;
    });
    a.knownExits = mask;
    a.x = seat.x;
    a.y = seat.y;
    a.floor = seat.level === 'balcony' ? 2 : 1;
    a.state = cfg.isEmergency ? ST.UNAWARE : ST.UNAWARE;
    agents.push(a);
  }

  // --- social groups: adjacent seats in the same row --------------------------
  const groups: number[][] = [];
  const meanSize = P.groupSizeWeights.reduce((acc, w, k) => acc + w * (k + 2), 0) / Math.max(1e-9, P.groupSizeWeights.reduce((x, y) => x + y, 0));
  const fG = Math.min(0.95, Math.max(0, P.groupFraction));
  const pStart = fG / (meanSize * (1 - fG) + fG);
  const bySeatOrder = agents
    .map((a) => a.id)
    .sort((i, j) => {
      const si = geo.seats[agents[i].seat];
      const sj = geo.seats[agents[j].seat];
      return si.link === sj.link ? si.s - sj.s : si.link < sj.link ? -1 : 1;
    });
  for (let k = 0; k < bySeatOrder.length; k++) {
    const u = rng.random();
    const uSize = rng.random();
    const uSep = rng.random();
    const a = agents[bySeatOrder[k]];
    if (a.group >= 0 || a.wheelchair) continue;
    if (u >= pStart) continue;
    let size = 2;
    {
      const w = P.groupSizeWeights;
      const tot = w[0] + w[1] + w[2];
      size = uSize < w[0] / tot ? 2 : uSize < (w[0] + w[1]) / tot ? 3 : 4;
    }
    const members = [a.id];
    for (let q = k + 1; q < bySeatOrder.length && members.length < size; q++) {
      const b = agents[bySeatOrder[q]];
      const sa = geo.seats[agents[members[members.length - 1]].seat];
      const sb = geo.seats[b.seat];
      if (sb.link !== sa.link || Math.abs(sb.s - sa.s) > 0.75 || b.group >= 0 || b.wheelchair) break;
      members.push(b.id);
    }
    if (members.length < 2) continue;
    const gid = groups.length;
    groups.push(members);
    members.forEach((m, idx) => {
      agents[m].group = gid;
      agents[m].groupLeader = idx === 0;
    });
    // stress test: one member starts away from the group (e.g. intermission)
    if (uSep < cfg.stress.separatedGroups) agents[members[members.length - 1]].separated = true;
  }

  // --- seated neighbourhoods for social influence ------------------------------
  const cell = Math.max(1, R.neighbourRadius);
  const buckets = new Map<string, number[]>();
  const key = (lvl: string, x: number, y: number) => `${lvl}|${Math.floor(x / cell)}|${Math.floor(y / cell)}`;
  for (const a of agents) {
    const s = geo.seats[a.seat];
    const k = key(s.level, s.x, s.y);
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(a.id);
  }
  for (const a of agents) {
    const s = geo.seats[a.seat];
    const near: number[] = [];
    const cx = Math.floor(s.x / cell);
    const cy = Math.floor(s.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = buckets.get(`${s.level}|${cx + dx}|${cy + dy}`);
        if (!arr) continue;
        for (const j of arr) {
          if (j === a.id) continue;
          const t = geo.seats[agents[j].seat];
          if (Math.hypot(t.x - s.x, t.y - s.y) <= R.neighbourRadius) near.push(j);
        }
      }
    a.neighbours = Int32Array.from(near);
  }
  // persistent taste shocks of the exit-choice logit (separate stream: the audience is unchanged)
  const taste = new RNG(seed, 'taste');
  for (const a of agents) a.taste = Float64Array.from(EXIT_GROUPS, () => taste.gumbel());
  // stable traits used by the dynamic behaviour model (separate stream: drawn always, so the
  // audience and every legacy draw are unchanged whether or not adaptive behaviour is enabled)
  const traits = new RNG(seed, 'traits');
  const sd = cfg.adaptive?.socialSusSd ?? 0.3;
  for (const a of agents) {
    a.socialSus = Math.exp(sd * traits.normal() - 0.5 * sd * sd);
    // cooperation tendency in [0, 1]: cooperative type high, impatient low, others around 0.5
    const base = a.type === 'cooperative' ? 0.8 : a.type === 'impatient' ? 0.25 : 0.5;
    a.coop = Math.max(0, Math.min(1, base + 0.15 * traits.normal()));
    a.belief = new Float32Array(EXIT_GROUPS.length);
    a.beliefT = new Float32Array(EXIT_GROUPS.length).fill(NaN);
  }
  return { agents, groups };
}
