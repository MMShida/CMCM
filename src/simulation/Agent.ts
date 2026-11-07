/**
 * Individual evacuee. Plain class with numeric fields for speed (1,329 agents,
 * thousands of steps per run, hundreds of runs per batch).
 */
import type { BehaviorType } from './Params';

/** Behavioural / physical states (pre-movement state machine + movement states). */
export const ST = {
  UNAWARE: 0, // seated, has not recognised the cue
  AWARE: 1, // recognised the cue, deciding / finishing what they were doing
  PREPARING: 2, // standing up, collecting belongings / coat
  WAITING: 3, // ready, waiting for group members or for a gap to enter the row
  MOVING: 4,
  QUEUING: 5, // moving state but blocked (speed < 30% of desired)
  REROUTING: 6, // display-only flag: moving after a recent route change
  ASSISTING: 7, // stopped to help a fallen person (stress scenario)
  FALLEN: 8, // stress scenario: temporarily on the ground, blocks the lane
  REUNITING: 9, // separated group member moving against the flow
  OUTSIDE: 10, // left the building (crossed an exterior door) but not yet at street level
  EXITED: 11, // reached a safe destination (absorbing)
  AWAITING_ASSIST: 12, // wheelchair user at an assistance point outside; NOT counted as safe
  TRAPPED: 13, // no known/usable route for a long time (reported explicitly)
} as const;
export type StateCode = (typeof ST)[keyof typeof ST];

export const STATE_LABEL: Record<number, string> = {
  0: 'Unaware',
  1: 'Aware (deciding)',
  2: 'Preparing / belongings',
  3: 'Waiting (group / row gap)',
  4: 'Moving',
  5: 'Queuing',
  6: 'Rerouting',
  7: 'Assisting',
  8: 'Fallen (stress test)',
  9: 'Reuniting (counterflow)',
  10: 'Outside building',
  11: 'Safe (street level)',
  12: 'Awaiting assistance',
  13: 'Trapped / no route',
};

export const STATE_COLOR: Record<number, string> = {
  0: '#9aa3ad',
  1: '#f2c94c',
  2: '#f2994a',
  3: '#bb6bd9',
  4: '#2f80ed',
  5: '#eb5757',
  6: '#27ae60',
  7: '#56ccf2',
  8: '#000000',
  9: '#ff4fd8',
  10: '#6fcf97',
  11: '#6fcf97',
  12: '#d4145a',
  13: '#5b0000',
};

export const TYPE_CODE: Record<BehaviorType, number> = {
  shortest: 0,
  habitual: 1,
  follower: 2,
  queueAvoider: 3,
  cooperative: 4,
  impatient: 5,
};

export const REASON = {
  NONE: 0,
  HABIT: 1,
  SHORTEST: 2,
  SOCIAL: 3,
  QUEUE: 4,
  CM: 5,
  LED: 6,
  GROUP: 7,
  BLOCKED: 8,
  ONLY_KNOWN: 9,
  ACCESSIBLE: 10,
  REUNITE: 11,
} as const;
export const REASON_LABEL: Record<number, string> = {
  0: '-',
  1: 'Habit / familiar main entrance',
  2: 'Shortest estimated time',
  3: 'Following nearby people',
  4: 'Avoiding a visible queue',
  5: 'Crowd Manager instruction',
  6: 'LED floor/wall guidance',
  7: 'Staying with group (leader\'s choice)',
  8: 'Rerouted after discovering a blocked exit',
  9: 'Only exit known',
  10: 'Accessible route (wheelchair)',
  11: 'Going back to reunite with group',
};

export class Agent {
  readonly id: number;
  seat: number; // seat index in geometry.seats
  type: BehaviorType;
  typeCode: number;
  // physical attributes
  v0 = 1.2;
  stairRatio = 0.57;
  radius = 0.22;
  elderly = false;
  wheelchair = false;
  impatience = 0.3; // 0..1 merge aggressiveness
  familiar = false;
  // random uniforms fixed at birth (common random numbers across strategies)
  uCM = 0;
  uLED = 0;
  uLEDsee = 0;
  // pre-movement
  tRecognition = 0; // intrinsic time to recognise the cue (s)
  tResponse = 0; // intrinsic decision time (s)
  tPrepare = 0; // belongings / coat time (s)
  clock = 0; // social-accelerated progress through the current phase
  state: number = ST.UNAWARE;
  tAware = NaN;
  tStartMove = NaN;
  tLeftBuilding = NaN;
  tSafe = NaN;
  neighbours: Int32Array = new Int32Array(0);
  socialPhi = 0;
  instructedCM = false;
  cmGroup = -1; // exit group recommended by a Crowd Manager (if complied)
  ledGroup = -1;
  ledSeen = false;
  hesitate = 0; // remaining hesitation time (s)
  // knowledge
  knownExits = 0; // bitmask over EXIT_GROUPS
  knownBlocked: number[] = []; // link indices known to be closed
  blockedSig = ''; // cache key for routing fields
  // group
  group = -1;
  groupLeader = true;
  separated = false; // stress: starts away from the group
  // routing
  targetGroup = -1;
  reason: number = REASON.NONE;
  reroutes = 0;
  rerouteFlash = 0;
  lastNode = -1;
  noRouteTime = 0;
  utilities: number[] = [];
  meetNode = -1; // reunite target node
  // movement
  link = -1;
  dir: 1 | -1 = 1;
  sDir = 0; // distance travelled along the link in travel direction
  lane = 0;
  v = 0;
  vDes = 0;
  latOffset = 0; // visual lateral offset (m)
  segHint = 1;
  x = 0;
  y = 0;
  floor = 1;
  pendingRowDir: 1 | -1 = 1;
  blockedTime = 0;
  waitTarget = -1; // link index the agent is (ultimately) queuing for
  waitTotal = 0;
  fallTimer = 0;
  exitLink = -1; // exterior door used
  densityHere = 0;
  pendingNext = -1; // adjacency index chosen at the current node (cached until admitted)
  holdAtNode = false; // reuniting member waiting at the meeting point
  arrivedMeet = false;
  remCost = 0;
  groupCap = Infinity;
  // planned path (from the agent's forward search)
  pathNodes: number[] = [];
  pathAdj: number[] = [];
  pathPos = 0;
  pathValid = false;
  pathGroup = -1;
  groupCosts: number[] = [];

  constructor(id: number, seat: number, type: BehaviorType) {
    this.id = id;
    this.seat = seat;
    this.type = type;
    this.typeCode = TYPE_CODE[type];
  }

  get isSeated(): boolean {
    return this.link < 0 && this.state <= ST.WAITING && !this.separated;
  }
  get done(): boolean {
    return this.state === ST.EXITED || this.state === ST.AWAITING_ASSIST || this.state === ST.TRAPPED;
  }
  /** still inside the building (has not crossed an exterior door) */
  get inside(): boolean {
    return Number.isNaN(this.tLeftBuilding);
  }
}
