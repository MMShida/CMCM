/**
 * Scenario presets. Each preset is a full SimConfig derived from the defaults;
 * everything remains editable in the UI or via JSON (no source changes needed).
 */
import { BAILEY_HALL, slotId } from '../geometry/BaileyHall';
import type { ExitGroupId, GeometryData } from '../geometry/types';
import type { DeepPartial, SimConfig } from './Params';
import OPTIMISED from '../data/plans/optimised-A.json';
import { DEFAULT_PLAN, defaultConfig, mergeConfig } from './Params';

/** Seat-block plan optimised with Model A (scripts/optimise-plan.ts, results/plans/opt-A-so.json). */
export const OPTIMISED_PLAN = OPTIMISED.plan as Record<string, ExitGroupId>;

/** Optimised plan used by the Crowd Managers (and LEDs if enabled). */
export function optimisedPlan(): SimConfig {
  return with_('optimised-plan', 'CM + optimised seat-block plan', { crowdManagers: { plan: { ...OPTIMISED_PLAN } } });
}

/** Optimised plan announced before the show (pre-assigned exits) and used by the Crowd Managers. */
export function preassigned(): SimConfig {
  return with_('preassigned', 'Optimised plan + pre-assigned exits', { crowdManagers: { plan: { ...OPTIMISED_PLAN } }, preassign: { enabled: true, plan: { ...OPTIMISED_PLAN } } });
}

/**
 * Operations package aimed at the 180 s rule: optimised and pre-announced plan, informative
 * voice alarm, groups told to meet outside, Crowd Managers rebalancing on queues.
 */
export function package180(): SimConfig {
  return with_('package-180', '180 s package (plan + pre-assignment + voice + meet outside + rebalancing)', {
    crowdManagers: { plan: { ...OPTIMISED_PLAN }, rebalance: { enabled: true, interval: 5, threshold: 20 } },
    preassign: { enabled: true, plan: { ...OPTIMISED_PLAN } },
    alarm: { mode: 'voice' },
    population: { groupMeetOutside: true },
  });
}

export interface ScenarioDef {
  id: string;
  name: string;
  group: 'core' | 'additional' | 'stress';
  description: string;
  /** simplified stress test (not a physically validated mechanism) */
  approximate?: boolean;
  build: (geo: GeometryData) => SimConfig;
}

const base = () => defaultConfig();
const with_ = (id: string, label: string, patch: DeepPartial<SimConfig>, from: SimConfig = base()) => {
  const c = mergeConfig(from, patch);
  c.scenarioId = id;
  c.label = label;
  return c;
};

export function concertDeparture(): SimConfig {
  return with_('concert-departure', 'Ordinary concert departure', {
    isEmergency: false,
    population: {
      speedMean: 1.1,
      typeShares: { shortest: 0.15, habitual: 0.5, follower: 0.25, queueAvoider: 0.05, cooperative: 0.05, impatient: 0 },
      exitKnowledge: { FOYER: 1, PORTICO_W: 0.1, PORTICO_E: 0.1, STAGE_W: 0, STAGE_E: 0, BAL_NW: 0.05, BAL_NE: 0.05 },
      familiarityProb: 0.05,
      groupFraction: 0.6,
      belongingsProb: 0.9,
      belongingsMedian: 20,
      belongingsSigma: 0.6,
      luggageFlowFactor: 0.95,
    },
    premovement: { recognitionMedian: 2, recognitionSigma: 0.5, responseMedian: 10, responseSigma: 0.8, socialKappa: 1.0 },
    routing: { noticeProb: 0.05 },
    movement: { urgency: 0 },
    crowdManagers: { count: 0 },
    tMax: 1800,
  });
}

export function concertEmergency(): SimConfig {
  return with_('concert-emergency', 'Concert emergency (6 Crowd Managers)', {});
}

