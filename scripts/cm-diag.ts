/** How Crowd Manager guidance propagates in Model A: who hears it, who accepts it, who follows it. */
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { EXIT_GROUPS } from '../src/geometry/types';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { scenarioById } from '../src/simulation/Scenarios';
const seeds = [1, 2, 3];
const by: Record<string, { n: number; heard: number; accepted: number; followed: number; foyer: number }> = {};
const zoneHeard: Record<string, [number, number]> = {};
for (const seed of seeds) {
  const sim = new SimulationEngine(BAILEY_HALL, scenarioById('concert-emergency'), seed);
  sim.run();
  for (const a of sim.agents) {
    const k = a.type;
    const b = (by[k] ??= { n: 0, heard: 0, accepted: 0, followed: 0, foyer: 0 });
    b.n++;
    const exitG = a.exitLink >= 0 ? sim.graph.links[a.exitLink].exitGroup : a.targetGroup;
    if (a.instructedCM) b.heard++;
    if (a.cmGroup >= 0) {
      b.accepted++;
      if (exitG === a.cmGroup) b.followed++;
    }
    if (exitG === 0) b.foyer++;
    const z = BAILEY_HALL.seats[a.seat].zone;
    const zh = (zoneHeard[z] ??= [0, 0]);
    zh[0]++;
    if (a.instructedCM) zh[1]++;
  }
}
console.log('type          n   heard  accepted  followed-if-accepted  used foyer');
for (const [k, b] of Object.entries(by)) console.log(k.padEnd(13), String(b.n).padStart(4), `${((b.heard / b.n) * 100).toFixed(0)}%`.padStart(6), `${((b.accepted / b.n) * 100).toFixed(0)}%`.padStart(9), `${((b.followed / Math.max(1, b.accepted)) * 100).toFixed(0)}%`.padStart(20), `${((b.foyer / b.n) * 100).toFixed(0)}%`.padStart(11));
console.log('share who heard a Crowd Manager, by zone:');
console.log(Object.entries(zoneHeard).map(([z, [n, h]]) => `${z} ${((h / n) * 100).toFixed(0)}%`).join(' | '));
void EXIT_GROUPS;
