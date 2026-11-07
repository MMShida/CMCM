/**
 * Parametric reconstruction of Bailey Hall (first floor + balcony).
 *
 * This file GENERATES the editable geometry JSON (src/data/geometry/bailey-hall.json)
 * via `npm run geometry`. The simulator itself only reads the JSON, so manual
 * corrections can be made either here (parametrically) or directly in the JSON /
 * with the in-app geometry editor.
 *
 * Every dimension below was estimated from the PDF floor plans (pages 4-5,
 * ~0.08 m per plan pixel) and seating charts (pages 6-7). Values marked
 * [DIM] come from dimension strings printed on the seating charts, [PLAN]
 * were measured on the scanned plans (uncertainty ~ +/-0.5-1 m), and [ASSUMED]
 * are modelling assumptions where the drawings are not legible.
 */
import type {
  CrowdManagerPost,
  ExitGroupId,
  Floor,
  GLink,
  GNode,
  GeometryData,
  LinkKind,
  MapOverlay,
  Seat,
  WallPolyline,
  ZoneDef,
} from './types';

type P = [number, number];

// --------------------------------------------------------------------------------------
// Key dimensions (metres)
// --------------------------------------------------------------------------------------
export const DIM = {
  // Orchestra -----------------------------------------------------------
  stageY: -10.2, // [PLAN] north end of the auditorium floor at the stage edge corners
  barrierX: 9.8, // [PLAN]+[DIM] orchestra/loge barrier, straight part
  barrierCy: 2.0, // [PLAN] where the barrier starts curving
  barrierB: 8.0, // [PLAN] semi-axis of the curved part (back of orchestra at y = 10.0)
  rowY0: -6.4, // [PLAN] row A at the centre line
  rowDy: 0.864, // [DIM] 2'-10" typical row spacing
  rowArcCy: -50, // [PLAN] curvature centre of the orchestra rows (fit to the chart)
  centreHalf: 4.1, // [DIM] centre section 27'-0" = 8.23 m wide
  aisleX: 4.65, // [DIM]/[PLAN] aisle centre line
  aisleHalf: 0.55, // [ASSUMED] orchestra aisle width 1.1 m
  frontY: -7.6, // [PLAN] cross-aisle in front of row A
  // Loge / mezzanine ------------------------------------------------------
  tierSeatA: [10.9, 11.82, 12.74, 13.66, 14.58], // [PLAN]/[DIM] five tiers, ~0.92 m apart
  tierSeatB: [8.5, 9.42, 10.34, 11.26, 12.18],
  mezzCy: 2.6, // [PLAN] centre of the mezzanine half-ellipse
  logeWallA: 15.8, // [PLAN] loge/mezzanine back wall (doors D1-D9 in this wall)
  logeWallB: 13.4,
  walkA: 15.25, // [ASSUMED] rear walkway behind the last tier
  walkB: 13.0,
  caN: -9.5, // [PLAN] loge cross-aisles (north, middle, south)
  caM: -4.8,
  caS: 2.6,
  logeNorthWall: -10.2,
  radialX: 4.9, // [PLAN] radial aisle between sections 3xx and 4xx
  // Corridor / building envelope ----------------------------------------
  outerR: 19.2, // [PLAN] inner face of the building outer wall (corridor 10041, 2602 sq ft)
  corridorNorth: -10.0,
  porticoR: 20.7, // [PLAN] centre line of the colonnaded portico
  porticoOuterR: 22.2,
  foyerNorth: 20.0, // [PLAN] foyer 10040
  foyerFront: 26.0,
  foyerHalf: 8.8,
  foyerBlockHalf: 11.4,
  fcX: [-3.4, 0, 3.4], // [PLAN] three corridor -> foyer connections (red arrows, p. 4)
  fDoorX: [-6.5, -3.2, 0, 3.3, 6.5], // [PLAN] five exterior foyer doors between six columns
  landingY: 27.0,
  streetY: 37.0,
  // Balcony ---------------------------------------------------------------
  balCy: 2.85, // [PLAN] p. 5
  balRailA: 14.45,
  balRailB: 12.35,
  balWallA: 19.2,
  balWallB: 16.0,
  balNorth: -11.0,
  balNorthWall: -11.6,
  balTierSeatA: [15.2, 16.15, 17.2], // AAA, BBB, CCC [PLAN]; CCC sits on the column ring
  balTierSeatB: [13.05, 13.95, 14.85],
  balWalkA: 18.4,
  balWalkB: 15.45,
  balRadialTheta: 128, // degrees, radial aisle between 2xx and 3xx (chart p. 7)
  balStairTheta: 132, // degrees, entrance of the south stairs 20001/20002
};

// Widths (clear widths in metres). All door widths are ASSUMPTIONS read
// approximately from the drawings (door swing symbols); see docs/PARAMETERS.md.
export const WIDTH = {
  row: 0.5,
  orchAisle: 1.1,
  logeAisle: 1.2, // 4'-0" on the chart [DIM]
  radialAisle: 1.3, // 4'-5" TYP on the chart [DIM]
  walkway: 1.0,
  frontCross: 2.4,
  sidePassage: 0.9,
  accessStair: 1.2, // 4'-0" [DIM] (mid-side stair); others assumed equal
  mezzDoor: 1.6, // D1-D9 double doors [ASSUMED]
  sideDoor: 1.6, // P1-P4 [ASSUMED]
  fcDoor: 1.8, // foyer connections [PLAN ~1.8]
  foyerDoor: 1.8, // F1-F5 [PLAN ~1.8]
  stageDoor: 1.0, // stage escape doors [ASSUMED]
  stageStair: 1.1,
  balStairFlight: 1.7, // two flights, two lanes separated by a barrier [problem text]
  balStairDoor: 1.6,
  balNDoor: 1.0,
  balNStair: 1.1,
  porticoStair: 1.8, // "narrower staircases" [ASSUMED]
  portico: 2.6,
  monumentalBand: 3.4,
  foyer: 2.4,
  landing: 2.0,
};

// --------------------------------------------------------------------------------------
// Small geometry helpers
// --------------------------------------------------------------------------------------
const rad = (d: number) => (d * Math.PI) / 180;
const ell = (a: number, b: number, cy: number, th: number): P => [a * Math.cos(th), cy + b * Math.sin(th)];
function ellArc(a: number, b: number, cy: number, th0: number, th1: number, n = 24): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) pts.push(ell(a, b, cy, th0 + ((th1 - th0) * i) / n));
  return pts;
}
/** theta on ellipse (a,b) where x = x0 (south half). */
const thetaAtX = (a: number, x: number) => Math.acos(Math.max(-1, Math.min(1, x / a)));
function polyLen(p: P[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return L;
}
function pointAt(p: P[], s: number): { pt: P; dir: P } {
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc + L >= s || i === p.length - 1) {
      const t = L > 0 ? Math.min(1, Math.max(0, (s - acc) / L)) : 0;
      const dx = p[i][0] - p[i - 1][0];
      const dy = p[i][1] - p[i - 1][1];
      return { pt: [p[i - 1][0] + dx * t, p[i - 1][1] + dy * t], dir: L > 0 ? [dx / L, dy / L] : [1, 0] };
    }
    acc += L;
  }
  return { pt: p[p.length - 1], dir: [1, 0] };
}
function subPoly(p: P[], s0: number, s1: number): P[] {
  const out: P[] = [pointAt(p, s0).pt];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    acc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(p[i]);
  }
  out.push(pointAt(p, s1).pt);
  return out;
}
function projectOnPoly(p: P[], q: P): number {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1][0];
    const ay = p[i - 1][1];
    const dx = p[i][0] - ax;
    const dy = p[i][1] - ay;
    const L2 = dx * dx + dy * dy;
    const L = Math.sqrt(L2);
    let t = L2 > 0 ? ((q[0] - ax) * dx + (q[1] - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + dx * t - q[0], ay + dy * t - q[1]);
    if (d < best) {
      best = d;
      bestS = acc + t * L;
    }
    acc += L;
  }
  return bestS;
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rp = (p: P): P => [r3(p[0]), r3(p[1])];

// --------------------------------------------------------------------------------------
// Builder
// --------------------------------------------------------------------------------------
interface RowSegment {
  link: string;
  s0: number;
  s1: number;
  level: Seat['level'];
  section: string;
  row: string;
  rowIndex: number;
  zone: string | ((x: number) => string);
  exclude?: [number, number][];
}

interface Attach {
  id: string;
  at: P;
  floor?: Floor;
}

export class BaileyHallBuilder {
  nodes = new Map<string, GNode>();
  links: GLink[] = [];
  linkIds = new Set<string>();
  walls: WallPolyline[] = [];
  segments: RowSegment[] = [];
  seats: Seat[] = [];
  labels: GeometryData['labels'] = [];
  notes: string[] = [];
  balconyColumns: P[] = [];

  node(id: string, at: P, floor: Floor, extra: Partial<GNode> = {}): string {
    if (this.nodes.has(id)) throw new Error(`duplicate node ${id}`);
    this.nodes.set(id, { id, x: r3(at[0]), y: r3(at[1]), floor, kind: 'junction', ...extra });
    return id;
  }
  pos(id: string): P {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return [n.x, n.y];
  }
  link(
    id: string,
    a: string,
    b: string,
    kind: LinkKind,
    width: number,
    floor: Floor,
    extra: Partial<GLink> & { via?: P[] } = {},
  ): GLink {
    if (this.linkIds.has(id)) throw new Error(`duplicate link ${id}`);
    const { via, ...rest } = extra;
    const pts: P[] = [this.pos(a), ...(via ?? []), this.pos(b)].map(rp);
    const l: GLink = { id, a, b, pts, width, kind, floor, accessible: kind !== 'stair', ...rest };
    if (l.exterior) l.oneWay = true;
    this.linkIds.add(id);
    this.links.push(l);
    return l;
  }
  /** Link whose geometry is a given polyline (endpoints snapped to the nodes). */
  linkPoly(id: string, a: string, b: string, kind: LinkKind, width: number, floor: Floor, poly: P[], extra: Partial<GLink> = {}) {
    const inner = poly.slice(1, poly.length - 1);
    return this.link(id, a, b, kind, width, floor, { ...extra, via: inner });
  }