export function lecture(): SimConfig {
  return with_('lecture', 'University lecture (students, no Crowd Managers)', {
    population: {
      speedMean: 1.35,
      speedSd: 0.2,
      elderlyFraction: 0,
      typeShares: { shortest: 0.35, habitual: 0.25, follower: 0.15, queueAvoider: 0.15, cooperative: 0.05, impatient: 0.05 },
      familiarityProb: 0.9,
      exitKnowledge: { FOYER: 1, PORTICO_W: 0.9, PORTICO_E: 0.9, STAGE_W: 0.7, STAGE_E: 0.7, BAL_NW: 0.9, BAL_NE: 0.9 },
      groupFraction: 0.2,
      belongingsProb: 0.95,
      belongingsMedian: 10,
      belongingsSigma: 0.5,
      luggageFlowFactor: 0.92,
    },
    premovement: { recognitionMedian: 5, recognitionSigma: 0.6, responseMedian: 22, responseSigma: 0.7, familiarityCoef: 0.1 },
    movement: { urgency: 0.5 },
    crowdManagers: { count: 0 },
  });
}

export function blockedExit(linkId = 'FC2', knowledge: SimConfig['blocked']['knowledge'] = 'discovery'): SimConfig {
  return with_(`blocked-${linkId}-${knowledge}`, `Emergency, ${linkId} blocked (${knowledge})`, {
    blocked: { links: [linkId], knowledge, announceDelay: 45 },
  });
}

export function barriers(geo: GeometryData = BAILEY_HALL, slots = ['W1', 'E1']): SimConfig {
  return with_('barriers', `Emergency + corridor barriers (${slots.join(', ')})`, { barriers: slots.map((s) => slotId(geo, s)) });
}

export function led(): SimConfig {
  return with_('led', 'Emergency + directional LED guidance', { led: { enabled: true } });
}

