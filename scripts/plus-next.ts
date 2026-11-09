/** Continue once screening is complete; select tail blocks BEFORE further optimization. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import {createPopulation} from '../src/simulation/Population';
import {SimPool} from './pool';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {snapshotSource} from './research-study';
import {seatPlanKeys} from '../src/simulation/Plan';
const root='results/plus-study';
async function command(args:string[]){await new Promise<void>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx',...args],{stdio:'inherit'});p.on('exit',n=>n===0?resolve():reject(Error(`Exit ${n}`)));});}
const protocol=JSON.parse(readFileSync(`${root}/screen-protocol.json`,'utf8'));
function ready(){try{return JSON.parse(readFileSync(`${root}/screen.json`,'utf8')).cases.length>=protocol.cases.length;}catch{return false;}}
while(!ready())await new Promise(r=>setTimeout(r,1000));
const screen=JSON.parse(readFileSync(`${root}/screen.json`,'utf8'));
const ranked=screen.cases.filter((c:any)=>c.id!=='baseline6'&&c.runs.every((r:any)=>r.unresolvedInside===0&&Number.isFinite(r.tEvac))).sort((a:any,b:any)=>a.stats.mean-b.stats.mean);
const winner=ranked[0];writeFileSync(`${root}/training-start.json`,JSON.stringify(winner.cfg,null,1));
const counts=new Map<string,number>();for(const run of winner.runs){const pop=createPopulation(geo,winner.cfg,run.seed);for(const a of run.plus.tail){const key=seatPlanKeys(geo,pop.agents[a.id].seat)[0];counts.set(key,(counts.get(key)??0)+1);}}
const blocks=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,16).map(x=>x[0]);
writeFileSync(`${root}/tail-search-protocol.json`,JSON.stringify({frozenAt:new Date().toISOString(),startingPolicy:winner.id,blocks,counts:[...counts],trainingOnly:true,objective:'Expected last-person time; physical calibration frozen',seed:73003,runs:6,sweeps:2},null,2));
snapshotSource(`${root}/opt-Plus-source.json`);
await command(['scripts/optimise-plan.ts','--model','Plus','--config',`${root}/training-start.json`,'--seeds','6','--seed','73003','--sweeps','2','--preassign','--blocks',blocks.join(','),'--min-gain','1','--workers','4','--out',`${root}/opt-Plus`]);
// Validation contains the original shortlist and the training-only optimized policy.
const opt=JSON.parse(readFileSync(`${root}/opt-Plus.json`,'utf8'));
const cfg=structuredClone(winner.cfg);cfg.crowdManagers.plan=opt.plan;cfg.preassign.plan=opt.plan;
writeFileSync(`${root}/optimized-config.json`,JSON.stringify(cfg,null,1));
await command(['scripts/plus-study.ts','validation','16']);
const validation=JSON.parse(readFileSync(`${root}/validation.json`,'utf8'));
const candidate=validation.cases.filter((x:any)=>x.id!=='baseline6'&&x.runs.every((r:any)=>r.unresolvedInside===0&&Number.isFinite(r.tEvac))).sort((a:any,b:any)=>a.stats.mean-b.stats.mean)[0];
const staffPool=new SimPool(4),staffCases:any[]=[],staffSeeds=batchSeeds(73004,16);snapshotSource(`${root}/staff-validation-source.json`);
try{for(const count of [10,12]){const cfg=structuredClone(candidate.cfg);cfg.crowdManagers.count=count;cfg.crowdManagers.placement='coverage';const runs=await staffPool.run(cfg,staffSeeds,'Plus');staffCases.push({id:`staff-${count}`,cfg,runs,stats:summarize(runs.map(r=>r.tEvac))});writeFileSync(`${root}/staff-validation.json`,JSON.stringify({seeds:staffSeeds,cases:staffCases},null,1));console.log('extra staff',count,staffCases.at(-1).stats.mean);}}finally{await staffPool.close();}
await command(['scripts/plus-study.ts','confirmation','100']);