  /**
   * Build a chain of links along a polyline, inserting nodes at the projections of
   * attachment points (sorted by arc length). Returns the ordered node ids.
   */
  chain(
    prefix: string,
    poly: P[],
    attaches: Attach[],
    kind: LinkKind,
    floor: Floor,
    widthAt: (pt: P) => number,
    extra: (i: number, a: string, b: string) => Partial<GLink> = () => ({}),
  ): string[] {
    const L = polyLen(poly);
    const items = attaches.map((at) => ({ ...at, s: projectOnPoly(poly, at.at) })).sort((u, v) => u.s - v.s);
    const ids: string[] = [];
    const ss: number[] = [];
    for (const it of items) {
      if (!this.nodes.has(it.id)) this.node(it.id, pointAt(poly, it.s).pt, it.floor ?? floor);
      ids.push(it.id);
      ss.push(it.s);
    }
    for (let i = 1; i < ids.length; i++) {
      const sub = subPoly(poly, ss[i - 1], ss[i]);
      // width = minimum along the sub-polyline
      let w = Infinity;
      for (const q of sub) w = Math.min(w, widthAt(q));
      this.linkPoly(`${prefix}_${i}`, ids[i - 1], ids[i], kind, r3(w), floor, sub, extra(i, ids[i - 1], ids[i]));
    }
    void L;
    return ids;
  }

  wall(id: string, floor: Floor, pts: P[], kind: WallPolyline['kind'] = 'wall', approx = true) {
    this.walls.push({ id, floor, pts: pts.map(rp), kind, approx });
  }
  label(at: P, floor: Floor, text: string, size?: number) {
    this.labels.push({ x: r3(at[0]), y: r3(at[1]), floor, text, size });
  }
}

// --------------------------------------------------------------------------------------
// Construction
// --------------------------------------------------------------------------------------
const orchRowLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T'];
const mezzRowLetters = ['AA', 'BB', 'CC', 'DD', 'EE'];
const balRowLetters = ['AAA', 'BBB', 'CCC'];