const allFoyer = (): Record<string, ExitGroupId> => Object.fromEntries(Object.keys(DEFAULT_PLAN).map((k) => [k, 'FOYER' as ExitGroupId]));

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'concert-departure',
    name: '1. Ordinary concert departure',
    group: 'core',
    description: 'No emergency: long reaction times, coats, groups, habitual main-entrance exit, no Crowd Manager guidance, emergency-only exits unknown.',
    build: () => concertDeparture(),
  },
  {
    id: 'concert-emergency',
    name: '2. Concert emergency (baseline)',
    group: 'core',
    description: 'Full house (1,329), alarm, six Crowd Managers with a balanced zone plan, 80% compliance, all exits available.',
    build: () => concertEmergency(),
  },
  {
    id: 'blocked-discovery',
    name: '3a. Blocked exit (FC2), discovered on approach',
    group: 'core',
    description: 'Centre foyer connection FC2 obstructed; people learn only when they see it (6 m) or from neighbours.',
    build: () => blockedExit('FC2', 'discovery'),
  },
  {
    id: 'blocked-announced',
    name: '3b. Blocked exit (FC2), announced after 45 s',
    group: 'core',
    description: 'Crowd Managers learn of the obstruction at t = 45 s and redirect their zones.',
    build: () => blockedExit('FC2', 'announced'),
  },
  {
    id: 'blocked-immediate',
    name: '3c. Blocked exit (FC2), everyone knows',
    group: 'core',
    description: 'Everyone knows about the obstruction from the start (upper bound on information).',
    build: () => blockedExit('FC2', 'immediate'),
  },
  {
    id: 'lecture',
    name: '4. University lecture',
    group: 'core',
    description: 'Students: faster, familiar with all emergency exits (drills), backpacks/laptops, longer response (doubt), no Crowd Managers.',
    build: () => lecture(),
  },
  {
    id: 'barriers',
    name: '5. Temporary corridor barriers',
    group: 'core',
    description: 'Barriers at corridor slots W1/E1 (between side door P2 and mezzanine door D3, and mirrored): loge doors D1/D2 feed the portico, curve and centre doors feed the foyer. Chosen from the barrier-position experiment (docs/RESULTS.md section F).',
    build: (g) => barriers(g),
  },
  {
    id: 'led',
    name: '6. Directional LED guidance',
    group: 'core',
    description: 'LED strips direct each seating zone to its planned exit group (perceived 90%, complied 70%), agreeing with the Crowd Managers.',
    build: () => led(),
  },
  {
    id: 'led-barriers',
    name: '6b. LED + corridor barriers',
    group: 'core',
    description: 'Both interventions combined (Crowd Managers still present).',
    build: (g) => with_('led-barriers', 'Emergency + LED + barriers (W1, E1)', { led: { enabled: true }, barriers: ['W1', 'E1'].map((s) => slotId(g, s)) }),
  },
  {
    id: 'led-conflict',
    name: '6c. LED contradicts Crowd Managers',
    group: 'additional',
    description: 'Failure mode: LED plan sends everyone to the foyer while Crowd Managers use the balanced plan.',
    build: () => with_('led-conflict', 'LED contradicting Crowd Managers', { led: { enabled: true, plan: allFoyer() } }),
  },
  {
    id: 'no-guidance',
    name: 'Emergency without Crowd Managers (reference)',
    group: 'additional',
    description: 'Same audience and alarm, but no staff guidance at all (not legal; reference point).',
    build: () => with_('no-guidance', 'Emergency, no guidance', { crowdManagers: { count: 0 } }),
  },
  {
    id: 'occ-25',
    name: 'Occupancy 25%',
    group: 'additional',
    description: '25% of seats on each level; Crowd Managers = ceil(N/250).',
    build: () => with_('occ-25', 'Emergency, 25% occupancy', { occupancy: { orchestra: 0.25, mezzanine: 0.25, balcony: 0.25 }, crowdManagers: { count: -1 } }),
  },
  {
    id: 'occ-50',
    name: 'Occupancy 50%',
    group: 'additional',
    description: '50% of seats; Crowd Managers = ceil(N/250).',
    build: () => with_('occ-50', 'Emergency, 50% occupancy', { occupancy: { orchestra: 0.5, mezzanine: 0.5, balcony: 0.5 }, crowdManagers: { count: -1 } }),
  },
  {
    id: 'occ-75',
    name: 'Occupancy 75%',
    group: 'additional',
    description: '75% of seats; Crowd Managers = ceil(N/250).',
    build: () => with_('occ-75', 'Emergency, 75% occupancy', { occupancy: { orchestra: 0.75, mezzanine: 0.75, balcony: 0.75 }, crowdManagers: { count: -1 } }),
  },
  {
    id: 'cm-missing',
    name: 'One Crowd Manager unavailable',
    group: 'additional',
    description: 'Crowd Manager CM3 (mezzanine west) absent; only five on duty.',
    build: () => with_('cm-missing', 'Emergency, CM3 absent', { crowdManagers: { unavailable: ['CM3'] } }),
  },
  {
    id: 'older',
    name: 'Older audience',
    group: 'additional',
    description: '60% over 65 (20-25% slower walking, slower stairs).',
    build: () => with_('older', 'Emergency, older audience', { population: { elderlyFraction: 0.6, speedMean: 1.15 } }),
  },
  {
    id: 'younger',
    name: 'Younger audience',
    group: 'additional',
    description: 'No elderly attendees, faster walking.',
    build: () => with_('younger', 'Emergency, younger audience', { population: { elderlyFraction: 0, speedMean: 1.3 } }),
  },
  {
    id: 'winter',
    name: 'Winter: coats and icy outdoor stairs',
    group: 'additional',
    description: 'Everyone collects a coat, outdoor stairs 30% slower and lower capacity (ice/snow).',
    approximate: true,
    build: () => with_('winter', 'Emergency, winter', { population: { belongingsProb: 1, belongingsMedian: 15, luggageFlowFactor: 0.92 }, environment: { outdoorStairFactor: 0.7 } }),
  },
  {
    id: 'uneven',
    name: 'Uneven occupancy (full balcony)',
    group: 'additional',
    description: 'Balcony 100%, mezzanine 80%, orchestra 40%.',
    build: () => with_('uneven', 'Emergency, uneven occupancy', { occupancy: { orchestra: 0.4, mezzanine: 0.8, balcony: 1 }, crowdManagers: { count: -1 } }),
  },
  {
    id: 'darkness',
    name: 'Power failure / darkness',
    group: 'stress',
    description: 'House lights out: slower walking (x0.85), visibility 40%, longer recognition, exit signs harder to notice.',
    approximate: true,
    build: () => with_('darkness', 'Emergency, darkness', { environment: { darkness: true } }),
  },
  {
    id: 'smoke',
    name: 'Reduced visibility (smoke, simplified)',
    group: 'stress',
    description: 'Smoke level 0.5: speed x0.8, visibility x0.65. NOT a validated smoke model (Jin / Frantzich-Nilsson not implemented).',
    approximate: true,
    build: () => with_('smoke', 'Emergency, smoke 0.5 (simplified)', { environment: { smoke: 0.5 } }),
  },
  {
    id: 'blocked-foyer',
    name: 'Blocked foyer (fire in the foyer)',
    group: 'stress',
    description: 'All three foyer connections closed; Crowd Managers announce after 30 s.',
    approximate: true,
    build: () => with_('blocked-foyer', 'Emergency, foyer blocked', { blocked: { links: ['FC1', 'FC2', 'FC3'], knowledge: 'announced', announceDelay: 30 } }),
  },
  {
    id: 'fire-stage',
    name: 'Fire near the stage',
    group: 'stress',
    description: 'Stage escape routes and balcony stage-side stairwells unusable (known immediately: visible fire).',
    approximate: true,
    build: () => with_('fire-stage', 'Emergency, stage routes lost', { blocked: { links: ['SDW', 'SDE', 'BNDW', 'BNDE'], knowledge: 'immediate' } }),
  },
  {
    id: 'falls',
    name: 'Falls on stairs (stress test)',
    group: 'stress',
    description: 'Density- and speed-dependent fall probability on stairs; a fallen person blocks the lane ~15 s. Simplified, not validated.',
    approximate: true,
    build: () => with_('falls', 'Emergency, falls on stairs', { stress: { falls: true, fallRate: 0.01 } }),
  },
  {
    id: 'reunite',
    name: 'Separated groups / counterflow (intermission)',
    group: 'stress',
    description: '30% of groups have a member in the foyer/corridor who walks back to rejoin them, creating counterflow.',
    approximate: true,
    build: () => with_('reunite', 'Emergency, separated groups', { stress: { separatedGroups: 0.3 } }),
  },
  {
    id: 'optimised-plan',
    name: '7. Optimised seat-block plan',
    group: 'core',
    description: 'Crowd Managers use the seat-block plan found by scripts/optimise-plan.ts (front halves of the centre orchestra to the porticos via the front access stairs, part of the back to the porticos / stage exits).',
    build: () => optimisedPlan(),
  },
  {
    id: 'preassigned',
    name: '8. Optimised plan + pre-assigned exits',
    group: 'core',
    description: 'The optimised plan is also announced before the show (60% hear it, 70% of them follow it from t = 0).',
    build: () => preassigned(),
  },
  {
    id: 'package-180',
    name: '9. 180 s operations package',
    group: 'core',
    description: 'Optimised + pre-announced plan, informative voice alarm, groups meet outside, Crowd Managers rebalance on queues.',
    build: () => package180(),
  },
  {
    id: 'voice-alarm',
    name: 'Informative voice alarm',
    group: 'additional',
    description: 'Voice message instead of an alarm tone: recognition x0.6, response x0.8 (assumed magnitudes; direction from Proulx & Sime 1991).',
    build: () => with_('voice-alarm', 'Emergency, voice alarm', { alarm: { mode: 'voice' } }),
  },
  {
    id: 'meet-outside',
    name: 'Groups meet outside',
    group: 'additional',
    description: 'Announcement: groups leave individually and meet outside (no waiting for members, no cohesion).',
    build: () => with_('meet-outside', 'Emergency, groups meet outside', { population: { groupMeetOutside: true } }),
  },
  {
    id: 'rebalance',
    name: 'Crowd Managers rebalance on queues',
    group: 'additional',
    description: 'Every 5 s each active Crowd Manager redirects its zones if the planned exit is more than 20 s slower than the best alternative.',
    build: () => with_('rebalance', 'Emergency, CM queue rebalancing', { crowdManagers: { rebalance: { enabled: true } } }),
  },
  {
    id: 'late-alarm',
    name: 'Alarm 10 s after the declaration',
    group: 'stress',
    description: 'The 180 s clock starts at the declaration; the alarm sounds 10 s later.',
    approximate: true,
    build: () => with_('late-alarm', 'Emergency, alarm 10 s late', { alarm: { declarationDelay: 10 } }),
  },
  {
    id: 'responders',
    name: 'Responders entering through the foyer',
    group: 'stress',
    description: 'From 60 s, responders entering through F2-F4 reduce those doors to 60% capacity.',
    approximate: true,
    build: () => with_('responders', 'Emergency, responders entering', { stress: { responders: { links: ['F2', 'F3', 'F4'], fromTime: 60, capacityFactor: 0.6 } } }),
  },
  {
    id: 'competitive',
    name: 'Faster-is-slower test (high competitiveness)',
    group: 'stress',
    description: 'Urgency 1.0 and 60% impatient agents: tests whether clogging lowers door throughput.',
    approximate: true,
    build: () =>
      with_('competitive', 'Emergency, highly competitive crowd', {
        movement: { urgency: 1 },
        population: { typeShares: { shortest: 0.15, habitual: 0.1, follower: 0.1, queueAvoider: 0.05, cooperative: 0, impatient: 0.6 } },
      }),
  },
];

