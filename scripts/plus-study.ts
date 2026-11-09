import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BAILEY_HALL as geo,slotId} from '../src/geometry/BaileyHall';
import {defaultConfig,type SimConfig} from '../src/simulation/Params';
import {plusDefaults,plusConfig} from '../src/plus/Config';
import {CALIBRATION} from '../src/plus/Calibration';
import {installationOverlay} from '../src/plus/Installations';
import {stripLayout} from './placement-cases';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {SimPool} from './pool';
import {hashTree,snapshotSource} from './research-study';
const root='results/plus-study';mkdirSync(root,{recursive:true});
const save=(name:string,v:unknown)=>writeFileSync(`${root}/${name}.json`,JSON.stringify(v,null,1));
const stage=process.argv[2]??'screen';
let base=plusConfig(defaultConfig());base.plus=plusDefaults();base.adaptive.agents=true;base.adaptive.staticPlan=true;base.crowdManagers.count=6;base.crowdManagers.groupPlan=true;base.movement.dt=.1;
const plan=JSON.parse(readFileSync('results/route-study/overall-config.json','utf8')).crowdManagers.plan;
const guided=structuredClone(base);guided.preassign.enabled=true;guided.crowdManagers.plan=plan;guided.preassign.plan=plan;guided.label='A-Lite+ six-manager guidance';
const sourceHash=hashTree('src');snapshotSource(`${root}/${stage}-${sourceHash}-source.json`);
const seedBase=stage==='screen'?73001:stage==='validation'?73002:stage==='confirmation'?73101:73201;
const count=Number(process.argv[3]??(stage==='screen'?4:stage==='validation'?12:stage==='confirmation'?100:12));
const cases:{id:string;cfg:SimConfig}[]=[];
if(stage==='screen'){
 const physical={population:base.population,movement:base.movement,premovement:base.premovement,plus:base.plus,calibration:CALIBRATION};
 const hash=createHash('sha256').update(JSON.stringify(physical)).digest('hex');
 if(existsSync(`${root}/calibration-freeze.json`)){const old=JSON.parse(readFileSync(`${root}/calibration-freeze.json`,'utf8'));const numeric=(x:any)=>JSON.stringify({population:x.population,movement:x.movement,premovement:x.premovement,plus:x.plus});if(numeric(old.physical)!==numeric(physical))throw Error('Physical calibration changed: use a new study, never overwrite the freeze');}
 else save('calibration-freeze',{frozenAt:new Date().toISOString(),hash,physical,sourceHash,geometryHash:createHash('sha256').update(JSON.stringify(geo)).digest('hex'),note:'Research-bounded assumptions, not fitted to 180 or empirically validated at Bailey. Freeze precedes operational search.'});
 cases.push({id:'baseline6',cfg:base});
 const rejected:any[]=[];
 for(const placement of ['existing','coverage','decision'] as const)for(const signs of ['none','signs','strips','dynamic'])for(const barriers of ['none','partial','rail']){
  const c=structuredClone(guided);c.crowdManagers.placement=placement;c.led.enabled=signs!=='none';
  c.plus!.signs=signs==='none'?[]:stripLayout('decision',c).map(s=>{const p=s.strip!.points,first=p[0],last=p.at(-1)!;return {...s,strip:signs==='signs'?undefined:s.strip,facingDegrees:Math.atan2(first[1]-last[1],first[0]-last[0])*180/Math.PI,enabled:true,mode:signs==='dynamic'?'dynamic' as const:'static' as const,activation:3,range:8,halfAngle:70,detection:.77,acceptance:.8};});
  if(barriers!=='none')c.plus!.barriers=['W1','E1'].map(name=>{const slot=slotId(geo,name),l=geo.links.find(l=>l.id===slot)!;return {slot,enabled:true,type:barriers==='rail'?'open-rail' as const:'belt' as const,length:barriers==='rail'?l.width:l.width-1.2,angle:90};});
  const id=`${placement}-${signs}-${barriers}`;c.label=id;
  try{installationOverlay(geo,c);cases.push({id,cfg:c});}catch(e){rejected.push({id,error:String(e)});}
 }

 // Additional physically specified locations and operational modes; same frozen calibration.
 for(const layout of ['early','corridor'])for(const device of ['signs','strips']){
  const c=structuredClone(guided);c.crowdManagers.placement='coverage';c.led.enabled=true;
  c.plus!.signs=stripLayout(layout,c).map(s=>{const a=s.strip!.points[0],b=s.strip!.points.at(-1)!;return {...s,strip:device==='signs'?undefined:s.strip,facingDegrees:Math.atan2(a[1]-b[1],a[0]-b[0])*180/Math.PI,enabled:true,mode:'static' as const,activation:3,range:8,halfAngle:70,detection:.77,acceptance:.8};});cases.push({id:`coverage-${layout}-${device}`,cfg:c});
 }
 for(const placement of ['existing','coverage','decision'] as const){const c=structuredClone(guided);c.crowdManagers.placement=placement;c.adaptive.staticPlan=false;cases.push({id:`${placement}-adaptive`,cfg:c});}
 for(const location of ['0','2'])for(const type of ['belt','open-rail'] as const){const c=structuredClone(guided);c.crowdManagers.placement='coverage';c.plus!.barriers=['W','E'].map(side=>{const slot=slotId(geo,side+location),l=geo.links.find(l=>l.id===slot)!;return {slot,enabled:true,type,length:type==='open-rail'?l.width:l.width-1.2,angle:90};});
  try{installationOverlay(geo,c);cases.push({id:`coverage-${type}-slots${location}`,cfg:c});}catch(e){rejected.push({id:`coverage-${type}-slots${location}`,error:String(e)});}
 }
 save('rejected-layouts',rejected);
}else{
 const name=stage==='validation'?'screen':stage==='confirmation'?'validation':'confirmation';
 const prev=JSON.parse(readFileSync(`${root}/${name}.json`,'utf8'));
 if(stage==='validation'){
  if(existsSync(`${root}/optimized-config.json`))cases.push({id:'optimized-guidance',cfg:JSON.parse(readFileSync(`${root}/optimized-config.json`,'utf8'))});
  const ranked=prev.cases.filter((x:any)=>x.runs.every((r:any)=>Number.isFinite(r.tEvac)&&r.unresolvedInside===0)).sort((a:any,b:any)=>a.stats.mean-b.stats.mean);
  for(const x of ranked.slice(0,5))cases.push({id:x.id,cfg:x.cfg});
  for(const filter of [(x:any)=>x.cfg.led.enabled&&x.cfg.plus.barriers.some((b:any)=>b.enabled),(x:any)=>x.cfg.led.enabled&&!x.cfg.plus.barriers.some((b:any)=>b.enabled),(x:any)=>!x.cfg.led.enabled&&x.cfg.plus.barriers.some((b:any)=>b.enabled)]){const item=ranked.find(filter);if(item&&!cases.some(c=>c.id===item.id))cases.push({id:item.id,cfg:item.cfg});}
  const baseline=prev.cases.find((x:any)=>x.id==='baseline6');if(!cases.some(c=>c.id==='baseline6'))cases.push({id:'baseline6',cfg:baseline.cfg});
 }else if(stage==='confirmation'){
  const ranked=prev.cases.filter((x:any)=>x.id!=='baseline6'&&x.runs.every((r:any)=>Number.isFinite(r.tEvac)&&r.unresolvedInside===0)).sort((a:any,b:any)=>a.stats.mean-b.stats.mean);
  if(!ranked.length)throw Error('No completed eligible policy');
  const winner=ranked[0];save('selection',{frozenAt:new Date().toISOString(),criterion:'Lowest full-house validation mean, six managers; no holdout inspected',id:winner.id,cfg:winner.cfg});
  save('selected-config',winner.cfg);cases.push({id:'selected',cfg:winner.cfg},{id:'baseline6',cfg:base});
  const combined=ranked.find((x:any)=>x.cfg.led.enabled&&x.cfg.plus.barriers.some((b:any)=>b.enabled));
  if(combined&&combined.id!==winner.id){cases.push({id:'combined6',cfg:combined.cfg});save('combined-config',combined.cfg);}
  if(existsSync(`${root}/staff-validation.json`)){const staff=JSON.parse(readFileSync(`${root}/staff-validation.json`,'utf8')).cases.filter((x:any)=>x.runs.every((r:any)=>r.unresolvedInside===0&&Number.isFinite(r.tEvac))).sort((a:any,b:any)=>a.stats.mean-b.stats.mean)[0];if(staff){cases.push({id:'extra-staff',cfg:staff.cfg});save('staff-selection',{id:staff.id,cfg:staff.cfg,frozenAt:new Date().toISOString()});}}
  save('selection-roles',{frozenAt:new Date().toISOString(),cases,note:'Roles fixed before opening any of the fresh confirmation audiences; extra staffing remains separate.'});
 }else throw Error('Unsupported stage');
}
const seeds=batchSeeds(seedBase,count);if(!process.argv.includes('--resume'))save(`${stage}-protocol`,{createdAt:new Date().toISOString(),seeds,cases,sourceHash});
const resume=process.argv.includes('--resume')&&existsSync(`${root}/${stage}.json`)?JSON.parse(readFileSync(`${root}/${stage}.json`,'utf8')):null;
const pool=new SimPool(4),out:any[]=resume?resume.cases.map((c:any)=>({...c,sourceHash:c.sourceHash??resume.sourceHash})):[];
try{for(const c of cases){if(out.some(x=>x.id===c.id))continue;const runs=await pool.run(c.cfg,seeds,'Plus'),stats=summarize(runs.map(r=>r.tEvac));out.push({...c,sourceHash,stats,runs});save(stage,{seeds,sourceHash,cases:out});console.log(c.id,stats.mean.toFixed(2),runs.filter(r=>r.unresolvedInside>0).length,'incomplete');}}finally{await pool.close();}
