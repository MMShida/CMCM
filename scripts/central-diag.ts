/**
 * Diagnoses the central-aisle / foyer accumulation: at fixed times, for the people standing in the
 * central orchestra aisles (AW/AE) and in the corridor / foyer, reports their target exit, why
 * they chose it, how many exits they know, and the nominal (walking) and staff-estimated costs of
 * the alternatives from where they stand.
 *   npx tsx scripts/central-diag.ts [--scenario concert-emergency] [--seed 11]
 */
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { EXIT_GROUPS } from '../src/geometry/types';
import { REASON_LABEL } from '../src/simulation/Agent';
import { scenarioById } from '../src/simulation/Scenarios';
import { SimulationEngine } from '../src/simulation/SimulationEngine';

const arg = (n: string, d: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const cfg = scenarioById(arg('scenario', 'concert-emergency'));
if (process.argv.includes('--adaptive')) {
  (cfg as any).adaptive = { ...(cfg as any).adaptive, agents: true, managers: true };
}
const sim = new SimulationEngine(BAILEY_HALL, cfg, Number(arg('seed', '11')));
const g = sim.graph;
const areas: [string, RegExp][] = [
  ['central aisles AW/AE', /^A[WE]_L\d+$/],
  ['side passages SPW/SPE', /^SP[WE]_\d+$/],
  ['corridor CO/CFC', /^(CO|CFC)_\d+$/],
  ['foyer FYL/FYV', /^FY[LV]_\d+$/],
];
for (const T of [45, 60, 90, 120, 150]) {
  while (sim.t < T && !sim.finished) sim.step();
  console.log(`\n=== t = ${T} s, inside ${sim.agents.filter((a) => a.inside).length}`);
  const q = EXIT_GROUPS.map((_, gi) => {
    let s = 0;
    g.links.forEach((L, li) => {
      if (L.gate && L.exitGroup === gi) s += sim.gates.queueNow[li];
    });
    return s;
  });
  console.log('queue at exterior doors by group', EXIT_GROUPS.map((e, i) => `${e}:${q[i]}`).join(' '));
  for (const [name, re] of areas) {
    const ag = sim.agents.filter((a) => a.link >= 0 && re.test(g.links[a.link].id) && !a.done);
    if (!ag.length) continue;
    const tgt: Record<string, number> = {};
    const reason: Record<string, number> = {};
    let known = 0;
    let onlyFoyer = 0;
    let cm = 0;
    let altCheaper = 0;
    for (const a of ag) {
      const gname = a.targetGroup >= 0 ? EXIT_GROUPS[a.targetGroup] : 'none';
      tgt[gname] = (tgt[gname] ?? 0) + 1;
      reason[REASON_LABEL[a.reason]] = (reason[REASON_LABEL[a.reason]] ?? 0) + 1;
      let k = 0;
      for (let gi = 0; gi < 7; gi++) if (a.knownExits & (1 << gi)) k++;
      known += k;
      if (a.knownExits === 1) onlyFoyer++;
      if (a.cmGroup >= 0) cm++;
      // staff (true-state) estimate from here: is another exit at least 20 s better?
      const est = EXIT_GROUPS.map((_, gi) => sim.guidance.staffEstimate(sim.routing.estimateFrom(a, sim.staffFields(false)[gi]).node, gi) + 0);
      const cur = a.targetGroup >= 0 ? est[a.targetGroup] : Infinity;
      if (Math.min(...est) < cur - 20) altCheaper++;
    }
    console.log(`${name}: n=${ag.length}  mean known exits ${(known / ag.length).toFixed(2)}  know ONLY the main foyer ${onlyFoyer}  with CM guidance ${cm}  alternative >=20 s better (true state) ${altCheaper}`);
    console.log('   targets', JSON.stringify(tgt));
    console.log('   reasons', JSON.stringify(reason));
  }
}
const r = sim.run();
console.log('\nexit group usage', JSON.stringify(r.exitGroupUsage), 'T', r.tEvac);
