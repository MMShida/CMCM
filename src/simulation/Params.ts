/**
 * Simulation configuration: every tunable parameter of the model lives here.
 *
 * Provenance codes used in PARAM_INFO (and docs/PARAMETERS.md):
 *   PROBLEM    - given in the CMCM problem statement
 *   PUBLISHED  - value reported in the research notes' cited literature (to be re-checked
 *                against the original reference before it is quoted in the paper)
 *   ASSUMPTION - our modelling choice; must be varied in sensitivity analysis
 */
import type { ExitGroupId } from '../geometry/types';

export type BehaviorType = 'shortest' | 'habitual' | 'follower' | 'queueAvoider' | 'cooperative' | 'impatient';
export const BEHAVIOR_TYPES: BehaviorType[] = ['shortest', 'habitual', 'follower', 'queueAvoider', 'cooperative', 'impatient'];
export const BEHAVIOR_LABEL: Record<BehaviorType, string> = {
  shortest: 'Shortest-time',
  habitual: 'Habitual',
  follower: 'Social follower',
  queueAvoider: 'Queue avoider',
  cooperative: 'Cooperative',
  impatient: 'Impatient',
};

export interface RouteWeights {
  /** weight on estimated travel time (per 30 s) */
  time: number;
  /** weight on perceived queueing delay (per 30 s) */
  queue: number;
  /** weight on familiarity (habitual main-entrance exit) */
  familiarity: number;
  /** weight on the share of visible neighbours heading to an exit */
  social: number;
  /** weight on accepted guidance (Crowd Manager / LED) */
  guidance: number;
  /** utility bonus for keeping the current choice (switching cost) */
  inertia: number;
  /** probability of re-evaluating the exit choice at a decision node */
  reeval: number;
}

export type Occupancy = { orchestra: number; mezzanine: number; balcony: number; pattern: 'random' | 'frontFirst' | 'backFirst' };