export function scenarioById(id: string, geo: GeometryData = BAILEY_HALL): SimConfig {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s.build(geo);
}

/** Strategy set for the experiment (comparison) mode. */
export interface StrategyDef {
  id: string;
  name: string;
  build: (geo: GeometryData) => SimConfig;
}

export const STRATEGIES: StrategyDef[] = [
  { id: 'S0', name: 'S0 Emergency, no guidance', build: () => with_('S0', 'S0 no guidance', { crowdManagers: { count: 0 } }) },
  { id: 'S1', name: 'S1 Crowd Managers only', build: () => with_('S1', 'S1 Crowd Managers', {}) },
  { id: 'S2', name: 'S2 CM + LED', build: () => with_('S2', 'S2 CM + LED', { led: { enabled: true } }) },
  { id: 'S3', name: 'S3 CM + barriers', build: (g) => with_('S3', 'S3 CM + barriers', { barriers: ['W1', 'E1'].map((s) => slotId(g, s)) }) },
  { id: 'S4', name: 'S4 CM + LED + barriers', build: (g) => with_('S4', 'S4 CM + LED + barriers', { led: { enabled: true }, barriers: ['W1', 'E1'].map((s) => slotId(g, s)) }) },
  { id: 'S5', name: 'S5 FC2 blocked, static guidance', build: () => with_('S5', 'S5 blocked, static', { blocked: { links: ['FC2'], knowledge: 'discovery' }, crowdManagers: { dynamic: false } }) },
  { id: 'S7', name: 'S7 CM + optimised block plan', build: () => with_('S7', 'S7 optimised plan', { crowdManagers: { plan: { ...OPTIMISED_PLAN } } }) },
  {
    id: 'S8',
    name: 'S8 S7 + pre-assigned exits',
    build: () => with_('S8', 'S8 optimised + pre-assigned', { crowdManagers: { plan: { ...OPTIMISED_PLAN } }, preassign: { enabled: true, plan: { ...OPTIMISED_PLAN } } }),
  },
  { id: 'S9', name: 'S9 180 s package', build: () => { const c = package180(); c.scenarioId = 'S9'; c.label = 'S9 180 s package'; return c; } },
  {
    id: 'S6',
    name: 'S6 FC2 blocked, dynamic CM + LED',
    build: () => with_('S6', 'S6 blocked, dynamic', { blocked: { links: ['FC2'], knowledge: 'announced', announceDelay: 20 }, crowdManagers: { dynamic: true }, led: { enabled: true, dynamic: true } }),
  },
];