function orchRowY(k: number, x: number): number {
  const R = DIM.rowY0 + k * DIM.rowDy - DIM.rowArcCy;
  return DIM.rowArcCy + Math.sqrt(R * R - x * x);
}
function barrierHalfWidth(y: number): number {
  if (y <= DIM.barrierCy) return DIM.barrierX;
  const t = (y - DIM.barrierCy) / DIM.barrierB;
  return t >= 1 ? 0 : DIM.barrierX * Math.sqrt(1 - t * t);
}
function orchRowPoly(k: number, x0: number, x1: number, n = 12): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    pts.push([x, orchRowY(k, x)]);
  }
  return pts;
}
/** Distance from origin to the loge back wall along direction phi (radians). */
function logeWallR(phi: number): number {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  // straight part: |x| = logeWallA for y <= mezzCy
  if (Math.abs(c) > 1e-9) {
    const r = DIM.logeWallA / Math.abs(c);
    if (r * s <= DIM.mezzCy) return r;
  }
  // ellipse part: (r c / A)^2 + ((r s - cy)/B)^2 = 1
  const A = DIM.logeWallA;
  const B = DIM.logeWallB;
  const cy = DIM.mezzCy;
  const qa = (c * c) / (A * A) + (s * s) / (B * B);
  const qb = (-2 * s * cy) / (B * B);
  const qc = (cy * cy) / (B * B) - 1;
  return (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
}
function corridorCentre(phi: number): P {
  const rin = logeWallR(phi);
  const r = (rin + DIM.outerR) / 2;
  return [r * Math.cos(phi), r * Math.sin(phi)];
}
function corridorWidthAt(pt: P): number {
  if (pt[1] < 0) return DIM.outerR - DIM.logeWallA - 0.3;
  const phi = Math.atan2(pt[1], pt[0]);
  return Math.max(2.4, DIM.outerR - logeWallR(phi) - 0.3);
}

export function buildBaileyHall(): GeometryData {
  const B = new BaileyHallBuilder();
  const notes = B.notes;
  notes.push(
    'Coordinates in metres; origin = centre of the corridor arc on the first-floor plan (page 4, pixel 443,300); +x east, +y south.',
    'Scale ~0.08 m per plan pixel, cross-checked with the 27\'-0" centre-row dimension, the 2,602 sq ft corridor area and the 18,602 sq ft gross area.',
    'Seating rows follow the seating charts (pages 6-7, drawn with the stage at the bottom, i.e. rotated 180 degrees relative to the plans).',
    'Seat pitch is solved per level so that the seat counts equal the official capacities (527 / 486 / 316).',
    'Door widths, stair widths and the backstage stage-escape geometry are ASSUMPTIONS (not legible on the scans).',
    'Ground-level spaces and service/performer areas are ignored as instructed by the problem statement.',
  );

  // =================================================================================
  // ORCHESTRA (floor 1)
  // =================================================================================
  const nRows = orchRowLetters.length;
  const ax = DIM.aisleX;
  // front cross-aisle
  B.node('FX_W', [-9.1, DIM.frontY], 1, { label: 'Orchestra front W' });
  B.node('FX_E', [9.1, DIM.frontY], 1, { label: 'Orchestra front E' });
  B.node('FX_C', [0, DIM.frontY], 1);
  B.node('AW_front', [-ax, DIM.frontY], 1);
  B.node('AE_front', [ax, DIM.frontY], 1);
  B.link('FX_1', 'FX_W', 'AW_front', 'crossAisle', WIDTH.frontCross, 1);
  B.link('FX_2', 'AW_front', 'FX_C', 'crossAisle', WIDTH.frontCross, 1);
  B.link('FX_3', 'FX_C', 'AE_front', 'crossAisle', WIDTH.frontCross, 1);
  B.link('FX_4', 'AE_front', 'FX_E', 'crossAisle', WIDTH.frontCross, 1);

  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    const A = S === 'W' ? 'AW' : 'AE';
    // aisle chain
    let prev = `${A}_front`;
    for (let k = 0; k < nRows; k++) {
      const id = `${A}_${orchRowLetters[k]}`;
      B.node(id, [m * ax, orchRowY(k, ax)], 1);
      B.link(`${A}_L${k}`, prev, id, 'aisle', WIDTH.orchAisle, 1);
      prev = id;
    }
    B.node(`${A}_back`, [m * ax, 8.75], 1, { label: `Orchestra aisle ${S} (back)` });
    B.link(`${A}_L${nRows}`, prev, `${A}_back`, 'aisle', WIDTH.orchAisle, 1);

    // side passage along the curved barrier (rows M..T open onto it)
    // mid-side access stair foot
    const footY = 1.9;
    B.node(`SP${S}_foot`, [m * 9.25, footY], 1, { label: `Mid-side access stair ${S} (foot)` });
    const passageIds: string[] = [`SP${S}_foot`];

    // side rows
    for (let k = 0; k < nRows; k++) {
      const letter = orchRowLetters[k];
      const x0 = ax; // starts at aisle centre line
      // march outward to find the end
      let xEnd = DIM.aisleX + DIM.aisleHalf + 0.3;
      let open = false;
      for (let x = xEnd; x < 9.6; x += 0.02) {
        const y = orchRowY(k, x);
        const hw = barrierHalfWidth(y);
        const clearance = y > DIM.barrierCy + 0.15 ? 1.0 : 0.35;
        if (x > hw - clearance) {
          open = y > DIM.barrierCy + 0.15;
          break;
        }
        xEnd = x;
      }
      const seatEnd = xEnd;
      let endId: string;
      let linkEndX: number;
      if (open) {
        linkEndX = seatEnd + 0.5;
        endId = `SP${S}_${letter}`;
        B.node(endId, [m * linkEndX, orchRowY(k, linkEndX)], 1);
        passageIds.push(endId);
      } else {
        linkEndX = seatEnd + 0.05;
        endId = `OR${S}_${letter}_end`;
        B.node(endId, [m * linkEndX, orchRowY(k, linkEndX)], 1, { kind: 'deadEnd' });
      }
      const poly = orchRowPoly(k, m * x0, m * linkEndX).map(rp);
      const rowLink = `OR${S}_${letter}`;
      B.linkPoly(rowLink, `${A}_${letter}`, endId, 'row', WIDTH.row, 1, poly, { lanes: 1, label: `Orchestra ${letter} ${S}` });
      const L = polyLen(poly);
      B.segments.push({
        link: rowLink,
        s0: DIM.aisleHalf + 0.05,
        s1: L - (open ? 0.5 : 0.05),
        level: 'orchestra',
        section: `ORCH_SIDE_${S}`,
        row: letter,
        rowIndex: k,
        zone: k <= 6 ? `ORCH_FRONT_${S}` : `ORCH_SIDE_${S}`,
      });
    }
    // passage chain: foot -> row ends (M..T) -> aisle back
    passageIds.push(`${A}_back`);
    for (let i = 1; i < passageIds.length; i++) {
      const a = B.pos(passageIds[i - 1]);
      const b = B.pos(passageIds[i]);
      // bend the passage along the barrier: intermediate point at barrier - 0.45
      const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const hw = barrierHalfWidth(mid[1]) - 0.45;
      const via: P[] = Math.abs(mid[0]) > hw ? [[Math.sign(mid[0]) * hw, mid[1]]] : [];
      B.link(`SP${S}_${i}`, passageIds[i - 1], passageIds[i], 'passage', WIDTH.sidePassage, 1, { via, approx: true });
    }
  }
  // centre rows (two-ended)
  for (let k = 0; k < nRows; k++) {
    const letter = orchRowLetters[k];
    const poly = orchRowPoly(k, -ax, ax, 16).map(rp);
    const id = `ORC_${letter}`;
    B.linkPoly(id, `AW_${letter}`, `AE_${letter}`, 'row', WIDTH.row, 1, poly, { lanes: 1, label: `Orchestra ${letter} centre` });
    const L = polyLen(poly);
    B.segments.push({
      link: id,
      s0: DIM.aisleHalf + 0.05,
      s1: L - DIM.aisleHalf - 0.05,
      level: 'orchestra',
      section: 'ORCH_CENTRE',
      row: letter,
      rowIndex: k,
      zone: k <= 7 ? 'ORCH_C_FRONT' : 'ORCH_C_BACK',
    });
  }

  // =================================================================================
  // LOGE + MEZZANINE (floor 1, raised)
  // =================================================================================
  const tiers = DIM.tierSeatA.length;
  const laneA = DIM.tierSeatA.map((a) => a - 0.45);
  const laneB = DIM.tierSeatB.map((b) => b - 0.45);
  const cyM = DIM.mezzCy;
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    // cross-aisle nodes
    B.node(`LN${S}_in`, [m * 10.0, DIM.caN], 1, { label: `Loge ${S} north cross-aisle` });
    B.node(`LS${S}_in`, [m * 10.05, DIM.caS], 1, { label: `Mid-side access stair ${S} (top)` });
    for (let k = 0; k < tiers; k++) {
      B.node(`LN${S}_${k}`, [m * laneA[k], DIM.caN], 1);
      B.node(`LM${S}_${k}`, [m * laneA[k], DIM.caM], 1);
      B.node(`LS${S}_${k}`, [m * laneA[k], DIM.caS], 1);
    }
    // cross-aisle links
    for (const [ca, startId] of [
      ['LN', `LN${S}_in`],
      ['LM', null],
      ['LS', `LS${S}_in`],
    ] as const) {
      let prev: string = startId ?? `${ca}${S}_0`;
      for (let k = startId ? 0 : 1; k < tiers; k++) {
        B.link(`${ca}${S}_x${k}`, prev, `${ca}${S}_${k}`, 'crossAisle', WIDTH.logeAisle, 1);
        prev = `${ca}${S}_${k}`;
      }
    }
    // 1xx (north) and 2xx (south) rows: N-S lanes between cross-aisles
    for (let k = 0; k < tiers; k++) {
      const l1 = `L1${S}_${mezzRowLetters[k]}`;
      B.link(l1, `LN${S}_${k}`, `LM${S}_${k}`, 'row', WIDTH.row, 1, { lanes: 1, label: `Loge 1xx ${S} tier ${k + 1}` });
      const len1 = Math.abs(DIM.caM - DIM.caN);
      B.segments.push({ link: l1, s0: 0.65, s1: len1 - 0.65, level: 'mezzanine', section: `LOGE1_${S}`, row: `${k + 1}`, rowIndex: k, zone: `LOGE_${S}_N` });
      const l2 = `L2${S}_${mezzRowLetters[k]}`;
      B.link(l2, `LM${S}_${k}`, `LS${S}_${k}`, 'row', WIDTH.row, 1, { lanes: 1, label: `Loge 2xx ${S} tier ${k + 1}` });
      const len2 = Math.abs(DIM.caS - DIM.caM);
      B.segments.push({ link: l2, s0: 0.65, s1: len2 - 0.65, level: 'mezzanine', section: `LOGE2_${S}`, row: `${k + 1}`, rowIndex: k, zone: `LOGE_${S}_S` });
    }
    // radial aisle (3xx / 4xx)
    const rx = DIM.radialX;
    for (let k = 0; k < tiers; k++) {
      const th = thetaAtX(laneA[k], m * rx);
      B.node(`MR${S}_${k}`, ell(laneA[k], laneB[k], cyM, th), 1);
    }
    // 3xx curved rows: from LS{S}_k (theta = pi or 0) to MR{S}_k
    for (let k = 0; k < tiers; k++) {
      const th0 = S === 'W' ? Math.PI : 0;
      const th1 = thetaAtX(laneA[k], m * rx);
      const poly = ellArc(laneA[k], laneB[k], cyM, th0, th1, 28).map(rp);
      const id = `M3${S}_${mezzRowLetters[k]}`;
      B.linkPoly(id, `LS${S}_${k}`, `MR${S}_${k}`, 'row', WIDTH.row, 1, poly, { lanes: 1, label: `Mezzanine ${mezzRowLetters[k]} 3xx ${S}` });
      const L = polyLen(poly);
      B.segments.push({ link: id, s0: 0.75, s1: L - 0.7, level: 'mezzanine', section: `MEZZ3_${S}`, row: mezzRowLetters[k], rowIndex: k, zone: `MEZZ_${S}` });
    }
  }

  // Orchestra -> loge access stairs (6 access points)
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    const A = S === 'W' ? 'AW' : 'AE';
    B.link(`OST_F${S}`, `FX_${S}`, `LN${S}_in`, 'stair', WIDTH.accessStair, 1, {
      drop: -1.5,
      gate: true,
      label: `Access ${S}1 (front)`,
      approx: true,
      source: 'Seating chart p.6: stairs at the front corners of the orchestra',
    });
    B.link(`OST_M${S}`, `SP${S}_foot`, `LS${S}_in`, 'stair', WIDTH.accessStair, 1, {
      drop: -1.0,
      gate: true,
      label: `Access ${S}2 (mid-side)`,
      source: 'Seating chart p.6: 4\'-0" stair at the start of the curve',
    });
    B.link(`OST_B${S}`, `${A}_back`, `MR${S}_0`, 'stair', WIDTH.accessStair, 1, {
      drop: -0.8,
      gate: true,
      label: `Access ${S}3 (back aisle)`,
      approx: true,
      source: 'Seating chart p.6: orchestra aisles continue into the mezzanine radial aisles',
    });
  }

  // radial aisles W/E chains + 4xx rows + centre aisle
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    for (let k = 1; k < tiers; k++) B.link(`MR${S}_x${k}`, `MR${S}_${k - 1}`, `MR${S}_${k}`, 'aisle', WIDTH.radialAisle, 1);
  }
  // centre aisle nodes for tiers CC..EE
  for (let k = 2; k < tiers; k++) B.node(`MC_${k}`, [0, cyM + laneB[k]], 1);
  for (let k = 3; k < tiers; k++) B.link(`MC_x${k}`, `MC_${k - 1}`, `MC_${k}`, 'aisle', WIDTH.radialAisle, 1);
  const wheelchairSlots: { link: string; s: number }[] = [];
  for (let k = 0; k < tiers; k++) {
    const thW = thetaAtX(laneA[k], -DIM.radialX);
    const thE = thetaAtX(laneA[k], DIM.radialX);
    const letter = mezzRowLetters[k];
    if (k < 2) {
      const poly = ellArc(laneA[k], laneB[k], cyM, thW, thE, 20).map(rp);
      const id = `M4_${letter}`;
      B.linkPoly(id, `MRW_${k}`, `MRE_${k}`, 'row', WIDTH.row, 1, poly, { lanes: 1, label: `Mezzanine ${letter} 4xx` });
      const L = polyLen(poly);
      B.segments.push({ link: id, s0: 0.7, s1: L - 0.7, level: 'mezzanine', section: 'MEZZ4', row: letter, rowIndex: k, zone: (x) => (x < 0 ? 'MEZZ_C_W' : 'MEZZ_C_E') });
    } else {
      const polyW = ellArc(laneA[k], laneB[k], cyM, thW, Math.PI / 2, 12).map(rp);
      const polyE = ellArc(laneA[k], laneB[k], cyM, Math.PI / 2, thE, 12).map(rp);
      const idW = `M4W_${letter}`;
      const idE = `M4E_${letter}`;
      B.linkPoly(idW, `MRW_${k}`, `MC_${k}`, 'row', WIDTH.row, 1, polyW, { lanes: 1, label: `Mezzanine ${letter} 4xx W` });
      B.linkPoly(idE, `MC_${k}`, `MRE_${k}`, 'row', WIDTH.row, 1, polyE, { lanes: 1, label: `Mezzanine ${letter} 4xx E` });
      const LW = polyLen(polyW);
      const LE = polyLen(polyE);
      if (k === tiers - 1) {
        // Two wheelchair positions shown next to the centre aisle behind row EE
        // (seating chart p.6); the third is ASSUMED adjacent.
        B.segments.push({ link: idW, s0: 0.7, s1: LW - 2.4, level: 'mezzanine', section: 'MEZZ4', row: letter, rowIndex: k, zone: 'MEZZ_C_W' });
        B.segments.push({ link: idE, s0: 1.6, s1: LE - 0.7, level: 'mezzanine', section: 'MEZZ4', row: letter, rowIndex: k, zone: 'MEZZ_C_E' });
        wheelchairSlots.push({ link: idW, s: LW - 0.95 }, { link: idW, s: LW - 1.85 }, { link: idE, s: 0.85 });
      } else {
        B.segments.push({ link: idW, s0: 0.7, s1: LW - 0.7, level: 'mezzanine', section: 'MEZZ4', row: letter, rowIndex: k, zone: 'MEZZ_C_W' });
        B.segments.push({ link: idE, s0: 0.7, s1: LE - 0.7, level: 'mezzanine', section: 'MEZZ4', row: letter, rowIndex: k, zone: 'MEZZ_C_E' });
      }
    }
  }

  // Rear walkway behind the last tier (loop from NW to NE)
  const wA = DIM.walkA;
  const wB = DIM.walkB;
  const walkPoly: P[] = [
    [-wA, DIM.caN],
    ...ellArc(wA, wB, cyM, Math.PI, 0, 90),
    [wA, DIM.caN],
  ];
  const thD3 = rad(140);
  const walkAttach: Attach[] = [];
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    walkAttach.push(
      { id: `LN${S}_wk`, at: [m * wA, DIM.caN] },
      { id: `LM${S}_wk`, at: [m * wA, DIM.caM] },
      { id: `LS${S}_wk`, at: [m * wA, DIM.caS] },
      { id: `WK${S}_D3`, at: ell(wA, wB, cyM, S === 'W' ? thD3 : Math.PI - thD3) },
      { id: `MR${S}_wk`, at: ell(wA, wB, cyM, thetaAtX(wA, m * DIM.radialX)) },
    );
  }
  walkAttach.push({ id: 'WK_C', at: [0, cyM + wB] });
  B.chain('WK', walkPoly, walkAttach, 'walkway', 1, () => WIDTH.walkway);
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    B.link(`LN${S}_xw`, `LN${S}_${tiers - 1}`, `LN${S}_wk`, 'crossAisle', WIDTH.logeAisle, 1);
    B.link(`LM${S}_xw`, `LM${S}_${tiers - 1}`, `LM${S}_wk`, 'crossAisle', WIDTH.logeAisle, 1);
    B.link(`LS${S}_xw`, `LS${S}_${tiers - 1}`, `LS${S}_wk`, 'crossAisle', WIDTH.logeAisle, 1);
    B.link(`MR${S}_xw`, `MR${S}_${tiers - 1}`, `MR${S}_wk`, 'aisle', WIDTH.radialAisle, 1);
  }
  B.link('MC_xw', `MC_${tiers - 1}`, 'WK_C', 'aisle', WIDTH.radialAisle, 1);

  // =================================================================================
  // CORRIDOR (floor 1) and doors D1..D9, P1..P4, foyer connections
  // =================================================================================
  const corrPoly: P[] = [[-(DIM.logeWallA + DIM.outerR) / 2, DIM.corridorNorth]];
  for (let i = 0; i <= 180; i++) corrPoly.push(corridorCentre(Math.PI - (Math.PI * i) / 180));
  corrPoly.push([(DIM.logeWallA + DIM.outerR) / 2, DIM.corridorNorth]);

  // door endpoints (outer side of the loge wall)
  const doorDefs: { id: string; inner: string; phiOuter: number }[] = [];
  const corrAttach: Attach[] = [];
  const phiOf = (p: P) => Math.atan2(p[1], p[0]);
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    corrAttach.push({ id: `CN_${S}`, at: [m * 17.5, DIM.corridorNorth] });
    corrAttach.push({ id: `C_D1${S}`, at: [m * 17.5, DIM.caM] });
    corrAttach.push({ id: `C_D2${S}`, at: corridorCentre(phiOf([m * DIM.logeWallA, DIM.caS])) });
    corrAttach.push({ id: `C_P2${S}`, at: corridorCentre(S === 'W' ? rad(150) : rad(30)) });
    corrAttach.push({ id: `C_D3${S}`, at: corridorCentre(phiOf(B.pos(`WK${S}_D3`))) });
    corrAttach.push({ id: `C_D4${S}`, at: corridorCentre(phiOf(B.pos(`MR${S}_wk`))) });
    corrAttach.push({ id: `C_FC${S}`, at: corridorCentre(phiOf([m * 3.4, 17.3])) });
    // barrier slot pairs
    for (const [slot, deg] of [
      ['0', 176],
      ['1', 143],
      ['2', 122],
    ] as const) {
      const d = S === 'W' ? deg : 180 - deg;
      corrAttach.push({ id: `BS${S}${slot}_a`, at: corridorCentre(rad(d + (S === 'W' ? 0.9 : -0.9))) });
      corrAttach.push({ id: `BS${S}${slot}_b`, at: corridorCentre(rad(d - (S === 'W' ? 0.9 : -0.9))) });
    }
  }
  corrAttach.push({ id: 'C_FC2', at: corridorCentre(Math.PI / 2) });
  const corrIds = B.chain('CO', corrPoly, corrAttach, 'corridor', 1, corridorWidthAt, (_i, a, b) => {
    const m = /^BS([WE])(\d)_a$/.exec(a);
    if (m && b === `BS${m[1]}${m[2]}_b`) return { barrierSlot: true, label: `Barrier slot ${m[1]}${m[2]}` };
    const m2 = /^BS([WE])(\d)_b$/.exec(a);
    if (m2 && b === `BS${m2[1]}${m2[2]}_a`) return { barrierSlot: true, label: `Barrier slot ${m2[1]}${m2[2]}` };
    return {};
  });
  void corrIds;
  B.nodes.get('CN_W')!.kind = 'deadEnd';
  B.nodes.get('CN_E')!.kind = 'deadEnd';

  // Mezzanine doors D1..D9 (west-north -> around the south -> east-north)
  const dDoor = (id: string, from: string, to: string, label: string) =>
    B.link(id, from, to, 'door', WIDTH.mezzDoor, 1, {
      gate: true,
      label,
      approx: true,
      source: 'Problem text: nine regular exit doors through the mezzanine; positions from plan p.4',
    });
  dDoor('D1', 'LMW_wk', 'C_D1W', 'D1');
  dDoor('D2', 'LSW_wk', 'C_D2W', 'D2');
  dDoor('D3', 'WKW_D3', 'C_D3W', 'D3');
  dDoor('D4', 'MRW_wk', 'C_D4W', 'D4');
  dDoor('D5', 'WK_C', 'C_FC2', 'D5');
  dDoor('D6', 'MRE_wk', 'C_D4E', 'D6');
  dDoor('D7', 'WKE_D3', 'C_D3E', 'D7');
  dDoor('D8', 'LSE_wk', 'C_D2E', 'D8');
  dDoor('D9', 'LME_wk', 'C_D1E', 'D9');

  // Portico, side doors P1..P4 and portico stairs
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    const pr = DIM.porticoR;
    const phi150 = S === 'W' ? rad(150) : rad(30);
    const phiSt = S === 'W' ? rad(146) : rad(34);
    const portPoly: P[] = [[m * pr, DIM.corridorNorth], [m * pr, 0]];
    const N = 30;
    const phi0 = S === 'W' ? Math.PI : 0;
    for (let i = 1; i <= N; i++) {
      const ph = phi0 + ((phiSt - phi0) * i) / N;
      portPoly.push([pr * Math.cos(ph), pr * Math.sin(ph)]);
    }
    B.chain(
      `PO${S}`,
      portPoly,
      [
        { id: `PO${S}_N`, at: [m * pr, DIM.corridorNorth] },
        { id: `PO${S}_1`, at: [m * pr, DIM.caM] },
        { id: `PO${S}_2`, at: [pr * Math.cos(phi150), pr * Math.sin(phi150)] },
        { id: `PO${S}_st`, at: [pr * Math.cos(phiSt), pr * Math.sin(phiSt)] },
      ],
      'portico',
      1,
      () => WIDTH.portico,
    );
    B.nodes.get(`PO${S}_N`)!.kind = 'deadEnd';
    const pA = S === 'W' ? 'P1' : 'P4';
    const pB = S === 'W' ? 'P2' : 'P3';
    const grp: ExitGroupId = S === 'W' ? 'PORTICO_W' : 'PORTICO_E';
    B.link(pA, `C_D1${S}`, `PO${S}_1`, 'door', WIDTH.sideDoor, 1, { gate: true, exterior: true, exitGroup: grp, label: pA, approx: true, source: 'Problem text: four (rarely used) side doors to the portico' });
    B.link(pB, `C_P2${S}`, `PO${S}_2`, 'door', WIDTH.sideDoor, 1, { gate: true, exterior: true, exitGroup: grp, label: pB, approx: true, source: 'Problem text: four (rarely used) side doors to the portico' });
    // portico stair (outward and down to the street)
    const top = B.pos(`PO${S}_st`);
    const dir: P = [Math.cos(phiSt), Math.sin(phiSt)];
    B.node(`PS${S}_bot`, [top[0] + dir[0] * 4.6, top[1] + dir[1] * 4.6], 0);
    B.node(`SAFE_P${S}`, [top[0] + dir[0] * 6.6, top[1] + dir[1] * 6.6], 0, { kind: 'safe', exitGroup: grp, label: `Street (${S} portico stair)` });
    B.link(`PST_${S}`, `PO${S}_st`, `PS${S}_bot`, 'stair', WIDTH.porticoStair, 1, { drop: 2.3, gate: true, label: `Portico stair ${S}`, approx: true, source: 'Problem text: two narrower staircases from the portico; width assumed' });
    B.link(`PSO_${S}`, `PS${S}_bot`, `SAFE_P${S}`, 'outdoor', 3.0, 0, { oneWay: true });
  }

  // Vestibule / foyer
  for (const [i, x] of DIM.fcX.entries()) {
    const id = `FCo${i + 1}`;
    B.node(id, [x, 19.3], 1);
    B.node(`FY${i + 1}`, [x, 20.7], 1);
  }
  B.link('CFC_1', 'C_FCW', 'FCo1', 'corridor', 2.4, 1);
  B.link('CFC_2', 'C_FC2', 'FCo2', 'corridor', 2.4, 1);
  B.link('CFC_3', 'C_FCE', 'FCo3', 'corridor', 2.4, 1);
  for (let i = 1; i <= 3; i++) {
    B.link(`FC${i}`, `FCo${i}`, `FY${i}`, 'door', WIDTH.fcDoor, 1, {
      gate: true,
      label: `FC${i}`,
      source: 'Problem text: three doors from the corridor to the foyer (red arrows p.4)',
    });
  }
  // foyer interior
  DIM.fDoorX.forEach((x, j) => {
    B.node(`FYM${j + 1}`, [x, 23.0], 1);
    B.node(`FYD${j + 1}`, [x, 25.3], 1);
    B.node(`FO${j + 1}`, [x, DIM.landingY], 1, { label: j === 2 ? 'Landing (top of monumental stair)' : undefined });
  });
  const fyLinks: [string, string][] = [
    ['FY1', 'FYM1'],
    ['FY1', 'FYM2'],
    ['FY2', 'FYM2'],
    ['FY2', 'FYM3'],
    ['FY2', 'FYM4'],
    ['FY3', 'FYM4'],
    ['FY3', 'FYM5'],
    ['FY1', 'FY2'],
    ['FY2', 'FY3'],
    ['FYM1', 'FYM2'],
    ['FYM2', 'FYM3'],
    ['FYM3', 'FYM4'],
    ['FYM4', 'FYM5'],
  ];
  fyLinks.forEach(([a, b], i) => B.link(`FYL_${i + 1}`, a, b, 'foyer', WIDTH.foyer, 1));
  for (let j = 1; j <= 5; j++) {
    B.link(`FYV_${j}`, `FYM${j}`, `FYD${j}`, 'foyer', WIDTH.foyer, 1);
    B.link(`F${j}`, `FYD${j}`, `FO${j}`, 'door', WIDTH.foyerDoor, 1, {
      gate: true,
      exterior: true,
      exitGroup: 'FOYER',
      label: `F${j}`,
      source: 'Problem text: five large doors from the foyer to the monumental staircase',
    });
  }
  for (let j = 1; j < 5; j++) B.link(`FOL_${j}`, `FO${j}`, `FO${j + 1}`, 'landing', WIDTH.landing, 1);
  // Refuge for wheelchair users (top of the monumental stair, outside the building)
  B.node('REFUGE_MAIN', [-8.4, DIM.landingY + 0.2], 1, {
    kind: 'refuge',
    label: 'Assistance point (wheelchair users)',
    note: 'Outside the building but NOT at street level; assisted descent procedure unknown',
  });
  B.link('FOL_ref', 'FO1', 'REFUGE_MAIN', 'landing', WIDTH.landing, 1);
  for (let j = 1; j <= 5; j++) {
    const x = DIM.fDoorX[j - 1];
    B.node(`MSB${j}`, [x, DIM.streetY], 0);
    B.node(`SAFE_F${j}`, [x, DIM.streetY + 1.6], 0, { kind: 'safe', exitGroup: 'FOYER', label: j === 3 ? 'Street (main stair)' : undefined });
    B.link(`MS_${j}`, `FO${j}`, `MSB${j}`, 'stair', WIDTH.monumentalBand, 1, { drop: 2.3, label: `Monumental stair band ${j}`, source: 'Plan p.4: monumental staircase ~19 m wide' });
    B.link(`MSO_${j}`, `MSB${j}`, `SAFE_F${j}`, 'outdoor', 3.0, 0, { oneWay: true });
  }
  // Elevators: present on the map, PROHIBITED during evacuation
  B.node('ELEV_FOYER', [-10.1, 24.8], 1, { kind: 'elevator', label: 'Elevator (prohibited)' });
  B.node('ELEV_NE', [13.6, -19.8], 1, { kind: 'elevator', label: 'Elevator 10071 (prohibited)' });
  B.link('ELEV_link', 'FYM1', 'ELEV_FOYER', 'passage', 1.0, 1, {
    prohibited: true,
    label: 'ADA exit via elevator - PROHIBITED in evacuation',
    source: 'Problem text: use of the elevator in evacuation scenarios is prohibited',
  });

  // =================================================================================
  // STAGE ESCAPE ROUTES (floor 1 -> ground) [ASSUMED geometry]
  // =================================================================================
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    const grp: ExitGroupId = S === 'W' ? 'STAGE_W' : 'STAGE_E';
    B.node(`SE${S}_0`, [m * 10.6, -11.1], 1, { approx: true });
    B.node(`SE${S}_1`, [m * 13.4, -11.5], 1, { approx: true });
    B.node(`SE${S}_2`, [m * 15.3, -15.6], 0, { approx: true, label: `Stage escape ${S} (ground-level door)` });
    B.node(`SE${S}_out`, [m * 15.3, -17.3], 0, { approx: true });
    B.node(`SAFE_SE${S}`, [m * 15.3, -19.2], 0, { kind: 'safe', exitGroup: grp, label: `Outside (stage escape ${S})` });
    B.link(`SD${S}`, `LN${S}_in`, `SE${S}_0`, 'door', WIDTH.stageDoor, 1, { gate: true, label: `Stage escape door ${S}`, approx: true, source: 'Plan p.4: "Stage Escape Routes" arrows' });
    B.link(`SEP${S}`, `SE${S}_0`, `SE${S}_1`, 'passage', 1.2, 1, { approx: true });
    B.link(`SES${S}`, `SE${S}_1`, `SE${S}_2`, 'stair', WIDTH.stageStair, 1, { drop: 3.5, gate: true, approx: true, label: `Stage escape stair ${S}`, via: [[m * 15.0, -12.5], [m * 13.6, -13.6], [m * 15.0, -14.6]] });
    B.link(`XSE${S}`, `SE${S}_2`, `SE${S}_out`, 'door', WIDTH.stageDoor, 0, { gate: true, exterior: true, exitGroup: grp, label: `X${S} (stage exit)`, approx: true });
    B.link(`SEO${S}`, `SE${S}_out`, `SAFE_SE${S}`, 'outdoor', 2.0, 0, { oneWay: true });
  }
  // orchestra front-corner people may also reach the stage escape via the front stair (already linked via LN*_in)

  // =================================================================================
  // BALCONY (floor 2)
  // =================================================================================
  const bcy = DIM.balCy;
  const bLaneA = DIM.balTierSeatA.map((a) => a - 0.45);
  const bLaneB = DIM.balTierSeatB.map((b) => b - 0.45);
  const thR = rad(DIM.balRadialTheta);
  // column ring (CCC tier line)
  {
    const a = DIM.balTierSeatA[2];
    const b = DIM.balTierSeatB[2];
    const ring: P[] = [[-a, DIM.balNorth + 1.1], [-a, bcy], ...ellArc(a, b, bcy, Math.PI, 0, 120), [a, bcy], [a, DIM.balNorth + 1.1]];
    const L = polyLen(ring);
    for (let s = 0.3; s < L; s += 2.6) B.balconyColumns.push(pointAt(ring, s).pt);
  }
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    for (let j = 0; j < 3; j++) {
      B.node(`BN${S}_${j}`, [m * bLaneA[j], DIM.balNorth], 2);
      B.node(`BS${S}_${j}`, [m * bLaneA[j], bcy], 2);
      const th2 = S === 'W' ? thR : Math.PI - thR;
      B.node(`B2${S}_${j}`, ell(bLaneA[j], bLaneB[j], bcy, th2), 2);
    }
    // radial / cross aisle chains (rail side -> walkway)
    for (let j = 1; j < 3; j++) {
      B.link(`BN${S}_x${j}`, `BN${S}_${j - 1}`, `BN${S}_${j}`, 'crossAisle', WIDTH.logeAisle, 2);
      B.link(`BS${S}_x${j}`, `BS${S}_${j - 1}`, `BS${S}_${j}`, 'aisle', WIDTH.radialAisle, 2);
      B.link(`B2${S}_x${j}`, `B2${S}_${j - 1}`, `B2${S}_${j}`, 'aisle', WIDTH.radialAisle, 2);
    }
    // rows
    for (let j = 0; j < 3; j++) {
      const letter = balRowLetters[j];
      const l1 = `B1${S}_${letter}`;
      B.link(l1, `BN${S}_${j}`, `BS${S}_${j}`, 'row', WIDTH.row, 2, { lanes: 1, label: `Balcony ${letter} 1xx ${S}` });
      const len1 = bcy - DIM.balNorth;
      const th0 = S === 'W' ? Math.PI : 0;
      const th2 = S === 'W' ? thR : Math.PI - thR;
      const poly2 = ellArc(bLaneA[j], bLaneB[j], bcy, th0, th2, 24).map(rp);
      const l2 = `B2${S}_${letter}`;
      B.linkPoly(l2, `BS${S}_${j}`, `B2${S}_${j}`, 'row', WIDTH.row, 2, poly2, { lanes: 1, label: `Balcony ${letter} 2xx ${S}` });
      const poly3 = ellArc(bLaneA[j], bLaneB[j], bcy, th2, Math.PI / 2, 18).map(rp);
      if (!B.nodes.has(`BC_${j}`)) B.node(`BC_${j}`, [0, bcy + bLaneB[j]], 2);
      const l3 = `B3${S}_${letter}`;
      if (S === 'W') B.linkPoly(l3, `B2${S}_${j}`, `BC_${j}`, 'row', WIDTH.row, 2, poly3, { lanes: 1, label: `Balcony ${letter} 3xx ${S}` });
      else B.linkPoly(l3, `BC_${j}`, `B2${S}_${j}`, 'row', WIDTH.row, 2, [...poly3].reverse(), { lanes: 1, label: `Balcony ${letter} 3xx ${S}` });
      const len2 = polyLen(poly2);
      const len3 = polyLen(poly3);
      const cols = (link: string, poly: P[]) => {
        if (j !== 2) return undefined;
        const ex: [number, number][] = [];
        for (const c of B.balconyColumns) {
          const s = projectOnPoly(poly, c);
          const q = pointAt(poly, s).pt;
          if (Math.hypot(q[0] - c[0], q[1] - c[1]) < 0.8) ex.push([s - 0.65, s + 0.65]);
        }
        void link;
        return ex;
      };
      const poly1: P[] = [B.pos(`BN${S}_${j}`), B.pos(`BS${S}_${j}`)];
      B.segments.push({ link: l1, s0: 0.65, s1: len1 - 0.65, level: 'balcony', section: `BAL1_${S}`, row: letter, rowIndex: j, zone: `BAL_${S}_N`, exclude: cols(l1, poly1) });
      B.segments.push({ link: l2, s0: 0.65, s1: len2 - 0.65, level: 'balcony', section: `BAL2_${S}`, row: letter, rowIndex: j, zone: `BAL_${S}_S`, exclude: cols(l2, poly2) });
      const p3 = S === 'W' ? poly3 : [...poly3].reverse();
      B.segments.push({ link: l3, s0: 0.65, s1: len3 - 0.65, level: 'balcony', section: `BAL3_${S}`, row: letter, rowIndex: j, zone: `BAL_C_${S}`, exclude: cols(l3, p3) });
    }
  }
  for (let j = 1; j < 3; j++) B.link(`BC_x${j}`, `BC_${j - 1}`, `BC_${j}`, 'aisle', WIDTH.radialAisle, 2);
  // balcony rear walkway
  const bwA = DIM.balWalkA;
  const bwB = DIM.balWalkB;
  const bWalkPoly: P[] = [[-bwA, DIM.balNorth], ...ellArc(bwA, bwB, bcy, Math.PI, 0, 90), [bwA, DIM.balNorth]];
  const thSt = rad(DIM.balStairTheta);
  const bAttach: Attach[] = [];
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    const th2 = S === 'W' ? thR : Math.PI - thR;
    bAttach.push(
      { id: `BN${S}_wk`, at: [m * bwA, DIM.balNorth] },
      { id: `BS${S}_wk`, at: [m * bwA, bcy] },
      { id: `B2${S}_wk`, at: ell(bwA, bwB, bcy, th2) },
      { id: `BST${S}_wk`, at: ell(bwA, bwB, bcy, S === 'W' ? thSt : Math.PI - thSt) },
    );
  }
  bAttach.push({ id: 'BC_wk', at: [0, bcy + bwB] });
  B.chain('BWK', bWalkPoly, bAttach, 'walkway', 2, () => WIDTH.walkway + 0.2);
  for (const S of ['W', 'E'] as const) {
    B.link(`BN${S}_xw`, `BN${S}_2`, `BN${S}_wk`, 'crossAisle', WIDTH.logeAisle, 2);
    B.link(`BS${S}_xw`, `BS${S}_2`, `BS${S}_wk`, 'aisle', WIDTH.radialAisle, 2);
    B.link(`B2${S}_xw`, `B2${S}_2`, `B2${S}_wk`, 'aisle', WIDTH.radialAisle, 2);
  }
  B.link('BC_xw', 'BC_2', 'BC_wk', 'aisle', WIDTH.radialAisle, 2);

  // Balcony south stairs (20001 / 20002): door -> flight 1 -> landing -> flight 2 -> vestibule
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    B.node(`BSTR${S}_top`, [m * 12.7, 16.1], 2, { label: `Balcony stair ${S === 'W' ? '20001' : '20002'} (top)` });
    B.node(`BSTR${S}_land`, [m * 10.1, 18.1], 1, { label: 'Intermediate landing', approx: true });
    B.node(`BSTR${S}_bot`, [m * 7.1, 19.4], 1, { label: `Balcony stair ${S} (bottom)` });
    B.node(`VEST${S}`, [m * 5.6, 18.8], 1);
    B.link(`BSD${S}`, `BST${S}_wk`, `BSTR${S}_top`, 'door', WIDTH.balStairDoor, 2, { gate: true, label: S === 'W' ? '20001' : '20002', approx: true });
    B.link(`BSF1${S}`, `BSTR${S}_top`, `BSTR${S}_land`, 'stair', WIDTH.balStairFlight, 2, {
      drop: 2.1,
      gate: true,
      lanes: 2,
      laneBarrier: true,
      label: `Balcony stair ${S} flight 1`,
      source: 'Problem text: two flights, barriers separating two lanes',
    });
    B.link(`BSF2${S}`, `BSTR${S}_land`, `BSTR${S}_bot`, 'stair', WIDTH.balStairFlight, 1, {
      drop: 2.1,
      gate: true,
      lanes: 2,
      laneBarrier: true,
      label: `Balcony stair ${S} flight 2`,
      source: 'Problem text: two flights, barriers separating two lanes',
    });
    B.link(`BSV${S}`, `BSTR${S}_bot`, `VEST${S}`, 'corridor', 2.0, 1);
    B.link(`VSF${S}`, `VEST${S}`, S === 'W' ? 'FCo1' : 'FCo3', 'corridor', 2.0, 1);
    B.link(`VSC${S}`, `VEST${S}`, `C_D4${S}`, 'corridor', 2.0, 1);
  }

  // Balcony stage-side stairwells (NW / NE) leading directly outside
  for (const [m, S] of [
    [-1, 'W'],
    [1, 'E'],
  ] as const) {
    const grp: ExitGroupId = S === 'W' ? 'BAL_NW' : 'BAL_NE';
    B.node(`BNS${S}_0`, [m * 19.9, -12.5], 2, { label: `Stairwell ${S === 'W' ? '20004' : '20003'}`, approx: true });
    B.node(`BNS${S}_1`, [m * 21.0, -16.2], 0, { approx: true });
    B.node(`BNS${S}_out`, [m * 22.6, -17.6], 0, { approx: true });
    B.node(`SAFE_BN${S}`, [m * 24.0, -18.8], 0, { kind: 'safe', exitGroup: grp, label: `Outside (balcony ${S === 'W' ? 'NW' : 'NE'} stair)` });
    B.link(`BND${S}`, `BN${S}_wk`, `BNS${S}_0`, 'door', WIDTH.balNDoor, 2, { gate: true, label: S === 'W' ? 'BNW door' : 'BNE door', approx: true });
    B.link(`BNST${S}`, `BNS${S}_0`, `BNS${S}_1`, 'stair', WIDTH.balNStair, 2, {
      drop: 8.5,
      gate: true,
      lanes: 1,
      approx: true,
      label: `Balcony ${S === 'W' ? 'NW' : 'NE'} stairwell (2 storeys)`,
      source: 'Problem text: staircases on each side of the stage leading directly outside',
      via: [
        [m * 22.6, -12.6],
        [m * 22.6, -13.5],
        [m * 19.9, -13.5],
        [m * 19.9, -14.4],
        [m * 22.6, -14.4],
        [m * 22.6, -15.3],
        [m * 19.9, -15.3],
        [m * 19.9, -16.2],
      ],
    });
    B.link(`XBN${S}`, `BNS${S}_1`, `BNS${S}_out`, 'door', WIDTH.balNDoor, 0, { gate: true, exterior: true, exitGroup: grp, label: `X${S === 'W' ? 'NW' : 'NE'} (stairwell exit)`, approx: true });
    B.link(`BNO${S}`, `BNS${S}_out`, `SAFE_BN${S}`, 'outdoor', 2.0, 0, { oneWay: true });
  }

  // =================================================================================
  // WALLS (for rendering and for the "no link crosses a wall" validation test)
  // =================================================================================
  // floor 1
  B.wall('stage', 1, [[-DIM.barrierX, DIM.stageY], [-5, -8.9], [0, -8.4], [5, -8.9], [DIM.barrierX, DIM.stageY]], 'stage');
  B.wall(
    'orch_barrier',
    1,
    [[-DIM.barrierX, DIM.stageY], [-DIM.barrierX, DIM.barrierCy], ...ellArc(DIM.barrierX, DIM.barrierB, DIM.barrierCy, Math.PI, 0, 80), [DIM.barrierX, DIM.barrierCy], [DIM.barrierX, DIM.stageY]],
    'barrier',
  );
  B.wall('loge_north_W', 1, [[-DIM.barrierX, DIM.logeNorthWall], [-DIM.logeWallA, DIM.logeNorthWall]]);
  B.wall('loge_north_E', 1, [[DIM.barrierX, DIM.logeNorthWall], [DIM.logeWallA, DIM.logeNorthWall]]);
  B.wall(
    'loge_back',
    1,
    [[-DIM.logeWallA, -10.6], [-DIM.logeWallA, DIM.mezzCy], ...ellArc(DIM.logeWallA, DIM.logeWallB, DIM.mezzCy, Math.PI, 0, 120), [DIM.logeWallA, DIM.mezzCy], [DIM.logeWallA, -10.6]],
  );
  const phiCut = Math.acos(-DIM.foyerBlockHalf / DIM.outerR); // where the circle meets the foyer block
  const outerArc: P[] = [];
  for (let i = 0; i <= 90; i++) {
    const ph = Math.PI - ((Math.PI - phiCut) * i) / 90;
    outerArc.push([DIM.outerR * Math.cos(ph), DIM.outerR * Math.sin(ph)]);
  }
  const outerArcE = outerArc.map(([x, y]) => [-x, y] as P).reverse();
  B.wall('outer_W', 1, [[-DIM.logeWallA, -10.6], [-DIM.outerR, -10.6], [-DIM.outerR, 0], ...outerArc, [-DIM.foyerBlockHalf, DIM.foyerNorth], [-DIM.foyerHalf, DIM.foyerNorth]]);
  B.wall('outer_E', 1, [[DIM.foyerHalf, DIM.foyerNorth], [DIM.foyerBlockHalf, DIM.foyerNorth], ...outerArcE, [DIM.outerR, 0], [DIM.outerR, -10.6], [DIM.logeWallA, -10.6]]);
  B.wall('foyer_north', 1, [[-DIM.foyerHalf, DIM.foyerNorth], [DIM.foyerHalf, DIM.foyerNorth]]);
  B.wall('foyer_W', 1, [[-DIM.foyerHalf, DIM.foyerNorth], [-DIM.foyerHalf, DIM.foyerFront]]);
  B.wall('foyer_E', 1, [[DIM.foyerHalf, DIM.foyerNorth], [DIM.foyerHalf, DIM.foyerFront]]);
  B.wall('foyer_front', 1, [[-DIM.foyerBlockHalf, DIM.foyerFront], [DIM.foyerBlockHalf, DIM.foyerFront]]);
  B.wall('foyer_block_W', 1, [[-DIM.foyerBlockHalf, DIM.foyerNorth], [-DIM.foyerBlockHalf, DIM.foyerFront]]);
  B.wall('foyer_block_E', 1, [[DIM.foyerBlockHalf, DIM.foyerNorth], [DIM.foyerBlockHalf, DIM.foyerFront]]);
  // portico outer edge (drawn only), monumental stair outline
  const portEdge = (m: number): P[] => {
    const pts: P[] = [[m * DIM.porticoOuterR, -10.6], [m * DIM.porticoOuterR, 0]];
    for (let i = 0; i <= 40; i++) {
      const ph = (m < 0 ? Math.PI : 0) + (m < 0 ? -1 : 1) * rad(52) * (i / 40);
      pts.push([DIM.porticoOuterR * Math.cos(ph), DIM.porticoOuterR * Math.sin(ph)]);
    }
    return pts;
  };
  B.wall('portico_edge_W', 1, portEdge(-1), 'outline');
  B.wall('portico_edge_E', 1, portEdge(1), 'outline');
  B.wall('mon_stair', 1, [[-9.4, 27.8], [-9.4, DIM.streetY], [9.6, DIM.streetY], [9.6, 27.8]], 'outline');
  for (let i = 0; i < 12; i++) B.wall(`mon_step_${i}`, 1, [[-9.4, 28.2 + i * 0.75], [9.6, 28.2 + i * 0.75]], 'outline');
  [-8.1, -4.8, -1.5, 1.8, 4.9, 8.2].forEach((x, i) => B.wall(`fcol_${i}`, 1, circle([x, 26.5], 0.3), 'column'));
  // balcony stair footprints (outline)
  for (const m of [-1, 1]) B.wall(`bst_outline_${m}`, 1, [[m * 13.3, 15.9], [m * 10.6, 19.0], [m * 6.6, 20.0], [m * 6.4, 19.0], [m * 9.6, 17.3], [m * 12.2, 15.0]], 'outline');
  // floor 2
  B.wall('bal_rail', 2, [[-DIM.balRailA, DIM.balNorthWall], [-DIM.balRailA, bcy], ...ellArc(DIM.balRailA, DIM.balRailB, bcy, Math.PI, 0, 100), [DIM.balRailA, bcy], [DIM.balRailA, DIM.balNorthWall]], 'rail');
  B.wall('bal_outer', 2, [[-DIM.balWallA, DIM.balNorthWall], [-DIM.balWallA, bcy], ...ellArc(DIM.balWallA, DIM.balWallB, bcy, Math.PI, 0, 120), [DIM.balWallA, bcy], [DIM.balWallA, DIM.balNorthWall]]);
  B.wall('bal_north_W', 2, [[-DIM.balRailA, DIM.balNorthWall], [-DIM.balWallA, DIM.balNorthWall]]);
  B.wall('bal_north_E', 2, [[DIM.balRailA, DIM.balNorthWall], [DIM.balWallA, DIM.balNorthWall]]);
  B.balconyColumns.forEach((c, i) => B.wall(`bcol_${i}`, 2, circle(c, 0.35), 'column'));
  for (const m of [-1, 1]) B.wall(`bst2_outline_${m}`, 2, [[m * 13.3, 15.9], [m * 10.6, 19.0], [m * 9.0, 18.3], [m * 12.2, 15.0]], 'outline');
  B.wall('bal_stairwell_W', 2, [[-19.4, -12.0], [-23.0, -12.0], [-23.0, -16.6], [-19.4, -16.6], [-19.4, -12.0]], 'outline');
  B.wall('bal_stairwell_E', 2, [[19.4, -12.0], [23.0, -12.0], [23.0, -16.6], [19.4, -16.6], [19.4, -12.0]], 'outline');

  // Cut wall openings where door / stair / passage links cross a wall on the same floor
  cutOpenings(B);

  // =================================================================================
  // SEATS: solve pitch per level so counts equal official capacities
  // =================================================================================
  const capacity = { orchestra: 527, mezzanine: 486, balcony: 316, total: 1329, wheelchair: 3 };
  const linkMap = new Map(B.links.map((l) => [l.id, l]));
  const levelTargets: Record<Seat['level'], number> = {
    orchestra: capacity.orchestra,
    mezzanine: capacity.mezzanine - wheelchairSlots.length,
    balcony: capacity.balcony,
  };
  for (const level of ['orchestra', 'mezzanine', 'balcony'] as const) {
    const segs = expandSegments(B.segments.filter((s) => s.level === level));
    const target = levelTargets[level];
    const countAt = (p: number) => segs.reduce((acc, s) => acc + Math.max(0, Math.floor((s.s1 - s.s0) / p)), 0);
    let lo = 0.3;
    let hi = 0.9;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (countAt(mid) >= target) lo = mid;
      else hi = mid;
    }
    const pitch = lo;
    const counts = segs.map((s) => Math.max(0, Math.floor((s.s1 - s.s0) / pitch)));
    let excess = counts.reduce((a, b) => a + b, 0) - target;
    // remove extras from the segments with the largest remaining slack ratio
    while (excess > 0) {
      let best = -1;
      let bestSlack = -Infinity;
      segs.forEach((s, i) => {
        if (counts[i] <= 0) return;
        const slack = (s.s1 - s.s0) / counts[i];
        const score = -slack + counts[i] * 1e-3;
        if (score > bestSlack) {
          bestSlack = score;
          best = i;
        }
      });
      counts[best]--;
      excess--;
    }
    notes.push(`Seat pitch ${level}: ${pitch.toFixed(3)} m (nominal 20-22 inch chairs = 0.51-0.56 m)`);
    segs.forEach((seg, i) => {
      const n = counts[i];
      const link = linkMap.get(seg.link)!;
      const len = polyLen(link.pts);
      const nodeA = B.nodes.get(link.a)!;
      const nodeB = B.nodes.get(link.b)!;
      for (let q = 0; q < n; q++) {
        const s = seg.s0 + ((q + 0.5) * (seg.s1 - seg.s0)) / n;
        const { pt, dir } = pointAt(link.pts, s);
        const seatPt = offsetAway(pt, dir, 0.42);
        const dA = nodeA.kind === 'deadEnd' ? Infinity : s;
        const dB = nodeB.kind === 'deadEnd' ? Infinity : len - s;
        const zone = typeof seg.zone === 'function' ? seg.zone(pt[0]) : seg.zone;
        B.seats.push({
          id: `${seg.section}-${seg.row}-${q + 1}`,
          level,
          section: seg.section,
          row: seg.row,
          link: seg.link,
          s: r3(s),
          x: r3(seatPt[0]),
          y: r3(seatPt[1]),
          zone,
          aisleDist: r3(Math.min(dA, dB)),
          rowIndex: seg.rowIndex,
        });
      }
    });
  }
  wheelchairSlots.forEach((w, i) => {
    const link = linkMap.get(w.link)!;
    const { pt, dir } = pointAt(link.pts, w.s);
    const seatPt = offsetAway(pt, dir, 0.42);
    const len = polyLen(link.pts);
    B.seats.push({
      id: `WHEELCHAIR-${i + 1}`,
      level: 'mezzanine',
      section: 'MEZZ4',
      row: 'EE',
      link: w.link,
      s: r3(w.s),
      x: r3(seatPt[0]),
      y: r3(seatPt[1]),
      zone: pt[0] < 0 ? 'MEZZ_C_W' : 'MEZZ_C_E',
      wheelchair: true,
      aisleDist: r3(Math.min(w.s, len - w.s)),
      rowIndex: 4,
    });
  });

  // =================================================================================
  // ZONES, CROWD-MANAGER POSTS, OVERLAYS, LABELS
  // =================================================================================
  const zones: ZoneDef[] = [];
  const z = (id: string, label: string, level: ZoneDef['level'], defaultExit: ExitGroupId) => zones.push({ id, label, level, defaultExit });
  for (const S of ['W', 'E'] as const) {
    const side = S === 'W' ? 'west' : 'east';
    z(`ORCH_FRONT_${S}`, `Orchestra front ${side} side (rows A-G)`, 'orchestra', S === 'W' ? 'STAGE_W' : 'STAGE_E');
    z(`ORCH_SIDE_${S}`, `Orchestra ${side} side (rows H-T)`, 'orchestra', S === 'W' ? 'PORTICO_W' : 'PORTICO_E');
    z(`LOGE_${S}_N`, `Loge ${side} 1xx (near stage)`, 'mezzanine', S === 'W' ? 'PORTICO_W' : 'PORTICO_E');
    z(`LOGE_${S}_S`, `Loge ${side} 2xx`, 'mezzanine', S === 'W' ? 'PORTICO_W' : 'PORTICO_E');
    z(`MEZZ_${S}`, `Mezzanine ${side} curve (3xx)`, 'mezzanine', S === 'W' ? 'PORTICO_W' : 'PORTICO_E');
    z(`MEZZ_C_${S}`, `Mezzanine centre ${side} half (4xx)`, 'mezzanine', 'FOYER');
    z(`BAL_${S}_N`, `Balcony ${side} straight (1xx)`, 'balcony', S === 'W' ? 'BAL_NW' : 'BAL_NE');
    z(`BAL_${S}_S`, `Balcony ${side} curve (2xx)`, 'balcony', 'FOYER');
    z(`BAL_C_${S}`, `Balcony centre ${side} half (3xx)`, 'balcony', 'FOYER');
  }
  z('ORCH_C_FRONT', 'Orchestra centre rows A-H', 'orchestra', 'FOYER');
  z('ORCH_C_BACK', 'Orchestra centre rows J-T', 'orchestra', 'FOYER');

  const posts: CrowdManagerPost[] = [
    { id: 'CM1', x: -12.8, y: DIM.caM, floor: 1, label: 'Loge W cross-aisle (D1)', zones: ['LOGE_W_N', 'LOGE_W_S', 'ORCH_FRONT_W', 'ORCH_SIDE_W'] },
    { id: 'CM2', x: 12.8, y: DIM.caM, floor: 1, label: 'Loge E cross-aisle (D9)', zones: ['LOGE_E_N', 'LOGE_E_S', 'ORCH_FRONT_E', 'ORCH_SIDE_E'] },
    { id: 'CM3', x: -DIM.radialX, y: 12.4, floor: 1, label: 'Mezzanine W radial aisle (D4)', zones: ['MEZZ_W', 'MEZZ_C_W', 'ORCH_C_BACK'] },
    { id: 'CM4', x: DIM.radialX, y: 12.4, floor: 1, label: 'Mezzanine E radial aisle (D6)', zones: ['MEZZ_E', 'MEZZ_C_E', 'ORCH_C_BACK'] },
    { id: 'CM5', x: -18.4, y: 2.85, floor: 2, label: 'Balcony W', zones: ['BAL_W_N', 'BAL_W_S', 'BAL_C_W'] },
    { id: 'CM6', x: 18.4, y: 2.85, floor: 2, label: 'Balcony E', zones: ['BAL_E_N', 'BAL_E_S', 'BAL_C_E'] },
    { id: 'CM7', x: 0, y: DIM.frontY, floor: 1, label: 'Orchestra front (extra)', zones: ['ORCH_C_FRONT', 'ORCH_FRONT_W', 'ORCH_FRONT_E'] },
    { id: 'CM8', x: 0, y: 17.6, floor: 1, label: 'Corridor south / foyer (extra)', zones: [] },
    { id: 'CM9', x: 0, y: bcy + bwB, floor: 2, label: 'Balcony centre (extra)', zones: ['BAL_C_W', 'BAL_C_E'] },
    { id: 'CM10', x: 0, y: 8.9, floor: 1, label: 'Orchestra back (extra)', zones: ['ORCH_C_BACK', 'ORCH_SIDE_W', 'ORCH_SIDE_E'] },
  ];

  const overlays: MapOverlay[] = [
    { id: 'plan1', floor: 1, image: 'maps/page4_raw.png', label: 'First-floor plan (PDF p.4)', pxOrigin: [443, 300], metresPerPxX: 0.08, metresPerPxY: 0.08, rotationDeg: 0, worldOrigin: [0, 0] },
    { id: 'plan2', floor: 2, image: 'maps/page5_raw.png', label: 'Second-floor plan (PDF p.5)', pxOrigin: [300, 384.1], metresPerPxX: 0.0794, metresPerPxY: 0.0794, rotationDeg: 0, worldOrigin: [0, 0] },
    { id: 'chart1', floor: 1, image: 'maps/page6_chart.png', label: 'Orchestra & loge seating chart (PDF p.6, rotated 180°)', pxOrigin: [4451 / 3, 4240 / 3], metresPerPxX: 0.004055 * 3, metresPerPxY: 0.00433 * 3, rotationDeg: 180, worldOrigin: [0, 0] },
    { id: 'chart2', floor: 2, image: 'maps/page7_chart.png', label: 'Balcony seating chart (PDF p.7, rotated 180°)', pxOrigin: [4826 / 3, 5602 / 3], metresPerPxX: 0.004085 * 3, metresPerPxY: 0.003836 * 3, rotationDeg: 180, worldOrigin: [0, 0] },
  ];

  // labels
  B.label([0, -9.6], 1, 'STAGE', 1.2);
  B.label([0, 1.0], 1, 'ORCHESTRA', 1.0);
  B.label([-12.4, -1.2], 1, 'LOGE W', 0.7);
  B.label([12.4, -1.2], 1, 'LOGE E', 0.7);
  B.label([0, 13.0], 1, 'MEZZANINE', 0.8);
  B.label([-17.5, -7.5], 1, 'CORRIDOR', 0.6);
  B.label([0, 22.0], 1, 'FOYER', 0.9);
  B.label([0, 32.0], 1, 'MONUMENTAL STAIR', 0.8);
  B.label([-21.0, -7.5], 1, 'PORTICO', 0.55);
  B.label([21.0, -7.5], 1, 'PORTICO', 0.55);
  B.label([0, 0], 2, 'OPEN TO BELOW', 1.0);
  B.label([0, 13.8], 2, 'BALCONY', 0.9);
  for (const l of B.links) {
    if (l.kind === 'door' && l.label) {
      const mid = pointAt(l.pts, polyLen(l.pts) / 2).pt;
      B.label(mid, l.floor === 0 ? 1 : l.floor, l.label, 0.45);
    }
  }

  return {
    version: 1,
    name: 'Bailey Hall, Cornell University - reconstructed evacuation geometry',
    notes,
    nodes: [...B.nodes.values()],
    links: B.links,
    seats: B.seats,
    walls: B.walls,
    overlays,
    zones,
    crowdManagerPosts: posts,
    capacity,
    labels: B.labels,
  };
}