export interface SimConfig {
  label: string;
  scenarioId: string;
  seed: number;
  isEmergency: boolean;
  occupancy: Occupancy;
  population: {
    typeShares: Record<BehaviorType, number>;
    speedMean: number;
    speedSd: number;
    speedMin: number;
    speedMax: number;
    elderlyFraction: number;
    elderlySpeedFactor: number;
    stairRatio: number;
    stairRatioElderly: number;
    radiusMean: number;
    radiusSd: number;
    /** probability that an attendee knows the emergency exits (side doors, stage escape, balcony N stairs) */
    familiarityProb: number;
    /** prior probability of knowing each exit group for unfamiliar attendees */
    exitKnowledge: Record<ExitGroupId, number>;
    groupFraction: number;
    groupSizeWeights: [number, number, number];
    belongingsProb: number;
    belongingsMedian: number;
    belongingsSigma: number;
    /** throughput multiplier at gates from coats/backpacks (1 = none) */
    luggageFlowFactor: number;
    wheelchairCount: number;
    wheelchairSpeed: number;
  };
  premovement: {
    recognitionMedian: number;
    recognitionSigma: number;
    responseMedian: number;
    responseSigma: number;
    /** log-median increase per metre of distance to the row end */
    aisleCoef: number;
    /** log-median increase per 10 m of distance to the nearest exit door */
    exitDistCoef: number;
    levelFactor: { orchestra: number; mezzanine: number; balcony: number };
    /** log-median decrease for people familiar with the building */
    familiarityCoef: number;
    /** pre-movement clock speed-up when all neighbours move: rate = 1 + kappa * phi */
    socialKappa: number;
    /** hazard (1/s) of becoming aware when all neighbours move */
    socialAwareRate: number;
    /** neighbourhood radius for social influence in seats (m) */
    neighbourRadius: number;
    /** remaining response time is multiplied by this after a Crowd Manager instruction */
    cmFactor: number;
  };
  routing: {
    weights: Record<BehaviorType, RouteWeights>;
    visibilityRange: number;
    socialRadius: number;
    /** extra queue aversion for narrow doors: factor 1 + boost * max(0, (2 m - width)/2 m) */
    narrowDoorBoost: number;
    noticeRange: number;
    noticeProb: number;
    /** probability per second of passing blocked-exit knowledge to a neighbour within 2 m */
    shareInfoRate: number;
    /** probability that a follower learns an unknown exit by seeing people head to it */
    socialLearnProb: number;
    /** perceived cost (s) per person walking towards you on the next link (per lane) */
    counterflowPenalty: number;
  };
  movement: {
    dt: number;
    rowSpeed: number;
    squeezeSpeed: number;
    doorFlow: number;
    stairFlow: number;
    boundaryLayerDoor: number;
    boundaryLayerStair: number;
    laneWidth: number;
    tau: number;
    counterflowFriction: number;
    /** 'headway': 1D time-headway following (default); 'weidmann': area-density speed law */
    speedModel: 'headway' | 'weidmann';
    /** time headway T (s) of the following model: v = (h - d_min)/T */
    timeHeadway: number;
    weidmannGamma: number;
    weidmannRhoMax: number;
    groupCohesionDist: number;
    groupBreakDist: number;
    /** urgency 0 = normal departure, 1 = extreme */
    urgency: number;
    fasterIsSlower: { enabled: boolean; gain: number; drop: number; threshold: number };
    highDensityThreshold: number;
    /** hard cap on persons per m^2 of a link's floor area (both directions) */
    maxDensity: number;
  };
  crowdManagers: {
    /** -1 = automatic: ceil(N/250) as required by NY State law (problem statement) */
    count: number;
    unavailable: string[];
    activationMedian: number;
    activationSigma: number;
    radius: number;
    hearRate: number;
    complianceProb: number;
    plan: Record<string, ExitGroupId>;
    /** Crowd Managers update their instructions when they learn an exit is blocked */
    dynamic: boolean;
  };
  led: {
    enabled: boolean;
    activationTime: number;
    perceiveProb: number;
    complianceProb: number;
    plan: Record<string, ExitGroupId>;
    /** hesitation (s) added when LED and Crowd Manager instructions disagree */
    conflictDelay: number;
    /** LEDs mark blocked exits as closed (dynamic signage) */
    dynamic: boolean;
  };
  alarm: { recognitionExtra: number };
  blocked: { links: string[]; knowledge: 'immediate' | 'announced' | 'discovery'; announceDelay: number; discoveryRange: number };
  barriers: string[];
  environment: {
    darkness: boolean;
    smoke: number;
    outdoorStairFactor: number;
    speedFactor: number;
  };
  stress: {
    falls: boolean;
    fallRate: number;
    fallDurationMedian: number;
    separatedGroups: number;
  };
  tMax: number;
}

const W = (time: number, queue: number, familiarity: number, social: number, guidance: number, inertia: number, reeval: number): RouteWeights => ({
  time,
  queue,
  familiarity,
  social,
  guidance,
  inertia,
  reeval,
});

/** Behaviour-type route-choice weights (ASSUMPTION: qualitative ordering from the research notes). */
export const DEFAULT_WEIGHTS: Record<BehaviorType, RouteWeights> = {
  shortest: W(2.4, 1.2, 0.3, 0.3, 1.0, 0.8, 0.8),
  habitual: W(0.6, 0.3, 2.8, 0.5, 0.8, 1.5, 0.15),
  follower: W(0.8, 0.4, 0.9, 2.8, 1.0, 1.0, 0.5),
  queueAvoider: W(1.4, 2.8, 0.4, 0.2, 1.0, 0.6, 0.9),
  cooperative: W(1.0, 0.8, 1.0, 1.0, 1.6, 1.2, 0.3),
  impatient: W(2.2, 0.8, 0.5, 0.5, 0.6, 0.6, 0.7),
};

/** Baseline zone -> exit plan (balanced by side); used by Crowd Managers and LED strips. */
export const DEFAULT_PLAN: Record<string, ExitGroupId> = {
  ORCH_FRONT_W: 'STAGE_W',
  ORCH_FRONT_E: 'STAGE_E',
  ORCH_SIDE_W: 'PORTICO_W',
  ORCH_SIDE_E: 'PORTICO_E',
  ORCH_C_FRONT: 'FOYER',
  ORCH_C_BACK: 'FOYER',
  LOGE_W_N: 'PORTICO_W',
  LOGE_E_N: 'PORTICO_E',
  LOGE_W_S: 'PORTICO_W',
  LOGE_E_S: 'PORTICO_E',
  MEZZ_W: 'PORTICO_W',
  MEZZ_E: 'PORTICO_E',
  MEZZ_C_W: 'FOYER',
  MEZZ_C_E: 'FOYER',
  BAL_W_N: 'BAL_NW',
  BAL_E_N: 'BAL_NE',
  BAL_W_S: 'FOYER',
  BAL_E_S: 'FOYER',
  BAL_C_W: 'FOYER',
  BAL_C_E: 'FOYER',
};

