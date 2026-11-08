/** Deliberate optimistic parameter stress test, excluded from the primary result. */
import {readFileSync,writeFileSync} from 'node:fs';
import {summarize} from '../src/simulation/MonteCarlo';
const root='results/research-180/',read=(f:string)=>JSON.parse(readFileSync(root+f,'utf8'));
const data=read('congestion.json'),base=read('calibration.json').results.find((r:any)=>r.id==='inherited'&&r.model==='A');
if(data.results.length!==6||data.results.some((r:any)=>r.runs.length!==12))throw new Error('Congestion check incomplete');
const rows=[base,...data.results],f=(x:any)=>typeof x==='number'&&Number.isFinite(x)?x.toFixed(1):'unresolved';
const best=[...rows].filter(r=>!r.stats.failures).sort((a,b)=>a.stats.mean-b.stats.mean)[0];
const by=new Map(base.runs.map((r:any)=>[r.seed,r.tEvac]));
const delta=summarize(best.runs.map((r:any)=>r.tEvac-(by.get(r.seed) as number)));
const exposure=(r:any)=>r.runs.reduce((s:number,x:any)=>s+x.density.exposure.mean,0)/r.runs.length;
const table='| A parameter case | H (s) | Counterflow coefficient | Density cap | Mean s | Runs ≤180 |\n|---|---|---|---|---|---|\n'+rows.map(r=>`| ${r.id} | ${r.cfg.movement.timeHeadway} | ${r.cfg.movement.counterflowFriction} | ${r.cfg.movement.maxDensity} | ${f(r.stats.mean)} | ${Math.round(r.stats.p180.p*12)}/12 |`).join('\n');
const text=`## 6c. Can we simply weaken congestion until A passes?

This final user-requested check deliberately goes beyond the research-motivated calibration range. It removes the explicit opposing-flow speed penalty, raises the occupancy cap from 4.5 to 5.4 persons/m², and reduces net headway as far as 0.1 s. These settings are **diagnostics, not Bailey-calibrated improvements**. Geometry, audience, intrinsic speeds, response, groups and the selected A guidance remain unchanged. Each row uses the same 12 training audiences.

${table}

The fastest tested case is **${best.id}: ${f(best.stats.mean)} s [${f(best.stats.ciLow)}, ${f(best.stats.ciHigh)}]**, with ${best.stats.failures}/12 unresolved runs. Its paired change from inherited parameters is **${f(delta.mean)} s [${f(delta.ciLow)}, ${f(delta.ciHigh)}]**. Mean individual excess-density exposure is ${f(exposure(best))}, versus ${f(exposure(base))} person·s/m² originally.

At the unchanged representative speed 1.2 m/s and mean body diameter 0.44 m, reducing H from 0.7 to 0.3 or 0.1 s increases nominal lane capacity from 0.938 to 1.50 or 2.14 persons/s: approximately **60% or 129% more**. This changes physical throughput assumptions even though no aisle is widened. Removing counterflow friction still leaves lane sharing, body gaps, merging and queue constraints. Raising the density cap permits more crowding; it does not add door capacity.

${best.stats.mean<180?'This deliberately optimistic setting crosses 180 in the exploratory sample. It is not independent confirmation and does not establish that those physical assumptions are realistic.':'Even these deliberately optimistic tests do not produce a sub-180 mean. They do not prove that every possible intervention or calibration must fail.'} The headway literature motivates testing shorter gaps, but it does not justify using 0.1 s for this mixed full-house audience. A target is an evaluation criterion, not a calibration observation.

No stress-test setting replaces the defaults or primary confirmed plans. Files: \`congestion-cases.json\`, \`congestion.json\`; reproduce with the study runner's evaluate mode, 12 runs and training seed base 9001. \`research-congestion-report.ts\` regenerates this page.
`;
writeFileSync('docs/research-180/CONGESTION_AUDIT.md',text);
writeFileSync(root+'congestion-summary.json',JSON.stringify({best:best.id,stats:best.stats,paired:delta,primaryConfigurationChanged:false},null,2));
console.log(best.id,best.stats.mean,'s');
