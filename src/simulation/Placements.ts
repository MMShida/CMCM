/**
 * Six-manager placement strategies (fixed posts). Coordinates are taken next to junctions of the
 * reconstructed navigation graph (no post stands in a door leaf, a stair flight or a seat row).
 *
 *   existing    the geometry's posts CM1-CM6 and their zones (baseline)
 *   decision    where occupants can still choose between major routes: orchestra front cross-aisle
 *               (stage exits vs. aisles), top of the centre aisles (D4-D6 vs. side passages),
 *               west / east corridor at the portico doors (porticos vs. foyer), balcony walkways at
 *               the junction between the north stairs and the south stairs
 *   bottleneck  upstream of capacity constraints: corridor at FC1-FC3 (foyer), tops of the 1.1 m
 *               centre aisles (AW / AE), west portico door P2, balcony south stair doors BSDW / BSDE
 *   hybrid222   two at the balcony staircase decision areas, two at the mezzanine / orchestra exit
 *               decision points (D4 / D6 radial aisles), two at the west / east corridor junctions
 *   robust      keeps one manager upstream of every major exit group so a single closure leaves no
 *               zone without an informed manager: orchestra front, loge W, loge E, corridor south
 *               (foyer / portico choice), balcony W, balcony E
 *
 * Formal responsibility for the alternative layouts: every seating zone is assigned to the manager
 * on the same floor closest to the zone's seat centroid (a transparent planning rule, not optimised).
 */
import type { CrowdManagerPost, GeometryData } from '../geometry/types';
import type { PlacementId } from './Params';

type P = [id: string, x: number, y: number, floor: 1 | 2, label: string];

// Candidate staff posts beside existing aisles; staff footprint is not simulated (inherited).
const COVERAGE: P[] = [
  ['CV1', -5.1, -3.2, 1, 'West orchestra aisle, early seat coverage'],
  ['CV2', 5.1, -3.2, 1, 'East orchestra aisle, early seat coverage'],
  ['CV3', -4.9, 12.4, 1, 'West mezzanine radial aisle'],
  ['CV4', 4.9, 12.4, 1, 'East mezzanine radial aisle'],
  ['CV5', -18.4, 2.85, 2, 'West balcony decision area'],
  ['CV6', 18.4, 2.85, 2, 'East balcony decision area'],
];
const COVERAGE10: P[] = [...COVERAGE, ['CV7', -12.8, -4.8, 1, 'West loge'], ['CV8', 12.8, -4.8, 1, 'East loge'], ['CV9', 0, 17.6, 1, 'Foyer approach'], ['CV10', 0, 12.2, 1, 'Rear cross-aisle']];
const COVERAGE12: P[] = [...COVERAGE10,['CV11',-4.8,-7.2,1,'West front cross-aisle'],['CV12',4.8,-7.2,1,'East front cross-aisle']];
const LAYOUTS: Record<Exclude<PlacementId, 'existing'>, P[]> = {
  coverage: COVERAGE,
  coverage10: COVERAGE10,
  coverage12: COVERAGE12,
  coverage18: [...COVERAGE12,
    ['CV13',-5.4,5.8,1,'West rear orchestra aisle'],['CV14',5.4,5.8,1,'East rear orchestra aisle'],
    ['CV15',-11.6,13.8,2,'West balcony south junction'],['CV16',11.6,13.8,2,'East balcony south junction'],
    ['CV17',0,15.2,2,'Central balcony aisle'],['CV18',0,18.1,2,'Central balcony rear walkway']],
  decision: [
    ['DP1', 0, -7.0, 1, 'Orchestra front cross-aisle (stage exits vs. aisles)'],
    ['DP2', 0, 12.0, 1, 'Mezzanine centre aisle above the orchestra (D4 / D5 / D6)'],
    ['DP3', -16.5, 7.5, 1, 'West corridor at P2 (portico vs. foyer)'],
    ['DP4', 16.5, 7.5, 1, 'East corridor at P3 (portico vs. foyer)'],
    ['DP5', -17.6, 3.6, 2, 'Balcony W walkway junction (north vs. south stair)'],
    ['DP6', 17.6, 3.6, 2, 'Balcony E walkway junction (north vs. south stair)'],
  ],
  bottleneck: [
    ['BN1', 0, 18.4, 1, 'Corridor south at FC1-FC3 (foyer doors)'],
    ['BN2', -5.4, 8.6, 1, 'Top of centre aisle AW (1.1 m)'],
    ['BN3', 5.4, 8.6, 1, 'Top of centre aisle AE (1.1 m)'],
    ['BN4', -16.0, 8.2, 1, 'West corridor at portico door P2'],
    ['BN5', -11.6, 13.8, 2, 'Balcony SW stair door BSDW'],
    ['BN6', 11.6, 13.8, 2, 'Balcony SE stair door BSDE'],
  ],
  hybrid222: [
    ['HY1', -11.6, 13.8, 2, 'Balcony SW staircase decision area'],
    ['HY2', 11.6, 13.8, 2, 'Balcony SE staircase decision area'],
    ['HY3', -4.9, 12.4, 1, 'Mezzanine W radial aisle (D4)'],
    ['HY4', 4.9, 12.4, 1, 'Mezzanine E radial aisle (D6)'],
    ['HY5', -15.5, 8.0, 1, 'West corridor junction (P2 / D3)'],
    ['HY6', 15.5, 8.0, 1, 'East corridor junction (P3 / D7)'],
  ],
  robust: [
    ['RB1', 0, -7.0, 1, 'Orchestra front cross-aisle'],
    ['RB2', -12.8, -4.8, 1, 'Loge W cross-aisle (D1)'],
    ['RB3', 12.8, -4.8, 1, 'Loge E cross-aisle (D9)'],
    ['RB4', 0, 18.4, 1, 'Corridor south (foyer / portico choice)'],
    ['RB5', -18.4, 2.85, 2, 'Balcony W'],
    ['RB6', 18.4, 2.85, 2, 'Balcony E'],
  ],
};

