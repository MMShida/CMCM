/** Summarise user-requested calibration audit without changing the primary selection. */
import {readFileSync,writeFileSync} from 'node:fs';
import {summarize} from '../src/simulation/MonteCarlo';
const root='results/research-180/',read=(f:string)=>JSON.parse(readFileSync(root+f,'utf8'));
const c=read('calibration.json'),net=['refined-A','visible-B'].flatMap(id=>read('network-audit-'+id+'.json').results);
if(c.results.length!==14||net.length!==8||[...c.results,...net].some((r:any)=>r.runs.length!==12))throw new Error('Calibration audit incomplete');
const f=(x:any)=>typeof x==='number'&&Number.isFinite(x)?x.toFixed(1):'unresolved';
const ci=(r:any)=>r.stats.failures?'unresolved':`${f(r.stats.mean)} [${f(r.stats.ciLow)}, ${f(r.stats.ciHigh)}]`;
const table=(h:string[],rows:any[][])=>'| '+h.join(' | ')+' |\n|'+h.map(()=>'---').join('|')+'|\n'+rows.map(r=>'| '+r.join(' | ')+' |').join('\n');
const a=c.results.filter((r:any)=>r.model==='A'),base=a.find((r:any)=>r.id==='inherited');
const paired=(r:any)=>{const by=new Map(base.runs.map((x:any)=>[x.seed,x.tEvac]));return summarize(r.runs.map((x:any)=>x.tEvac-(by.get(x.seed) as number)));};
const best=[...a].filter((r:any)=>!r.stats.failures).sort((x:any,y:any)=>x.stats.mean-y.stats.mean)[0];
const labels:Record<string,string>={'inherited':'Inherited parameters','row060':'Row speed only','headway060':'Headway 0.60','headway050':'Headway 0.50','headway106':'Headway 1.06','row060-headway060':'Row + headway 0.60','row060-headway050':'Row + headway 0.50'};
const nb=(id:string)=>net.find((r:any)=>r.plan==='visible-B'&&r.id===id);
const delta=paired(best);
const exposure=(r:any)=>r.runs.reduce((s:number,x:any)=>s+x.density.exposure.mean,0)/r.runs.length;
const text=`## 6a. Is Model B reasonable, and why is it faster?

B is a useful aggregate queue-and-route model. It is **not independently calibrated for Bailey**, and A's extra detail does not automatically make A correct. The same B-selected plan takes 257.4 s in A and 166.4 s in B on the 40 confirmation audiences.

| Mechanism | Spatial A | Network B |
|---|---|---|
| Seats to aisle | Actual row gaps, occupied-seat squeezing, no passing | Timed row travel, then aggregate row-end queue |
| Aisle movement | Individual gaps and lane order; slow walkers constrain followers | Representative capacity at 1.2 m/s, then individual transit time |
| Groups | Readiness, pace and physical separation/cohesion stops | Readiness, leader choice and slowest-member pace; no spatial cohesion stop |
| Crowding | Continuous space and opposing-flow interactions | Density slowdown off by default; approximate node storage |
| Recorded start | First physical row insertion | Beginning of timed row traversal after readiness |

The following **12-audience training-seed diagnostics** keep the selected plans and use only B's existing options. “No relief” removes the 30 s storage bypass but retains its original incoming-arc storage approximation; it is not a strict reservation of all incoming streams.

${table(['Plan','B option','Mean s [95% CI]','Unresolved'],net.map((r:any)=>[r.plan==='refined-A'?'A-selected':'B, wall occlusion',r.id,ci(r),r.stats.failures+'/12']))}

Density slowing changes visible-sign B from ${f(nb('inherited').stats.mean)} to ${f(nb('density-slowing').stats.mean)} s; removing relief alone gives ${f(nb('no-storage-relief').stats.mean)} s. Slowing acts over a whole contracted arc at admission, possibly overlapping queue delay. **This uncalibrated sensitivity is not the corrected answer.** B's sub-180 result depends on its movement representation.

## 6b. Can existing A parameters reasonably reduce time?

The user-requested calibration audit changes two existing parameters while preserving all 1,329 people, geometry, body sizes, free-speed distribution, response, groups, compliance and guidance. These are **12 common training audiences**, separate from the unchanged-problem confirmation. Changing physical parameters is not counted as a guidance/barrier success.

${table(['Parameter case','Row m/s','Headway s','A mean [95% CI]','B mean [95% CI]'],a.map((r:any)=>[labels[r.id],r.cfg.movement.rowSpeed,r.cfg.movement.timeHeadway,ci(r),ci(c.results.find((x:any)=>x.id===r.id&&x.model==='B'))]))}

The fastest tested A setting is **${labels[best.id]}**, ${ci(best)} s, versus ${f(base.stats.mean)} s with inherited parameters. Its paired change is **${f(delta.mean)} s [${f(delta.ciLow)}, ${f(delta.ciHigh)}]**; ${Math.round(best.stats.p180.p*12)}/12 audiences clear by 180. The paired interval includes zero, so this sample does not establish a reliable improvement. Mean individual excess-density exposure rises from ${f(exposure(base))} to ${f(exposure(best))} person·s/m². This is an exploratory comparison, not a confirmed winner or proof that 180 is impossible.

**Research supports testing, not choosing by the target.** Spearpoint and Xiang's lecture-theatre validation questioned a universal 0.45 m/s row cap and discusses 0.60 m/s as an alternative model value. Johansson motivates shorter net headways, while Seyfried's single-file data show a larger spacing slope. The definitions, settings and populations differ. The guide's §17 gives the equations and transfer limits. [Lecture-theatre study](https://publications.iafss.org/publications/fss/10/599/view), [headway study](https://arxiv.org/pdf/0908.3118), [single-file study](https://arxiv.org/pdf/physics/0506170).

A defensible next calibration would compare row trajectories, aisle discharge curves and group separation against observations, then validate on separate data. Simply reducing response delays, deleting group waiting, shrinking bodies or raising door flow until the target passes is not justified. No calibration setting from this audit replaces Mateus's defaults or the primary confirmed configurations.
`;
writeFileSync('docs/research-180/MODEL_AUDIT.md',text);
writeFileSync(root+'calibration-summary.json',JSON.stringify({bestA:best.id,stats:best.stats,paired:delta,primaryConfigurationChanged:false},null,2));
console.log('Calibration audit written:',best.id,best.stats.mean,'s');
