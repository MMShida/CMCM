import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { SCENARIOS } from '../src/simulation/Scenarios';
import { runSimulation } from '../src/simulation/SimulationEngine';
const only = process.argv[2]?.split(',');
for (const s of SCENARIOS) {
  if (only && !only.includes(s.id)) continue;
  const cfg = s.build(BAILEY_HALL);
  const t0 = Date.now();
  const r = runSimulation(BAILEY_HALL, cfg, 1);
  const u = r.exitGroupUsage;
  console.log(`${s.id.padEnd(18)} N=${r.N} tEvac=${r.tEvac.toFixed(0)} tSafe=${r.tSafe.toFixed(0)} p95=${r.p95Exit.toFixed(0)} medStart=${r.medianStart.toFixed(0)} grid=${r.gridlock} unres=${JSON.stringify(r.unresolved)} peak=${r.peakDensity}@${r.peakDensityWhere} rer=${r.reroutedAgents} wall=${Date.now()-t0}ms`);
  console.log('    usage', Object.entries(u).map(([k,v])=>`${k}:${v}`).join(' '));
}