export const PLACEMENT_LABEL: Record<PlacementId, string> = {
  coverage12: 'H. Extended coverage (12 staff)',
  coverage18: 'I. Extended coverage (18 staff)',
  coverage: 'F. Seat coverage (6 staff)',
  coverage10: 'G. Seat coverage (10 staff)',
  existing: 'A. Existing posts (CM1-CM6)',
  decision: 'B. Decision points',
  bottleneck: 'C. Bottleneck-oriented',
  hybrid222: 'D. Hybrid 2-2-2',
  robust: 'E. Robust (one per exit group)',
};

const cache = new WeakMap<GeometryData, Map<string, CrowdManagerPost[]>>();

/** posts of a placement (null = use the geometry's own posts, i.e. the existing layout) */
export function placementPosts(geo: GeometryData, id: PlacementId | undefined): CrowdManagerPost[] | null {
  if (!id || id === 'existing') return null;
  let m = cache.get(geo);
  if (!m) cache.set(geo, (m = new Map()));
  const hit = m.get(id);
  if (hit) return hit;
  const posts: CrowdManagerPost[] = LAYOUTS[id].map(([pid, x, y, floor, label]) => ({ id: pid, x, y, floor, label, zones: [] }));
  // zone centroids
  const acc = new Map<string, { x: number; y: number; n: number; floor: number }>();
  for (const s of geo.seats) {
    const z = acc.get(s.zone) ?? { x: 0, y: 0, n: 0, floor: s.level === 'balcony' ? 2 : 1 };
    z.x += s.x;
    z.y += s.y;
    z.n++;
    acc.set(s.zone, z);
  }
  for (const [zone, c] of acc) {
    const cx = c.x / c.n;
    const cy = c.y / c.n;
    const same = posts.filter((p) => p.floor === c.floor);
    const pool = same.length ? same : posts;
    let best = pool[0];
    let bd = Infinity;
    for (const p of pool) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    best.zones.push(zone);
  }
  for (const p of posts) p.zones.sort();
  m.set(id, posts);
  return posts;
}
