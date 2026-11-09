/** Final bounded operational follow-up; physical calibration is never optimized. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import type {SimConfig} from '../src/simulation/Params';
import type {ExitGroupId} from '../src/geometry/types';
import {createPopulation} from '../src/simulation/Population';
import {seatPlanKeys,expandPlan,planBlocks} from '../src/simulation/Plan';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {SimPool} from './pool';
import {hashTree,snapshotSource} from './research-study';
import {auditPlus} from './plus-physical-check';
const root='results/plus-study';
const save=(name:string,x:unknown)=>writeFileSync(`${root}/${name}.json`,JSON.stringify(x,null,1));
const load=(name:string)=>JSON.parse(readFileSync(`${root}/${name}.json`,'utf8'));
const count=(name:string)=>{try{return load(name).cases.length;}catch{return 0;}};
const protocol={frozenAt:new Date().toISOString(),
 reason:'The additional-staff placements inherited messages optimized for six managers. Test a bounded operational retuning without altering calibration, devices or staffing.',
 baseline:'staff-expanded-config: selected using staff validation only',
 search:{base:73501,runs:8,sidePatterns:4,tailBlocks:8,sweeps:1,minGainSeconds:1},
 validation:{base:73502,runs:20,candidates:['inherited','best-side-pattern','coordinate-refinement']},
 confirmation:{base:73503,runs:100},fine:{base:73503,runs:100,dt:.0125},
 robustness:{base:73504,runs:12,closures:['F3','FC2','D3'],withAndWithoutBarriers:true},
 audit:{base:73507,runs:2,conditions:['open','FC2']},
 selection:'Lowest complete validation mean. Freeze before opening new holdout; retain inherited policy as a candidate. Stop after this one search, regardless of 180 s.',
 scope:'Only staff/pre-announcement seat-block destinations. Four coherent side-zone patterns compare foyer/own-side portico, then eight most frequent non-side tail blocks each test own-side exits once. Public sign messages, physical calibration and all devices remain fixed.'};
save('guidance-refinement-protocol',protocol);
// Share the four-worker allocation with reference confirmation and supplement.
while(count('confirmation')!==3||!existsSync(`${root}/staff-expanded-config.json`))await new Promise(r=>setTimeout(r,1000));
const base=load('staff-expanded-config') as SimConfig,sourceHash=hashTree('src');
snapshotSource(`${root}/guidance-refinement-source.json`);
type Case={id:string;cfg:SimConfig;runs?:any[];stats?:any};
const pool=new SimPool(4),records:Case[]=[],seeds=batchSeeds(73501,8);
function complete(c:Case){return c.runs!.every(r=>r.allLeftBuilding&&r.unresolvedInside===0&&Number.isFinite(r.tEvac));}
function rank(cs:Case[]){return cs.filter(complete).sort((a,b)=>a.stats.mean-b.stats.mean);}
function withPlan(plan:Record<string,ExitGroupId>){const c=structuredClone(base);c.crowdManagers.plan={...plan};c.preassign.plan={...plan};return c;}
async function train(id:string,cfg:SimConfig){const runs=await pool.run(cfg,seeds,'Plus');const c={id,cfg,runs,stats:summarize(runs.map(r=>r.tEvac))};records.push(c);save('guidance-refinement-search',{sourceHash,seeds,cases:records});console.log('guidance training',id,complete(c)?c.stats.mean:'unresolved');return c;}
async function batch(name:string,cs:Case[],seed:number,n:number){const out:Case[]=[],audiences=batchSeeds(seed,n);for(const c of cs){const runs=await pool.run(c.cfg,audiences,'Plus');out.push({...c,runs,stats:summarize(runs.map(r=>r.tEvac))});save(name,{sourceHash,seeds:audiences,cases:out});console.log(name,c.id,complete(out.at(-1)!)?out.at(-1)!.stats.mean:'unresolved');}return out;}
let selected:Case;
try{
 const inherited=await train('inherited',structuredClone(base)),plan=expandPlan(base.crowdManagers.plan,geo);
 const patterns:Case[]=[];
 for(const west of ['FOYER','PORTICO_W'] as const)for(const east of ['FOYER','PORTICO_E'] as const){const p={...plan};for(const k of Object.keys(p)){if(k.startsWith('ORCH_SIDE_W:'))p[k]=west;if(k.startsWith('ORCH_SIDE_E:'))p[k]=east;}patterns.push(await train(`sides-${west}-${east}`,withPlan(p)));}
 const pattern=rank(patterns)[0]??inherited;let current=rank([inherited,...patterns])[0];if(!current)throw Error('No complete starting guidance policy');
 const counts=new Map<string,number>();for(const run of current.runs!){const pop=createPopulation(geo,current.cfg,run.seed);for(const a of run.plus.tail){const key=seatPlanKeys(geo,pop.agents[a.id].seat)[0];if(!key.startsWith('ORCH_SIDE_'))counts.set(key,(counts.get(key)??0)+1);}}
 const blocks=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,8).map(x=>x[0]);
 save('guidance-refinement-blocks',{frozenAt:new Date().toISOString(),startingPolicy:current.id,blocks,counts:[...counts],trainingOnly:true});
 const levels=new Map(geo.zones.map(z=>[z.id,z.level]));
 for(const block of blocks){const p=expandPlan(current.cfg.crowdManagers.plan,geo),west=block.split(':')[1]==='W';const choices:ExitGroupId[]=levels.get(block.split(':')[0])==='balcony'?['FOYER',west?'BAL_NW':'BAL_NE']:['FOYER',west?'PORTICO_W':'PORTICO_E',west?'STAGE_W':'STAGE_E'];
  const trials:Case[]=[];for(const dest of choices.filter(g=>g!==p[block]))trials.push(await train(`${block}-to-${dest}`,withPlan({...p,[block]:dest})));
  const best=rank(trials)[0];if(best&&best.stats.mean<current.stats.mean-1)current=best;
 }
 const validation=await batch('guidance-refinement-validation',[{id:'inherited',cfg:base},{id:'best-side-pattern',cfg:pattern.cfg},{id:'coordinate-refinement',cfg:current.cfg}],73502,20);
 const best=rank(validation)[0];if(!best)throw Error('All guidance validation policies failed');selected={id:'refined-guidance',cfg:structuredClone(best.cfg)};
 save('guidance-refinement-selection',{frozenAt:new Date().toISOString(),validationId:best.id,...selected});save('guidance-refined-config',selected.cfg);
 await batch('guidance-refinement-confirmation',[selected],73503,100);
 const fine=structuredClone(selected.cfg);fine.movement.dt=.0125;save('guidance-refined-fine-config',fine);
 await batch('guidance-refinement-fine',[{id:'refined-guidance-fine',cfg:fine}],73503,100);
 const closureCases:Case[]=[];for(const link of ['F3','FC2','D3']){const c=structuredClone(selected.cfg);c.blocked.links=[link];c.blocked.knowledge='discovery';closureCases.push({id:`refined-${link}`,cfg:c});const no=structuredClone(c);no.plus!.barriers=[];closureCases.push({id:`refined-${link}-without-barriers`,cfg:no});}
 await batch('guidance-refinement-robustness',closureCases,73504,12);
}finally{await pool.close();}
const closed=structuredClone(selected!);closed.id='refined-FC2';closed.cfg.blocked.links=['FC2'];closed.cfg.blocked.knowledge='discovery';
const auditSeeds=batchSeeds(73507,2),audits=[];for(const c of [selected!,closed])for(const seed of auditSeeds){audits.push(auditPlus(c,seed));save('guidance-refinement-audit',{sourceHash,seeds:auditSeeds,records:audits});}
save('guidance-refinement-complete',{completedAt:new Date().toISOString(),sourceHash});
