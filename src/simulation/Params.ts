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

export interface GuidanceSign {
  id: string; x: number; y: number; floor: number;
  facingDegrees: number; exit: ExitGroupId;
  /** Optional floor strip, in metres on an existing link. Ordered points show arrow direction.
   * Finite, public message; range/occlusion still apply. No display-facing cone for floor strips. */
  strip?: { linkId: string; points: [number, number][] };
}

export interface SimConfig {
  /** A-Lite+ installations and explicit model switches; ignored by legacy engines. */
  plus?: import('../plus/Config').PlusConfig;
  label: string;
  scenarioId: string;
  seed: number;
  isEmergency: boolean;
  occupancy: Occupancy;
  population: {
    typeShares: Record<BehaviorType, number>;
    speedMean: number;
    /** Optional distribution-shape sensitivity. Absent preserves the original clipped normal. */
    speedDistribution?: 'normal' | 'lognormal';
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
    /** maximum time (s) a ready group member waits for the rest of the group before leaving alone */
    groupWaitMax: number;
    /**
     * intervention: groups agree to meet OUTSIDE (pre-show announcement). Members leave as soon as
     * they are individually ready, choose their own exit and do not wait for or slow down to each other.
     */
    groupMeetOutside: boolean;
    /** speed ratio on stairs going UP (orchestra access steps); default = going-down ratio */
    stairRatioUp: number;
    stairRatioUpElderly: number;
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
    /**
     * weight of the outdoor walk beyond an exterior door in the route cost. People inside aim for
     * the exit door (leaving the building is the goal, as in Models B and C); 1 = route to the street.
     */
    outdoorWeight: number;
    /**
     * weight of a visible crowd inside aisles / cross-aisles / passages in the route cost
     * (same queue weighting as at gates); 0 = only door and stair queues are perceived
     */
    aisleQueueWeight: number;
    /** exit-choice noise is a persistent per-person taste (drawn once) instead of being redrawn at every decision */
    persistentTaste: boolean;
    /** evacuees never go back into the auditorium (D doors), the corridor (FC doors) or down into the orchestra */
    noReentry: boolean;
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
    /** posts to staff, in priority order (empty = the geometry's default order CM1, CM2, ...) */
    posts: string[];
    /** queue-based rebalancing by the Crowd Managers (see Guidance.ts) */
    rebalance: { enabled: boolean; interval: number; threshold: number };
    /**
     * placement strategy (Placements.ts): 'existing' = the geometry's posts (CM1, CM2, ...);
     * 'decision' | 'bottleneck' | 'hybrid222' | 'robust' = alternative six-manager layouts
     */
    placement: PlacementId;
    /** Model A research sensitivity: accepted staff guidance may use fully vacated seatways.
     * Uses existing row links and speeds; not enabled in the primary 04:20-model comparison. */
    vacatedRowGuidance?: boolean;
    /** Pre-agreed group instruction uses the original leader's seat block for every member.
     * Does not change hearing, acceptance, group waiting or movement. */
    groupPlan?: boolean;
  };
  /** exits announced before the emergency (pre-show announcement / seat cards), see Guidance.ts */
  preassign: {
    enabled: boolean;
    plan: Record<string, ExitGroupId>;
    /** share of attendees who heard / remember their assigned exit */
    reachProb: number;
    /** share of those who follow it (adopt it as guidance from t = 0) */
    complianceProb: number;
  };
  /** assisted evacuation of wheelchair users from the assistance point to the street */
  assist: {
    enabled: boolean;
    /** earliest time (s) staff are free to start assisting */
    staffAvailableAt: number;
    /** median duration (s) of one assisted descent (evacuation chair / carry down the main stair) */
    descentMedian: number;
    descentSigma: number;
    /** assisting teams working in parallel */
    teams: number;
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
    /** Optional 2-D visibility catchment. Each sign has ONE message, independent of seat origin. */
    spatial?: { range: number; halfAngleDegrees: number; occlusion: boolean; signs: GuidanceSign[] };
  };
  alarm: {
    recognitionExtra: number;
    /** time (s) from the declaration of the emergency (t = 0) until the alarm / announcement starts */
    declarationDelay: number;
    /** 'tone' = alarm sounder; 'voice' = informative voice message (shorter recognition and response) */
    mode: 'tone' | 'voice';
    voiceRecognitionFactor: number;
    voiceResponseFactor: number;
  };
  blocked: { links: string[]; knowledge: 'immediate' | 'announced' | 'discovery'; announceDelay: number; discoveryRange: number };
  barriers: string[];
  /** Optional interventions. Unspecified barriers retain Mateus's hard-closure meaning. */
  barrierTypes?: Record<string, 'hard-panel' | 'soft-rope'>;
  /** Perceived crossing time, not physical delay/capacity; uncalibrated sensitivity. */
  ropePenalty?: number;
  /** Conservative time integration. Off/absent preserves the 04:20 reference exactly. */
  numerics?: {
    conserveService: boolean;
    /** A only: count distance carried across an admitted boundary in the step velocity. */
    preserveTransitVelocity?: boolean;
    /** A only: evaluate following speed from positions at the start of the step. */
    synchronousHeadway?: boolean;
    /** Invalidate a route missing the current node before applying route inertia. */
    replanMissingPath?: boolean;
  };
  /** Explicit structural ablations; absent keeps the original microscopic model. */
  simplification?: {
    instantAcceleration?: boolean;
    clearRows?: boolean;
    fifoMerges?: boolean;
    groupPaceOnly?: boolean;
  };
  environment: {
    darkness: boolean;
    smoke: number;
    outdoorStairFactor: number;
    speedFactor: number;
  };
  /**
   * Dynamic behaviour and adaptive Crowd Managers (docs/ADAPTIVE.md). Both switches default to false,
   * which reproduces the previous fixed-behaviour model exactly (results/legacy-reference.json).
   */
  adaptive: AdaptiveConfig;
  /** density-over-time measurement (both models) */
  analysis: AnalysisConfig;
  stress: {
    falls: boolean;
    fallRate: number;
    fallDurationMedian: number;
    separatedGroups: number;
    /** responders entering against the flow: capacity of these gates is multiplied by capacityFactor from fromTime */
    responders: { links: string[]; fromTime: number; capacityFactor: number };
  };
  tMax: number;
}