export function defaultConfig(): SimConfig {
  return {
    label: 'Concert emergency (baseline)',
    scenarioId: 'concert-emergency',
    seed: 1,
    isEmergency: true,
    occupancy: { orchestra: 1, mezzanine: 1, balcony: 1, pattern: 'random' },
    population: {
      typeShares: { shortest: 0.2, habitual: 0.35, follower: 0.25, queueAvoider: 0.1, cooperative: 0.05, impatient: 0.05 },
      speedMean: 1.2,
      speedSd: 0.25,
      speedMin: 0.5,
      speedMax: 2.0,
      elderlyFraction: 0.25,
      elderlySpeedFactor: 0.78,
      stairRatio: 0.57,
      stairRatioElderly: 0.51,
      radiusMean: 0.22,
      radiusSd: 0.02,
      familiarityProb: 0.15,
      exitKnowledge: { FOYER: 1, PORTICO_W: 0.25, PORTICO_E: 0.25, STAGE_W: 0.1, STAGE_E: 0.1, BAL_NW: 0.35, BAL_NE: 0.35 },
      groupFraction: 0.5,
      groupSizeWeights: [0.7, 0.2, 0.1],
      belongingsProb: 0.5,
      belongingsMedian: 6,
      belongingsSigma: 0.6,
      luggageFlowFactor: 0.97,
      wheelchairCount: 3,
      wheelchairSpeed: 0.8,
    },
    premovement: {
      recognitionMedian: 6,
      recognitionSigma: 0.6,
      responseMedian: 14,
      responseSigma: 0.6,
      aisleCoef: 0.04,
      exitDistCoef: 0.05,
      levelFactor: { orchestra: 1.0, mezzanine: 1.0, balcony: 1.1 },
      familiarityCoef: 0.15,
      socialKappa: 1.5,
      socialAwareRate: 0.4,
      neighbourRadius: 2.5,
      cmFactor: 0.5,
    },
    routing: {
      weights: structuredClone(DEFAULT_WEIGHTS),
      visibilityRange: 15,
      socialRadius: 5,
      narrowDoorBoost: 1.5,
      noticeRange: 8,
      noticeProb: 0.38,
      shareInfoRate: 0.2,
      socialLearnProb: 0.3,
      counterflowPenalty: 3,
    },
    movement: {
      dt: 0.1,
      rowSpeed: 0.45,
      squeezeSpeed: 0.2,
      doorFlow: 1.3,
      stairFlow: 1.0,
      boundaryLayerDoor: 0.15,
      boundaryLayerStair: 0.09,
      laneWidth: 0.6,
      tau: 0.5,
      counterflowFriction: 0.5,
      speedModel: 'headway',
      timeHeadway: 0.7,
      weidmannGamma: 1.913,
      weidmannRhoMax: 5.4,
      groupCohesionDist: 4,
      groupBreakDist: 12,
      urgency: 0.6,
      fasterIsSlower: { enabled: true, gain: 0.15, drop: 0.45, threshold: 0.35 },
      highDensityThreshold: 3.5,
      maxDensity: 4.5,
    },
    crowdManagers: {
      count: 6,
      unavailable: [],
      activationMedian: 10,
      activationSigma: 0.5,
      radius: 12,
      hearRate: 0.35,
      complianceProb: 0.8,
      plan: { ...DEFAULT_PLAN },
      dynamic: true,
    },
    led: {
      enabled: false,
      activationTime: 3,
      perceiveProb: 0.9,
      complianceProb: 0.7,
      plan: { ...DEFAULT_PLAN },
      conflictDelay: 4,
      dynamic: false,
    },
    alarm: { recognitionExtra: 0 },
    blocked: { links: [], knowledge: 'discovery', announceDelay: 45, discoveryRange: 6 },
    barriers: [],
    environment: { darkness: false, smoke: 0, outdoorStairFactor: 1, speedFactor: 1 },
    stress: { falls: false, fallRate: 0.002, fallDurationMedian: 15, separatedGroups: 0 },
    tMax: 900,
  };
}

