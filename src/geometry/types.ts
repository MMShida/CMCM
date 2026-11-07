/**
 * Geometry data model for the Bailey Hall reconstruction.
 *
 * World coordinates are in METRES. Origin = centre of the corridor arc on the
 * first-floor plan (plan pixel (443,300) of page 4 of the problem PDF).
 * +x points east, +y points SOUTH (screen-down), so the stage is at negative y
 * and the foyer / main entrance at positive y. North is "up" on screen, which
 * matches the orientation of the PDF floor plans.
 */

export type Floor = 0 | 1 | 2; // 0 = outside/street or ground-level exterior, 1 = first floor, 2 = balcony

export type NodeKind =
  | 'junction'
  | 'deadEnd'
  | 'safe' // absorbing: street level / outside safe destination
  | 'refuge' // assisted-evacuation waiting point (outside building but not safe for wheelchair users)
  | 'elevator'; // shown on the map but never connected (use prohibited in evacuation)

export type LinkKind =
  | 'row' // seat row (lane in front of seats)
  | 'aisle'
  | 'crossAisle'
  | 'walkway'
  | 'corridor'
  | 'foyer'
  | 'door'
  | 'stair'
  | 'landing'
  | 'portico'
  | 'outdoor'
  | 'passage';

export type ExitGroupId =
  | 'FOYER'
  | 'PORTICO_W'
  | 'PORTICO_E'
  | 'STAGE_W'
  | 'STAGE_E'
  | 'BAL_NW'
  | 'BAL_NE';

export const EXIT_GROUPS: ExitGroupId[] = ['FOYER', 'PORTICO_W', 'PORTICO_E', 'STAGE_W', 'STAGE_E', 'BAL_NW', 'BAL_NE'];

export const EXIT_GROUP_LABEL: Record<ExitGroupId, string> = {
  FOYER: 'Main foyer (5 doors + monumental stair)',
  PORTICO_W: 'West portico (side doors + W stair)',
  PORTICO_E: 'East portico (side doors + E stair)',
  STAGE_W: 'Stage escape route West',
  STAGE_E: 'Stage escape route East',
  BAL_NW: 'Balcony NW stairwell (to outside)',
  BAL_NE: 'Balcony NE stairwell (to outside)',
};

export interface GNode {
  id: string;
  x: number;
  y: number;
  floor: Floor;
  kind: NodeKind;
  label?: string;
  /** For safe nodes: which exit group this destination belongs to. */
  exitGroup?: ExitGroupId;
  /** true if the position was estimated rather than read from a dimensioned drawing. */
  approx?: boolean;
  note?: string;
}

export interface GLink {
  id: string;
  a: string;
  b: string;
  /** Polyline from node a to node b (inclusive of endpoints). */
  pts: [number, number][];
  /** Usable (clear) width in metres. */
  width: number;
  kind: LinkKind;
  floor: Floor;
  /** Number of walking lanes; defaults to max(1, floor(width / laneWidth)). */
  lanes?: number;
  /** lanes are physically separated by a barrier/handrail (stairs): boundary layer per lane */
  laneBarrier?: boolean;
  /** Doors / stair entries are capacity-limited gates (token bucket at link entry). */
  gate?: boolean;
  /** Crossing this link (a->b direction) takes the agent OUT of the building. */
  exterior?: boolean;
  /** Exterior door belongs to this exit group (for usage statistics). */
  exitGroup?: ExitGroupId;
  /** Vertical rise in metres (stairs). Positive = node b is LOWER than node a. */
  drop?: number;
  /** Physically usable by wheelchair users. */
  accessible?: boolean;
  /** One-way links may only be traversed from a to b. */
  oneWay?: boolean;
  /** A slot where a temporary corridor barrier may be placed. */
  barrierSlot?: boolean;
  /** Never usable for evacuation (elevator etc.). */
  prohibited?: boolean;
  /** Short, human readable label (door IDs etc.). */
  label?: string;
  approx?: boolean;
  /** Where this element comes from (drawing/assumption). */
  source?: string;
}

export interface Seat {
  id: string;
  level: 'orchestra' | 'mezzanine' | 'balcony';
  section: string;
  row: string;
  /** Row link the seat sits on and the distance from that link's node a. */
  link: string;
  s: number;
  x: number;
  y: number;
  /** Guidance zone (used by Crowd Manager plans and LED guidance). */
  zone: string;
  wheelchair?: boolean;
  /** Distance (m) to the nearest usable row end. */
  aisleDist: number;
  /** Index of the row counted from the front of its section (0 = closest to stage / rail). */
  rowIndex: number;
}

export interface WallPolyline {
  id: string;
  floor: Floor;
  pts: [number, number][];
  kind: 'wall' | 'barrier' | 'rail' | 'stage' | 'outline' | 'column';
  approx?: boolean;
}

export interface MapOverlay {
  id: string;
  floor: Floor;
  image: string;
  label: string;
  /** Affine transform image pixel -> world metres: x = ox + sx*(px*cos - py*sin), etc. */
  pxOrigin: [number, number];
  metresPerPxX: number;
  metresPerPxY: number;
  rotationDeg: number;
  /** World coordinate of pxOrigin. */
  worldOrigin: [number, number];
}

export interface ZoneDef {
  id: string;
  label: string;
  level: 'orchestra' | 'mezzanine' | 'balcony';
  /** Default exit group recommended by the baseline Crowd-Manager / LED plan. */
  defaultExit: ExitGroupId;
}

export interface CrowdManagerPost {
  id: string;
  x: number;
  y: number;
  floor: Floor;
  label: string;
  /** Zones this post is responsible for. */
  zones: string[];
}

export interface GeometryData {
  version: number;
  name: string;
  notes: string[];
  nodes: GNode[];
  links: GLink[];
  seats: Seat[];
  walls: WallPolyline[];
  overlays: MapOverlay[];
  zones: ZoneDef[];
  crowdManagerPosts: CrowdManagerPost[];
  /** Official capacities from the problem statement. */
  capacity: { orchestra: number; mezzanine: number; balcony: number; total: number; wheelchair: number };
  labels: { x: number; y: number; floor: Floor; text: string; size?: number }[];
}
