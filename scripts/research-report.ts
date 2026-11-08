/** Assemble the final report from recorded results; never substitutes training for confirmation. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe } from './research-study';
import { summarize } from '../src/simulation/MonteCarlo';
import { BAILEY_HALL, barrierSlots } from '../src/geometry/BaileyHall';
const slots=new Map(barrierSlots(BAILEY_HALL).map(s=>[s.id,s.label]));
const root='results/research-180/',doc='docs/research-180/';
const read=(f:string)=>JSON.parse(readFileSync(root+f,'utf8'));
if(!existsSync(root+'SIMULATIONS_COMPLETE.txt')||!existsSync(root+'REFINEMENT_COMPLETE.txt'))throw new Error('Simulation or final refinement jobs are incomplete');
const final=read('confirmation.json'),matrix=read('mateus-matrix.json');
const refined=read('refinement-selection.json').selected;
const trainingSeeds=new Set(['screen.json','followup.json','shortlist.json'].flatMap(file=>read(file).seeds));
if(final.seeds.length!==40||new Set(final.seeds).size!==40||final.seeds.some((s:number)=>trainingSeeds.has(s)))throw new Error('Confirmation audiences are not independent of training');
if(!matrix.results['B|pkg-both']||!matrix.results['A|pkg-both'])throw new Error('Original matrix is incomplete');
const labels:Record<string,string>={'mateus-fixed':'Mateus original fixed','service-fixed':'Service integration only','selected-A':refined?'Initial A finalist':'Selected for Model A','refined-A':'Selected for A after refinement','selected-B':'Selected for Model B','selected-B-no-barrier':'Selected B plan, barriers removed','visible-A':'Signs with wall occlusion, A plan','visible-B':'Signs with wall occlusion, B plan'};
const rows=[...final.results,...(refined?read('refinement-confirmation.json').results:[])].map((r:any)=>({...r,label:labels[r.id]??r.id,stats:describe(r.runs)}));
const get=(id:string,model:string)=>rows.find((r:any)=>r.id===id&&r.model===model);
const a=get(refined?'refined-A':'selected-A','A'),b=get('selected-B','B');
for(const file of ['confirmation-cases.json',...(refined?['refinement-confirmation-cases.json']:[])])for(const c of read(file))for(const m of ['A','B'])if(!get(c.id,m))throw new Error('Missing final comparison '+c.id+' '+m);
if(!a||!b||rows.some((r:any)=>r.runs.length!==40))throw new Error('Confirmation must contain 40 audiences per case/model');
const f=(x:any,d=1)=>typeof x==='number'&&Number.isFinite(x)?x.toFixed(d):'unresolved';
const interval=(r:any)=>r.stats.failures?'unresolved':`${f(r.stats.mean)} [${f(r.stats.ciLow)}, ${f(r.stats.ciHigh)}]`;
const mean=(r:any,fn:(x:any)=>number)=>r.runs.reduce((s:number,x:any)=>s+fn(x),0)/r.runs.length;
const paired=(r:any)=>{const base=get('mateus-fixed',r.model);if(r.stats.failures||base.stats.failures)return summarize([]);const by=new Map(base.runs.map((x:any)=>[x.seed,x.tEvac]));return summarize(r.runs.map((x:any)=>x.tEvac-(by.get(x.seed) as number)));};
const outcome=(r:any)=>r.stats.mean===null?'unresolved':r.stats.mean<180?'below 180 s':'above 180 s';
const conclusion=`Model A: ${f(a.stats.mean)} s (${outcome(a)}). Model B: ${f(b.stats.mean)} s (${outcome(b)}). These are separate full-house predictions, not a combined average.`;
const table=(head:string[],body:any[][])=>'| '+head.join(' | ')+' |\n|'+head.map(()=>'---').join('|')+'|\n'+body.map(r=>'| '+r.join(' | ')+' |').join('\n');
const all:any[]=[];
for(const file of ['screen.json','followup.json','placement-corrected.json','bands.json','staff-extension.json','shortlist.json','refinement-validation.json','confirmation.json','refinement-confirmation.json','calibration.json','network-audit-refined-A.json','network-audit-visible-B.json','congestion.json'])if(existsSync(root+file)){
  const data=read(file);for(const r of data.results)all.push({file,...r,stats:describe(r.runs)});
}
for(const r of Object.values(matrix.results) as any[])all.push({file:'mateus-matrix.json',id:r.key,model:r.model,cfg:r.config,runs:r.runs,stats:describe(r.runs)});
let trialRuns=0,trials=0;
for(const file of readdirSync(root).filter(x=>x.endsWith('-trials.jsonl')))for(const line of readFileSync(root+file,'utf8').trim().split('\n'))if(line){const r=JSON.parse(line);trialRuns+=r.runs.length;trials++;}
const recorded=all.reduce((s,r)=>s+r.runs.length,0)+trialRuns;
const csvRows=[['batch','case','model','runs','mean_all_person_seconds','ci_low','ci_high','unresolved_runs','p_all_out_by_180','mean_inside_at_180','source_scope'],...all.map(r=>[r.file,r.id,r.model,r.stats.n,r.stats.mean,r.stats.ciLow,r.stats.ciHigh,r.stats.failures,r.stats.p180.p,r.stats.inside180,r.scope??'inherited matrix'])];
writeFileSync(root+'ALL_COMPARISONS.csv',csvRows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
const matrixRows=all.filter(r=>r.file==='mateus-matrix.json');
if(existsSync(doc+'MATEUS_MATRIX.md')&&!existsSync(doc+'MATEUS_MATRIX_DETAILED.md'))writeFileSync(doc+'MATEUS_MATRIX_DETAILED.md','> Original detailed export: time statistics condition on completed runs. Use MATEUS_MATRIX.md for failure-aware full-house comparisons.\n\n'+readFileSync(doc+'MATEUS_MATRIX.md','utf8'));
writeFileSync(doc+'MATEUS_MATRIX.md','# Reproduced 04:20 experiment matrix\n\n40 matched audiences per row, seed base 777. Unresolved runs suppress the all-person mean. Compliance, closures, ideal information and the voice/meet-outside package are inherited sensitivity cases, excluded from the primary guidance/barrier search.\n\n'+table(['Case','Model','Mean s [95% CI]','Unresolved','Runs ≤180','Inside at 180'],matrixRows.map(r=>[r.id,r.model,interval(r),`${r.stats.failures}/40`,`${Math.round(r.stats.p180.p*40)}/40`,f(r.stats.inside180)]))+'\n');
mkdirSync('public/results',{recursive:true});
const report={date:new Date().toISOString(),baseCommit:'3e4bcf08e258e5db41b0035e307415bf129bc011',replications:40,recordedReplications:recorded,selectedIds:{A:a.id,B:b.id},conclusion,rows:rows.map(({runs,...r}:any)=>r)};
writeFileSync('public/results/research-180-summary.json',JSON.stringify(report,null,2));
writeFileSync(root+'summary.json',JSON.stringify(report,null,2));
const channels=all.filter(r=>r.file==='followup.json'&&/^best[AB]-(none|cm6|cm10|led|pre|cm-led|cm-pre|led-pre)$/.test(r.id));
const visibility=all.filter(r=>r.file==='followup.json'&&r.id.includes('-signs'));
const staffing=all.filter(r=>r.file==='staff-extension.json');
const bar=all.filter(r=>r.file==='screen.json'&&['split-fixed','split-fixed-panel1','split-fixed-rope5','split-fixed-rope15','split-fixed-rope30','portico-both','portico-both-panel1','portico-both-rope5','portico-both-rope15','portico-both-rope30'].includes(r.id)&&((r.id.startsWith('split-')&&r.model==='A')||(r.id.startsWith('portico-')&&r.model==='B')));
const one=(r:any)=>[r.id,r.model,f(r.stats.mean),f(r.stats.inside180),`${r.stats.failures}/${r.stats.n}`];
const configDescription=(r:any)=>{
  const c=r.cfg;return `**${r.label}:** ${c.crowdManagers.count} managers at ${c.crowdManagers.placement??'existing'} posts; adaptive individuals ${c.adaptive.agents?'on':'off'}, adaptive managers ${c.adaptive.managers?'on':'off'}; preassignment ${c.preassign.enabled?'on':'off'}; LEDs ${c.led.enabled?(c.led.spatial?`${c.led.spatial.signs.length} fixed signs, ${c.led.spatial.range} m catchment, occlusion ${c.led.spatial.occlusion?'on':'off'}`:'inherited abstract guidance field'):'off'}; group-consistent plan ${c.crowdManagers.groupPlan?'on':'off'}; ${c.barriers.length?c.barriers.map((id:string)=>`${slots.get(id)??id} (${c.barrierTypes?.[id]??'hard-panel'}${c.barrierTypes?.[id]==='soft-rope'?`, ${c.ropePenalty??15} perceived s`:''})`).join(', '):'no barriers'}.`;
};
const da=paired(a),db=paired(b);
const pairChange=(left:any,right:any)=>{const by=new Map(right.runs.map((x:any)=>[x.seed,x.tEvac]));return summarize(left.runs.map((x:any)=>x.tEvac-(by.get(x.seed) as number)));};
const noBarrier=get('selected-B-no-barrier','B');
const barrierDelta=noBarrier?pairChange(b,noBarrier):null;
const visibilityDelta=pairChange(get('visible-B','B'),b);
const mainRows=rows.filter((r:any)=>['mateus-fixed','service-fixed'].includes(r.id)||(r.id===a.id&&r.model==='A')||(refined&&r.id==='selected-A'&&r.model==='A')||(r.id==='selected-B'&&r.model==='B')||(r.id==='visible-A'&&r.model==='A')||(r.id==='visible-B'&&r.model==='B'));
const validation=existsSync(root+'validation.json')?read('validation.json'):null;
const diagnostics=['diagnostic-baseline.json','diagnostics.json','diagnostic-refined.json'].filter(x=>existsSync(root+x)).flatMap(x=>read(x).records);
const diagGroups=[...new Set(diagnostics.map((r:any)=>r.id))].map(id=>({id,runs:diagnostics.filter((r:any)=>r.id===id)}));
const avgDiag=(r:any,fn:(x:any)=>number)=>{const v=r.runs.map(fn);return v.every(Number.isFinite)?v.reduce((s:number,x:number)=>s+x,0)/v.length:NaN;};
const diagRows=diagGroups.map(r=>[r.id,r.runs.length,f(avgDiag(r,x=>x.A.summary.tEvac)),f(avgDiag(r,x=>x.Ahalf.summary.tEvac)),f(avgDiag(r,x=>x.B.summary.tEvac)),f(avgDiag(r,x=>x.Bhalf.summary.tEvac))]);
const cRows=diagGroups.map(r=>[r.id,r.runs.length,r.runs[0].C.pre.flowN,f(avgDiag(r,x=>x.C.imm.tStar)),f(avgDiag(r,x=>x.C.pre.tStar)),f(avgDiag(r,x=>x.C.pre.tInd)),f(avgDiag(r,x=>x.C.A.tStar)),f(avgDiag(r,x=>x.C.B.tStar))]);
const text=`# What changed after 04:20 — and did it reach 180 seconds?

**${conclusion}**

This is a continuation of Mateus's 8 November 2026, 04:20:42 EST commit **3e4bcf0**, in the isolated \`mateus-0420\` checkout. Earlier dirty work is preserved in the parent checkout. This report accompanies **MODEL_GUIDE.pdf**, which develops all model equations and research references from basic flow to the full agent model.

The target is the average, across audiences, of the last person's building-departure time. Every primary test retains **1,329 occupants, three wheelchair users, the original building, physical capacities, speeds, response distributions, group behavior, assistance and compliance probabilities**. No occupancy reduction or capacity multiplier is used to obtain the result.

Final confirmation uses **40 new audiences per configuration**, separate from screening and optimization. There are ${recorded.toLocaleString()} recorded simulation replications across the reproduced matrix, search, confirmation, calibration/congestion sensitivities and ${trials} optimizer evaluations; time-step and ideal-flow diagnostic runs are additional. Optimization is not proof of a global optimum.

## 1. Independent confirmation

${table(['Configuration','Model','Mean seconds [95% CI]','Runs ≤180','Unresolved'],mainRows.map((r:any)=>[r.label,r.model,interval(r),Math.round(r.stats.p180.p*40)+"/40",r.stats.failures+"/40"]))}

On matched audiences, selected A changes clearance by **${f(da.mean)} s [${f(da.ciLow)}, ${f(da.ciHigh)}]** relative to the original fixed policy. Selected B changes it by **${f(db.mean)} s [${f(db.ciLow)}, ${f(db.ciHigh)}]**. Negative values mean faster.

Cross-application: the selected A plan gives **${interval(get(a.id,'B'))} s in B**; the selected B plan gives **${interval(get(b.id,'A'))} s in A**. Full confirmation rows, including removing B's barriers, are in the app and CSV. Model-specific success is not automatically transferable.

The mean target and the probability of clearing every run by 180 s are different requirements. Confidence intervals represent seed variation under the assumptions; they do not measure error relative to a real Bailey evacuation. Any unresolved run makes the reported all-person mean unresolved.

## 2. What the selected guidance actually does

${configDescription(a)}

${configDescription(b)}

Instructions divide the audience into Mateus's original **44 zone/side/front-or-back blocks**. Search changes destinations on the existing routes, staff posts/count, communication options and corridor barrier slots. The plans are saved in the full configuration objects in \`confirmation-cases.json\` and \`refinement-confirmation-cases.json\` and can be loaded from the app's **180-second study** tab.

The initial search used 6 audiences, the placement/channel/barrier follow-up and coordinate descent used 4, and the shortlist used 12 common training audiences. A final A refinement started from the best 12-audience plan, then was assessed on those 12 training audiences before any reserved outcomes were consulted. It ${refined?'improved the training mean and entered separate 40-audience confirmation':'did not improve the training mean and was rejected'}. The final 40-audience sample was reserved for confirmation. Joint mirrored front-to-back plans complement the asymmetric one-block optimizer; symmetry is a candidate restriction, not an asserted property of real evacuation behavior.

${refined?`The refinement did not improve the independent A mean: ${f(a.stats.mean)} s versus ${f(get('selected-A','A').stats.mean)} s for the initial finalist. It remains the training-selected plan; both results are retained, with no further tuning on these audiences.`:''}

The optional service correction conserves fractional door/stair service after admissions. It keeps the stated rates and a one-person idle burst. It is compared separately as “Service integration only”; it is not an invented physical improvement. Legacy defaults remain unchanged.

## 3. Crowd managers versus LEDs and preassignment

The table isolates guidance channels on the selected screening plan. These are **four-audience exploratory comparisons**, not independent estimates of effect size. “CM” denotes existing staff instructions; “pre” denotes the inherited probabilistic preassignment, and “LED” the inherited abstract guidance field. The underlying plan, behavior and probabilities remain fixed within each group.

${table(['Training case','Model','Mean s','Inside at 180','Unresolved'],channels.map(one))}

Dynamic signage research supports investigating redirection, but the reported **66% final redirection in one combined sign/voice experiment** is not a universal probability of noticing or obeying a sign. This continuation labels the existing 0.9 notice and 0.7 acceptance values as assumptions; it does not raise them to make the target pass. [Galea et al., primary study](https://gala.gre.ac.uk/id/eprint/16552/).

## 3a. Additional staff: a resource comparison

The final staffing extension tests 12 and 18 proposed posts near existing walkable junctions, using the same activation-time distribution, hearing radius and acceptance probabilities. Each complete layout assigns every seating zone to a manager. These are additional personnel, not a cost-free change to the original six-manager plan. The inherited model omits staff footprint, crowd obstruction and staff evacuation: the unchanged 1,329-person population is the audience. Additional staffing must be read with this abstraction limit.

${table(['Training case','Model','Mean s','Inside at 180','Unresolved'],staffing.map(one))}

The first ten activation draws remain unchanged. Additional staff receive additional independent draws from the same distribution instead of cyclically reusing another manager's activation. Unavailable posts are honored in both engines, and the UI lists the selected layout's actual posts. These four-audience comparisons enter the training shortlist before any confirmation outcomes are available.

## 4. Visibility and barrier comparisons

${table(['Visibility case','Model','Mean s','Inside at 180','Unresolved'],visibility.map(one))}

For the selected B plan, enabling wall occlusion changes time by **${f(visibilityDelta.mean)} s [${f(visibilityDelta.ciLow)}, ${f(visibilityDelta.ciHigh)}]** on the same 40 audiences; the configuration differs only in that switch. Its mean remains **${f(get('visible-B','B').stats.mean)} s**, with ${Math.round(40*get('visible-B','B').stats.p180.p)}/40 audiences at or below 180.

The visibility variant uses 12 fixed-message signs, same-floor eligibility, a 75-degree half-angle, 12 or 24 m range and optional wall/column/panel occlusion. These dimensions are assumptions tested for sensitivity. Sign height, crowd occlusion, luminance and actual installation feasibility are not resolved. [Visibility catchment method](https://fseg.gre.ac.uk/fire/visibility_catchment_area.html).

## 4a. Panel, rope and placement comparisons

These six-audience screening rows share the plan and guidance mode within each block. The final selected configuration is subsequently retested on the untouched audiences. Penalties are in perceived seconds, not measured walking delay.

${table(['Barrier screening case','Model','Mean s','Inside at 180','Unresolved'],bar.map(one))}

${barrierDelta?`On the final 40 audiences, the selected B ropes change time by **${f(barrierDelta.mean)} s [${f(barrierDelta.ciLow)}, ${f(barrierDelta.ciHigh)}]** versus the identical plan without barriers. The interval, rather than the small mean difference alone, determines how persuasive the barrier benefit is.`:''}

Hard panels close an existing corridor slot and occlude sight. Low ropes remain traversable and add an assumed 5/15/30 s perceived routing penalty; they do not slow actual walking or increase capacity. Panel/rope/asymmetric-location comparisons are fully listed in **ALL_COMPARISONS.csv**. Early rope screening preceded the correction that applies its cost consistently when reassessing the current path; selection and confirmation rerun candidates on the final mechanism.

Diversion posts, guardrails, ropes and opaque panels are not interchangeable. Experiments report context-dependent time and density effects, including guardrails that reduce density while increasing time. This lane/network model lacks the contact-force mechanism needed to claim a post's “arch-breaking” benefit. No imported percentage speed bonus or unmodeled mesh benefit is applied. [Wang et al.](https://arxiv.org/abs/2212.01296), [Feliciani et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC7525554/), [Chen et al.](https://doi.org/10.1016/j.ssci.2022.106020).

## 5. What is driving time, and what remains uncertain?

${table(['Diagnostic on final selected plan','Model A','Model B'],[
 ['People still inside at 180 s',f(a.stats.inside180),f(b.stats.inside180)],
 ['Mean start time of the last 20 out',f(mean(a,x=>x.lastOut.meanStart)),f(mean(b,x=>x.lastOut.meanStart))],
 ['Recorded wait of the last 20 out',f(mean(a,x=>x.lastOut.meanWait)),f(mean(b,x=>x.lastOut.meanWait))],
 ['Mean speed attribute of the last 20 (m/s)',f(mean(a,x=>x.lastOut.meanSpeed),2),f(mean(b,x=>x.lastOut.meanSpeed),2)],
 ['Share of last 20 in a social group',f(100*mean(a,x=>x.lastOut.groupShare))+'%',f(100*mean(b,x=>x.lastOut.groupShare))+'%'],
 ['Original-policy excess-density exposure',f(mean(get('mateus-fixed','A'),x=>x.density.exposure.mean)),f(mean(get('mateus-fixed','B'),x=>x.density.exposure.mean))],
 ['Selected-policy excess-density exposure',f(mean(a,x=>x.density.exposure.mean)),f(mean(b,x=>x.density.exposure.mean))],
])}

Exposure integrates density above 2 persons/m² over time; its units are person·seconds/m² for each individual. This comparison level is not a safety threshold. A's faster policy has slightly more excess-density exposure than its original policy; B's has less.

**Spatial movement:** A imposes row speeds, no passing within a lane, gap acceptance, group pacing and finite space. At 1.2 m/s its inherited headway rule permits about **0.94 persons/s/lane** before other delays. The inherited rule floor(width/0.6 + 0.2) gives a 1.1 m aisle two lanes. B shares the representative lane-capacity formula but uses network queues and constant transit speed by default; its inherited storage-relief rule permits entry after 30 s of blockage. B therefore cannot establish A's target.

**Response and groups:** the maximum over 1,329 people amplifies late response and travel tails. Group readiness waiting, leader following and pacing can increase time; experiments motivate retaining group interaction. Their Bailey-specific parameters need measurements. Group-consistent messages preserve those rules. The inherited voice-alarm/meet-outside package and vacated-row routing are reported separately and excluded from the primary winner.

**Bailey:** the geometry is a reconstruction, not an as-built survey. Measured clear widths, door operation, stair routes, sightlines and whether particular posts are usable remain uncertain. Another theatre's symmetry and visible exits do not establish those properties here. Cornell's public seating figure differs from the problem specification; all primary runs deliberately retain **1,329**. [Theatre drills](https://link.springer.com/article/10.1007/s10694-018-0783-2), [Cornell venue information](https://scl.cornell.edu/get-involved/event-planning/bailey-hall/technical-information).

## 6. Numerical and ideal-flow checks

${table(['Case','Audiences','Mean A: Δt=.1','Mean A: Δt=.05','Mean B: Δt=.25','Mean B: Δt=.125'],diagRows)}

Time-step differences include interactions and discrete decision timing, not only service integration. Three diagnostic audiences per configuration are a sensitivity check, not a convergence proof. A result near 180 must be read with this limitation.

${table(['Case','Audiences','Flow N','Mean C immediate','Mean C intrinsic','Mean own-speed bound','Mean C: A starts','Mean C: B starts'],cRows)}

Model C's time-expanded flow has **1,326 ambulatory releases** and a representative travel speed. It is an ideal allocation benchmark, not a behavioral simulation of all 1,329 or a universal lower bound on every faster individual. The separate own-speed calculation includes the audience and accessibility. Missing departure times or unreachable routes now make the bound unresolved instead of silently dropping people. Building departure and assisted arrival at street level remain separate endpoints.

${existsSync(doc+'MODEL_AUDIT.md')?readFileSync(doc+'MODEL_AUDIT.md','utf8'):''}

${existsSync(doc+'CONGESTION_AUDIT.md')?readFileSync(doc+'CONGESTION_AUDIT.md','utf8'):''}

## 7. Exact changes from Mateus and verification

${table(['Files / area','Change and reason'],[
 ['QueueSystem; NetworkSimulation; SimulationEngine','Optional conservative service integration; original default retained.'],
 ['Barriers; Routing; StaticFlow; TimeExpanded','Distinguish physical panel closures from traversable rope routing cues in A, B and C.'],
 ['SignVisibility; Guidance; NetworkSimulation','Optional range/facing/occlusion eligibility with fixed public sign messages and one notice opportunity.'],
 ['Plan; Guidance; Placements','Optional consistent group messages; coverage layouts with 6, 10, 12 or 18 staff; guarded existing partial redirection.'],
 ['Routing','Optional research sensitivity for staff-guided vacated seatways; excluded from primary search.'],
 ['Comparison; TimeExpanded','Unknown starts and inaccessible destinations cannot disappear from the all-person individual bound.'],
 ['ResearchStudyView; controls; map controllers','Load recorded configurations; show rope/panel distinction, actual network staff posts and spatial signs.'],
 ['Research scripts; tests; docs','Seeded searches, raw runs/configs, source snapshots, failure-aware summaries, comparisons and both PDFs.'],
])}

**Unchanged fundamentals:** population generator, geometry data, physical flow-rate formulas, base movement law, recognition/response distributions, group waiting/cohesion, assistance and compliance probabilities. Default adaptive-off behavior reproduces stored legacy A/B results exactly.

Validation: ${validation?validation.summary:'See validation.json after final checks.'} One existing test assumed every custom placement had six posts; it was extended for the explicit ten-person layout and caught a misplaced new rear post, which was moved to the existing rear cross-aisle. All affected placement cases were rerun. This did not alter inherited post coordinates.

## 8. Reproduce and inspect

Run from **CMCM/mateus-0420**, not the older dirty parent checkout. \`npm run dev -- --port 5180 --strictPort\` serves this version. The study tab links both PDFs and loads each confirmed configuration into its matching engine.

**Confirmation:** \`node --import tsx scripts/research-study.ts --mode evaluate --cases results/research-180/confirmation-cases.json --runs 40 --seed 20261108 --out results/research-180/confirmation.json\`.

If the final A refinement was selected, its additional confirmation uses \`refinement-confirmation-cases.json\` with the same 40 untouched audience seeds and writes \`refinement-confirmation.json\`. \`research-refine-finish.mjs\` records the training-only selection rule and runs this additional comparison and its diagnostics.

**Original matrix:** \`node --import tsx scripts/adaptive-experiments.ts --runs 40 --workers 5 --out results/research-180/mateus-matrix.json --doc docs/research-180/MATEUS_MATRIX.md\`. Its defaults preserve the 04:20 behavior; the archived original run loaded the exact base simulation before these changes.

**Audit files:** \`screen.json\`, \`followup.json\`, \`placement-corrected.json\`, \`bands.json\`, \`optimise-A/B-trials.jsonl\`, \`shortlist.json\`, \`confirmation.json\` and \`ALL_COMPARISONS.csv\`. Each primary run retains its complete configuration and seed. Confirmation and diagnostics include exact source snapshots. The first broad screen used an earlier optional-feature state and is retained as search history, not final confirmation.

**Calibration audit:** \`node --import tsx scripts/research-study.ts --mode evaluate --cases results/research-180/calibration-cases.json --runs 12 --out results/research-180/calibration.json\`; run \`research-network-audit.ts --id refined-A\` and \`--id visible-B\` with the same Node/tsx invocation, then \`research-calibration-report.ts\`. These retain training seeds and do not replace confirmation.

**Regenerate documents:** \`node --import tsx scripts/research-report.ts\`, \`python3 scripts/build-research-pdfs.py\`, then \`node scripts/render-research-pdfs.mjs\` (Chrome required). Full mathematical derivations, equations and source-specific scope limits are in **MODEL_GUIDE.pdf**. The data remain available for independent review, including failures and out-of-scope inherited sensitivity cases.
`;
writeFileSync(doc+'RESULTS_AND_CHANGES.md',text);
console.log(conclusion,recorded,'recorded replications');