export function cloneConfig(c: SimConfig): SimConfig {
  return structuredClone(c);
}

/** Deep-merge a partial override into a config (arrays and plans replaced wholesale). */
export function mergeConfig(base: SimConfig, patch: DeepPartial<SimConfig>): SimConfig {
  const out = cloneConfig(base);
  deepAssign(out as any, patch as any);
  return out;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepAssign(target: any, src: any) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object' && target[k] !== null && !Array.isArray(target[k])) deepAssign(target[k], v);
    else target[k] = Array.isArray(v) ? [...v] : v;
  }
}

export interface ParamInfo {
  path: string;
  label: string;
  unit: string;
  status: 'PROBLEM' | 'PUBLISHED' | 'ASSUMPTION';
  source: string;
  uncertainty: string;
}

/** Human-readable provenance table (also rendered in the UI and in docs/PARAMETERS.md). */
export const PARAM_INFO: ParamInfo[] = [
  { path: 'capacity', label: 'Seats: orchestra 527, mezzanine/loge 486, balcony 316 (total 1,329; incl. up to 3 wheelchairs)', unit: 'persons', status: 'PROBLEM', source: 'CMCM 2026 problem statement', uncertainty: 'exact' },
  { path: 'crowdManagers.count', label: 'Crowd Managers: at least 1 per 250 attendees (6 for 1,329)', unit: 'persons', status: 'PROBLEM', source: 'Problem statement (NY State law)', uncertainty: 'exact (minimum)' },
  { path: 'benchmark', label: '180 s evacuation benchmark', unit: 's', status: 'PROBLEM', source: 'Problem statement', uncertainty: 'exact' },
  { path: 'premovement.*', label: 'Pre-movement time is lognormal', unit: '-', status: 'PUBLISHED', source: 'Forssberg et al. 2019 (40 unannounced evacuations)', uncertainty: 'shape only; parameters assumed' },
  { path: 'premovement.recognitionMedian', label: 'Alarm recognition median (concert emergency)', unit: 's', status: 'ASSUMPTION', source: 'chosen so that median total pre-movement is ~20-25 s', uncertainty: 'high: sweep 3-15 s' },
  { path: 'premovement.responseMedian', label: 'Response/decision median', unit: 's', status: 'ASSUMPTION', source: 'qualitative: Galea et al. 2017 (theatre), D\'Orazio & Bernardini (lectures)', uncertainty: 'high: sweep 5-40 s' },
  { path: 'premovement.aisleCoef', label: 'Response increases with distance to aisle / exit', unit: 'log-s per m', status: 'ASSUMPTION', source: 'direction from Galea et al. 2017; magnitude assumed', uncertainty: 'high' },
  { path: 'premovement.socialKappa', label: 'Social influence on starting to move', unit: '-', status: 'ASSUMPTION', source: 'direction from Nilsson & Johansson 2009; VR review arXiv 2302.10339', uncertainty: 'high' },
  { path: 'population.speedMean', label: 'Free walking speed (concert audience)', unit: 'm/s', status: 'ASSUMPTION', source: 'typical adult 1.2-1.4 m/s (Weidmann 1993 mean 1.34)', uncertainty: '+/-0.15' },
  { path: 'population.elderlySpeedFactor', label: 'Over-65 walk 20-25% slower', unit: '-', status: 'PUBLISHED', source: 'Thompson (citing Ando et al. 1988)', uncertainty: '0.75-0.80' },
  { path: 'population.stairRatio', label: 'Stair descent 0.71 m/s adults, 0.50 m/s elderly', unit: 'm/s', status: 'PUBLISHED', source: 'SFPE Europe, anthropometric data and movement speeds', uncertainty: 're-check' },
  { path: 'movement.rowSpeed', label: 'Max speed along seat rows 0.45 m/s', unit: 'm/s', status: 'PUBLISHED', source: 'Predtechenskii & Milinskii (cited in lecture-theatre network model)', uncertainty: 're-check' },
  { path: 'movement.doorFlow', label: 'Door specific flow 1.3 p/(s m) effective width', unit: 'p/(s m)', status: 'PUBLISHED', source: 'SFPE design value (conservative lower bound); 1.9 normal (Seyfried); 3.3-3.7 competitive (Nicolas et al.)', uncertainty: 'sweep 1.3-1.9' },
  { path: 'movement.stairFlow', label: 'Stair specific flow 1.0 p/(s m) effective width', unit: 'p/(s m)', status: 'ASSUMPTION', source: 'order of SFPE stair values; re-check', uncertainty: 'sweep 0.8-1.3' },
  { path: 'movement.boundaryLayerDoor', label: 'Boundary layer 0.15 m per side (doors), 0.09 m (handrails)', unit: 'm', status: 'ASSUMPTION', source: 'SFPE effective-width concept; values to re-check', uncertainty: '+/-0.05' },
  { path: 'movement.timeHeadway', label: 'Following model v = (h - d_min)/T, T = 0.7 s, d_min = r_i + r_j (lane capacity ~0.94 p/s at 1.2 m/s)', unit: 's', status: 'ASSUMPTION', source: 'form of single-file fundamental diagrams (e.g. Seyfried et al. 2005); T chosen so specific flow ~1.5 p/(s m)', uncertainty: 'sweep 0.5-1.0 s' },
  { path: 'movement.weidmann', label: 'Alternative speed-density relation (Weidmann): gamma 1.913, rho_max 5.4', unit: '-', status: 'PUBLISHED', source: 'Weidmann 1993 fundamental diagram (option speedModel = weidmann)', uncertainty: 'moderate' },
  { path: 'movement.fasterIsSlower', label: 'Flow rises with moderate urgency, drops with extreme competitiveness', unit: '-', status: 'ASSUMPTION', source: 'Nicolas et al. 2016; Helivaara et al. 2013 (direction only)', uncertainty: 'functional form assumed; testable' },
  { path: 'population.luggageFlowFactor', label: 'Luggage cuts bottleneck flow (39-47% for 100% suitcases)', unit: '-', status: 'PUBLISHED', source: 'Deng et al., Transportmetrica A (suitcases; backpacks/coats assumed much smaller)', uncertainty: 'high' },
  { path: 'routing.weights', label: 'Multinomial-logit weights by behaviour type', unit: '-', status: 'ASSUMPTION', source: 'qualitative: habit ~71% (arXiv 2110.11577), Kinateder & Warren 2017/2021', uncertainty: 'high' },
  { path: 'routing.noticeProb', label: 'Only 38% perceive conventional exit signs', unit: '-', status: 'PUBLISHED', source: 'Galea et al. 2016', uncertainty: 're-check' },
  { path: 'led.perceiveProb', label: 'Flashing LED exit signs detected up to 77%', unit: '-', status: 'PUBLISHED', source: 'Filippidis et al. 2021 (floor strips assumed more visible: 0.9)', uncertainty: 'sweep' },
  { path: 'led.complianceProb', label: 'Dynamic signage redirected 66% (base case 0.6-0.7)', unit: '-', status: 'PUBLISHED', source: 'Galea et al., improved ADSS trials (not a Bailey Hall value)', uncertainty: 'sweep 0.3-0.9' },
  { path: 'crowdManagers.complianceProb', label: 'Compliance with Crowd Manager instructions', unit: '-', status: 'ASSUMPTION', source: 'calibration data: theatre drills, Fire Technology 2018 (not extracted)', uncertainty: 'sweep 0.5-0.95' },
  { path: 'crowdManagers.radius', label: 'Voice range of a Crowd Manager', unit: 'm', status: 'ASSUMPTION', source: '-', uncertainty: '8-15 m' },
  { path: 'population.groupFraction', label: 'Share of attendees in social groups', unit: '-', status: 'ASSUMPTION', source: 'groups start later (Bode et al. 2015)', uncertainty: 'sweep' },
  { path: 'geometry.doorWidths', label: 'Door widths (D 1.6 m, P 1.6 m, FC 1.8 m, F 1.8 m, stage 1.0 m)', unit: 'm', status: 'ASSUMPTION', source: 'estimated from door-swing symbols on the scanned plans', uncertainty: '+/-0.3 m' },
  { path: 'geometry.scale', label: 'Plan scale 0.08 m per pixel', unit: 'm/px', status: 'ASSUMPTION', source: 'calibrated with chart dimensions and stated areas', uncertainty: '+/-6%' },
];