function circle(c: P, r: number): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= 12; i++) pts.push([c[0] + r * Math.cos((i / 12) * 2 * Math.PI), c[1] + r * Math.sin((i / 12) * 2 * Math.PI)]);
  return pts;
}

/** Offset a point perpendicular to dir, choosing the side farther from the stage reference point. */
function offsetAway(pt: P, dir: P, d: number): P {
  const n1: P = [-dir[1], dir[0]];
  const ref: P = [0, -9];
  const c1: P = [pt[0] + n1[0] * d, pt[1] + n1[1] * d];
  const c2: P = [pt[0] - n1[0] * d, pt[1] - n1[1] * d];
  return Math.hypot(c1[0] - ref[0], c1[1] - ref[1]) > Math.hypot(c2[0] - ref[0], c2[1] - ref[1]) ? c1 : c2;
}

function expandSegments(segs: RowSegment[]): RowSegment[] {
  const out: RowSegment[] = [];
  for (const s of segs) {
    if (!s.exclude || s.exclude.length === 0) {
      out.push(s);
      continue;
    }
    const ex = [...s.exclude].sort((a, b) => a[0] - b[0]);
    let cur = s.s0;
    for (const [e0, e1] of ex) {
      if (e0 > cur + 0.3) out.push({ ...s, s0: cur, s1: Math.min(e0, s.s1), exclude: undefined });
      cur = Math.max(cur, e1);
    }
    if (s.s1 > cur + 0.3) out.push({ ...s, s0: cur, s1: s.s1, exclude: undefined });
  }
  return out;
}