export type PlacementId = 'existing' | 'decision' | 'bottleneck' | 'hybrid222' | 'robust' | 'coverage' | 'coverage10' | 'coverage12' | 'coverage18';

export interface AdaptiveConfig {
  /** dynamic individual behaviour: beliefs, confidence, urgency, trust, event-triggered rerouting */
  agents: boolean;
  /** adaptive Crowd Managers: local observation, radio, coordinated instruction policy, topological reach */
  managers: boolean;
  /** Keep seat-block instructions fixed except for known closures; retain acoustic/radio reach. */
  staticPlan?: boolean;
  // ---- individuals ----
  /** memory time constant (s) of information about an exit's congestion (belief and confidence decay) */
  memoryTau: number;
  /** utility weight of uncertainty: -wU * (1 - confidence) */
  uncertaintyWeight: number;
  /** minimum time (s) an exit choice is kept before a non-safety switch (reduced by urgency) */
  minCommit: number;
  /** minimum time (s) between two event-triggered re-evaluations of the same person */
  eventCooldown: number;
  /** event: waiting time exceeds max(waitExcessMin, waitExcessFactor x expected wait) */
  waitExcessFactor: number;
  waitExcessMin: number;
  /** event: visible queue on the current route exceeds the expected one by max(queueSurpriseMin, 50 %) */
  queueSurpriseMin: number;
  /** urgency u in [0, 1] scales the time weight by (1 + k u) and the familiarity weight by (1 - k u) */
  urgencyEffect: number;
  /** trust: loss after conflicting instructions / a bad experience with guidance, gain after confirmation */
  trustLoss: number;
  trustGain: number;
  /** hesitation (s) when two Crowd Managers give contradictory instructions */
  conflictDelay: number;
  /** spread (sd of a lognormal factor) of individual susceptibility to social influence */
  socialSusSd: number;
  /** congestion information: 'none' = no queue information; 'local' = own sight + memory + Crowd Managers; 'global' = every queue in the building visible (idealised benchmark only) */
  congestionInfo: 'none' | 'local' | 'global';
  // ---- Crowd Managers ----
  /** a person can hear a manager if the walking distance through the building is <= reachFactor x voice radius (walls block) */
  reachFactor: number;
  /** true: a person hears every manager they pass (one version counter per person and manager);
   *  false: only the first manager met, until an instruction changes (the previous model's rule; ablation) */
  hearEvery: boolean;
  /** 'zone': a manager redirects a whole planned exit (default); 'partial' (MODEL A ONLY): managers see
   *  the whole building and move individual people until the exits' drain times are balanced */
  redirectMode: 'zone' | 'partial';
  /** partial mode: a person is moved only if they finish at least this much earlier (s) */
  redirectMargin: number;
  /** Operational guard: do not add redirected people to narrow stage routes. Existing use remains. */
  redirectNoNewStage?: boolean;
  /** Earliest controller review; zero/absent preserves Mateus's policy. */
  redirectMinTime?: number;
  /** Partial-controller guard: anticipated opposing path demand within this many seconds. */
  redirectForecastSeconds?: number;
  /** partial mode: an alternative may be at most this much longer on foot (s); no U-turns */
  redirectMaxDetour: number;
  /** partial mode: a route with an opposing stream denser than this (persons/m2) on a link is not offered */
  redirectCounterflow: number;
  /** managers see queues at gates within this range (m), same floor, walking distance <= reachFactor x range */
  observeRange: number;
  /** observations become usable after this delay (s) */
  observeDelay: number;
  /** radio between managers */
  comm: 'radio' | 'none';
  /** probability that a radio message arrives */
  commReliability: number;
  /** radio delay (s) */
  commDelay: number;
  /** managers review their instruction every decisionInterval s (or at once after a closure / a critical bottleneck) */
  decisionInterval: number;
  /** an instruction is kept at least minHold s (except when its exit is found to be closed) */
  minHold: number;
  /** switch only when the alternative is better by more than switchThreshold s */
  switchThreshold: number;
  /** a gate with a known wait above criticalWait s is a critical bottleneck (immediate review) */
  criticalWait: number;
  /** a planned exit is decided by one lead manager; the others follow its radio decision */
  coordination: boolean;
  /** managers tell people the congestion they know about (updates beliefs) */
  shareCongestion: boolean;
  /** persons in reach a manager can handle (workload index reference) */
  workloadRef: number;
  /** formal reassignment: 'none' or 'whenClear' (a manager whose area is empty for 10 s co-supervises its neighbour's zones) */
  reassign: 'none' | 'whenClear';
}