// --------------------------------------------------------------------------------------
// wall opening cutter
// --------------------------------------------------------------------------------------
export function segIntersect(p1: P, p2: P, p3: P, p4: P): { t: number; u: number } | null {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

const OPENING_KINDS = new Set(['door', 'stair']);

function cutOpenings(B: BaileyHallBuilder) {
  const newWalls: WallPolyline[] = [];
  for (const w of B.walls) {
    if (w.kind === 'outline' || w.kind === 'column') {
      newWalls.push(w);
      continue;
    }
    // collect cut intervals along the wall (arc length)
    const cuts: [number, number][] = [];
    let acc = 0;
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const l of B.links) {
        if (!OPENING_KINDS.has(l.kind)) continue;
        if (l.floor !== w.floor && !(l.floor === 0 && w.floor === 1)) continue;
        for (let j = 1; j < l.pts.length; j++) {
          const hit = segIntersect(a, b, l.pts[j - 1], l.pts[j]);
          if (hit) {
            const s = acc + hit.t * L;
            const half = l.width / 2 + 0.08;
            cuts.push([s - half, s + half]);
          }
        }
      }
      acc += L;
    }
    if (cuts.length === 0) {
      newWalls.push(w);
      continue;
    }
    cuts.sort((u, v) => u[0] - v[0]);
    const total = polyLen(w.pts);
    let cur = 0;
    let piece = 0;
    for (const [c0, c1] of cuts) {
      if (c0 > cur + 0.01) newWalls.push({ ...w, id: `${w.id}#${piece++}`, pts: subPoly(w.pts, cur, Math.max(cur, c0)).map(rp) });
      cur = Math.max(cur, c1);
    }
    if (cur < total - 0.01) newWalls.push({ ...w, id: `${w.id}#${piece++}`, pts: subPoly(w.pts, cur, total).map(rp) });
  }
  B.walls = newWalls;
}