export interface AnalysisConfig {
  /** analytical reference density rho_ref (persons/m^2) for exposure E_i = int max(0, rho - rho_ref) dt; NOT a safety threshold */
  densityRef: number;
  /** reference densities for 'time above' statistics (persons/m^2) */
  thresholds: number[];
  /** keep per-link density frames (heat-map replay) and full regional time series in the result */
  keepSeries: boolean;
}

export const DEFAULT_ADAPTIVE: AdaptiveConfig = {
  agents: false,
  managers: false,
  memoryTau: 60,
  uncertaintyWeight: 0.5,
  minCommit: 10,
  eventCooldown: 6,
  waitExcessFactor: 1.5,
  waitExcessMin: 12,
  queueSurpriseMin: 10,
  urgencyEffect: 0.5,
  trustLoss: 0.25,
  trustGain: 0.05,
  conflictDelay: 3,
  socialSusSd: 0.3,
  congestionInfo: 'local',
  reachFactor: 1.4,
  hearEvery: true,
  redirectMode: 'zone',
  redirectMargin: 5,
  redirectMaxDetour: 20,
  redirectCounterflow: 0.5,
  observeRange: 18,
  observeDelay: 2,
  comm: 'radio',
  commReliability: 0.9,
  commDelay: 3,
  decisionInterval: 5,
  minHold: 20,
  switchThreshold: 20,
  criticalWait: 30,
  coordination: true,
  shareCongestion: true,
  workloadRef: 80,
  reassign: 'none',
};

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
      groupWaitMax: 90,
      groupMeetOutside: false,
      stairRatioUp: 0.57,
      stairRatioUpElderly: 0.51,
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
      outdoorWeight: 0.2,
      aisleQueueWeight: 1,
      persistentTaste: true,
      noReentry: true,
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
      posts: [],
      rebalance: { enabled: false, interval: 5, threshold: 20 },
      placement: 'existing',
    },
    preassign: { enabled: false, plan: { ...DEFAULT_PLAN }, reachProb: 0.6, complianceProb: 0.7 },
    assist: { enabled: true, staffAvailableAt: 60, descentMedian: 60, descentSigma: 0.4, teams: 2 },
    led: {
      enabled: false,
      activationTime: 3,
      perceiveProb: 0.9,
      complianceProb: 0.7,
      plan: { ...DEFAULT_PLAN },
      conflictDelay: 4,
      dynamic: false,
    },
    alarm: { recognitionExtra: 0, declarationDelay: 0, mode: 'tone', voiceRecognitionFactor: 0.6, voiceResponseFactor: 0.8 },
    blocked: { links: [], knowledge: 'discovery', announceDelay: 45, discoveryRange: 6 },
    barriers: [],
    environment: { darkness: false, smoke: 0, outdoorStairFactor: 1, speedFactor: 1 },
    adaptive: { ...DEFAULT_ADAPTIVE },
    analysis: { densityRef: 2, thresholds: [1, 2, 3, 4], keepSeries: false },
    stress: { falls: false, fallRate: 0.002, fallDurationMedian: 15, separatedGroups: 0, responders: { links: [], fromTime: 60, capacityFactor: 0.6 } },
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
  { path: 'led.perceiveProb', label: 'LED detection probability (Bailey assumption)', unit: '-', status: 'ASSUMPTION', source: 'Filippidis et al. 2021 (floor strips assumed more visible: 0.9)', uncertainty: 'sweep' },
  { path: 'led.complianceProb', label: 'LED acceptance probability (Bailey assumption)', unit: '-', status: 'ASSUMPTION', source: 'Galea et al., improved ADSS trials (not a Bailey Hall value)', uncertainty: 'sweep 0.3-0.9' },
  { path: 'crowdManagers.complianceProb', label: 'Compliance with Crowd Manager instructions', unit: '-', status: 'ASSUMPTION', source: 'calibration data: theatre drills, Fire Technology 2018 (not extracted)', uncertainty: 'sweep 0.5-0.95' },
  { path: 'crowdManagers.radius', label: 'Voice range of a Crowd Manager', unit: 'm', status: 'ASSUMPTION', source: '-', uncertainty: '8-15 m' },
  { path: 'population.groupFraction', label: 'Share of attendees in social groups', unit: '-', status: 'ASSUMPTION', source: 'groups start later (Bode et al. 2015)', uncertainty: 'sweep' },
  { path: 'geometry.doorWidths', label: 'Door widths (D 1.6 m, P 1.6 m, FC 1.8 m, F 1.8 m, stage 1.0 m)', unit: 'm', status: 'ASSUMPTION', source: 'estimated from door-swing symbols on the scanned plans', uncertainty: '+/-0.3 m' },
  { path: 'geometry.scale', label: 'Plan scale 0.08 m per pixel', unit: 'm/px', status: 'ASSUMPTION', source: 'calibrated with chart dimensions and stated areas', uncertainty: '+/-6%' },
  { path: 'routing.outdoorWeight', label: 'Route goal is the exterior door; outdoor walk beyond it weighted 0.2', unit: '-', status: 'ASSUMPTION', source: "problem's definition of leaving the building; consistent with Models B and C (sinks at exterior doors)", uncertainty: 'sweep 0-1 (1 = route to the street)' },
  { path: 'routing.aisleQueueWeight', label: 'A visible crowd in an aisle / cross-aisle / passage counts like a queue (n / (lanes x 0.94 p/s))', unit: '-', status: 'ASSUMPTION', source: 'queue avoidance by sight (direction: Kinateder & Warren; Haghani 2020 review); Model B already perceives all visible queues', uncertainty: 'sweep 0-2' },
  { path: 'crowdManagers.plan (blocks)', label: 'Exit plan by seat block ZONE:SIDE:BAND (half-zone, front/back rows)', unit: '-', status: 'ASSUMPTION', source: 'operational choice; optimised by scripts/optimise-plan.ts', uncertainty: 'plan, not a physical parameter' },
  { path: 'crowdManagers.rebalance', label: 'Crowd Managers redirect zones when the planned exit is > 20 s worse (checked every 5 s)', unit: 's', status: 'ASSUMPTION', source: 'assumes radio contact / sight of queues; no data on staff reaction', uncertainty: 'threshold 10-40 s, interval 3-15 s' },
  { path: 'preassign.reachProb', label: 'Share of attendees who hear and remember a pre-show exit announcement (0.6)', unit: '-', status: 'ASSUMPTION', source: 'no venue data; direction: pre-event information increases use of emergency exits (Kinateder et al. review of exit choice)', uncertainty: 'sweep 0.3-0.9' },
  { path: 'preassign.complianceProb', label: 'Share of informed attendees who follow the announced exit (0.7)', unit: '-', status: 'ASSUMPTION', source: 'order of magnitude of staff / signage compliance used elsewhere in the model', uncertainty: 'sweep 0.4-0.9' },
  { path: 'alarm.voice*', label: 'Informative voice message: recognition x0.6, response x0.8 vs alarm tone', unit: '-', status: 'ASSUMPTION', source: 'direction from Proulx & Sime 1991 (informative messages start movement sooner); magnitudes assumed', uncertainty: 'high: sweep 0.4-1.0' },
  { path: 'alarm.declarationDelay', label: 'Time from declaring the emergency to the alarm (default 0 s)', unit: 's', status: 'ASSUMPTION', source: 'the 180 s clock starts at the declaration (problem statement)', uncertainty: 'sweep 0-20 s' },
  { path: 'population.groupWaitMax', label: 'Ready group members wait at most 90 s for the rest of the group', unit: 's', status: 'ASSUMPTION', source: '-', uncertainty: '30-120 s' },
  { path: 'population.groupMeetOutside', label: 'Intervention: groups agree to meet outside (no waiting / cohesion)', unit: '-', status: 'ASSUMPTION', source: 'operational message; effect of groups on start times: Bode et al. 2015 (direction)', uncertainty: 'compliance not modelled (all groups follow)' },
  { path: 'assist.*', label: 'Assisted descent of wheelchair users: 2 teams free from 60 s, 60 s per descent', unit: 's', status: 'ASSUMPTION', source: 'no evacuation-chair data extracted; affects street-level time only, not T_evac', uncertainty: 'descent 30-180 s' },
  { path: 'adaptive.*', label: 'Dynamic behaviour: memory 60 s, uncertainty weight 0.5, commitment 10 s, event thresholds 1.5x / 12 s / 10 s, urgency effect 0.5, trust -0.25 / +0.05', unit: '-', status: 'ASSUMPTION', source: 'mechanisms from the literature (information, queues, trust: Kinateder & Warren; Haghani 2020 review; Lovreglio et al. 2016); every magnitude assumed', uncertainty: 'high: see docs/ADAPTIVE.md' },
  { path: 'adaptive.redirectMode', label: 'Partial redirection: managers see the whole building and move individual people until the drain times of the exits are balanced (Model A only)', unit: '-', status: 'ASSUMPTION', source: 'project premise (managers see everything, share one plan); drain capacity = max flow through the gates', uncertainty: 'zone / partial' },
  { path: 'adaptive.redirectMargin', label: 'Partial redirection: minimum gain per person', unit: 's', status: 'ASSUMPTION', source: 'avoids moves for marginal gains; not measured', uncertainty: '0-20 s' },
  { path: 'adaptive.redirectMaxDetour', label: 'Partial redirection: alternative at most 20 s longer on foot, no U-turn (long detours mean walking against the crowd)', unit: 's', status: 'ASSUMPTION', source: 'physical plausibility; not measured', uncertainty: '10-40 s' },
  { path: 'adaptive.redirectCounterflow', label: 'Partial redirection: no route against an opposing stream denser than 0.5 p/m2', unit: 'p/m2', status: 'ASSUMPTION', source: 'counterflow in narrow aisles is slow (direction from bidirectional-flow experiments); threshold not measured', uncertainty: '0.2-1.5' },
  { path: 'adaptive.hearEvery', label: 'Every manager passed is heard (off: only the first one, as in the previous model)', unit: '-', status: 'ASSUMPTION', source: 'structural choice; ablation switch', uncertainty: 'on / off' },
  { path: 'adaptive.reachFactor', label: 'Voice reach needs walking distance <= 1.4 x radius (walls and closed rooms block)', unit: '-', status: 'ASSUMPTION', source: 'geometric proxy for line of sight / acoustics; not measured', uncertainty: '1.1-2' },
  { path: 'adaptive.observe*', label: 'Managers see gates within 18 m (same floor, walkable), observations usable after 2 s', unit: 'm, s', status: 'ASSUMPTION', source: '-', uncertainty: 'range 10-30 m, delay 0-10 s' },
  { path: 'adaptive.comm*', label: 'Radio between managers: 90 % of messages arrive after 3 s', unit: '-', status: 'ASSUMPTION', source: 'no Bailey Hall data', uncertainty: 'reliability 0.5-1, delay 1-15 s' },
  { path: 'adaptive.minHold', label: 'Managers keep an instruction >= 20 s; switch only if >= 20 s better', unit: 's', status: 'ASSUMPTION', source: 'anti-oscillation design choice', uncertainty: '10-40 s' },
  { path: 'adaptive.workloadRef', label: 'Workload index reference: 80 persons in reach per manager', unit: 'persons', status: 'ASSUMPTION', source: 'operational index, not validated', uncertainty: 'high' },
  { path: 'analysis.densityRef', label: 'Reference density 2 p/m^2 for exposure statistics (analytical reference, not a safety limit)', unit: 'p/m^2', status: 'ASSUMPTION', source: 'order of densities where walking speed falls markedly (Weidmann 1993; Fruin levels of service); no safety claim', uncertainty: 'report 1-4 p/m^2' },
  { path: 'regions.area', label: 'Region areas = sum of link length x clear width of the reconstructed geometry', unit: 'm^2', status: 'ASSUMPTION', source: 'widths estimated from the plans (+/- 0.3 m), see DensityRegions.ts', uncertainty: '+/- 20-30 % for narrow aisles' },
  { path: 'stress.responders', label: 'Responders entering through listed doors cut their capacity (x0.6 from 60 s)', unit: '-', status: 'ASSUMPTION', source: 'stress test only', uncertainty: 'high' },
];
