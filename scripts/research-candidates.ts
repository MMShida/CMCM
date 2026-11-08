/** Build follow-up tests without using held-out results for candidate selection. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Case } from './research-study';
import type { GuidanceSign, SimConfig } from '../src/simulation/Params';
import { defaultConfig } from '../src/simulation/Params';
import { BAILEY_HALL, slotId } from '../src/geometry/BaileyHall';
const rows=JSON.parse(readFileSync('results/research-180/screen.json','utf8')).results;
const best=(model:string)=>rows.filter((r:any)=>r.model===model&&r.scope==='primary'&&r.stats.failures===0).sort((a:any,b:any)=>a.stats.mean-b.stats.mean)[0];
const a=best('A'),b=best('B');
const cases:Case[]=[];
let models:('A'|'B')[]=['A','B'];
function add(id:string,base:SimConfig,patch:(c:SimConfig)=>void,scope='primary') { const c=structuredClone(base);patch(c);cases.push({id,cfg:c,scope,models:[...models]}); }
const signs:GuidanceSign[]=[
  {id:'SW',x:-8,y:-7.6,floor:1,facingDegrees:90,exit:'STAGE_W'},
  {id:'SE',x:8,y:-7.6,floor:1,facingDegrees:90,exit:'STAGE_E'},
  {id:'PW1',x:-5.1,y:2.9,floor:1,facingDegrees:270,exit:'PORTICO_W'},
  {id:'PE1',x:5.1,y:2.9,floor:1,facingDegrees:270,exit:'PORTICO_E'},
  {id:'FW',x:-4.9,y:12.4,floor:1,facingDegrees:270,exit:'FOYER'},
  {id:'FE',x:4.9,y:12.4,floor:1,facingDegrees:270,exit:'FOYER'},
  {id:'PW2',x:-16.5,y:8,floor:1,facingDegrees:270,exit:'PORTICO_W'},
  {id:'PE2',x:16.5,y:8,floor:1,facingDegrees:270,exit:'PORTICO_E'},
  {id:'BNW',x:-18.4,y:2.85,floor:2,facingDegrees:270,exit:'BAL_NW'},
  {id:'BNE',x:18.4,y:2.85,floor:2,facingDegrees:270,exit:'BAL_NE'},
  {id:'BSW',x:-11.6,y:13.8,floor:2,facingDegrees:270,exit:'FOYER'},
  {id:'BSE',x:11.6,y:13.8,floor:2,facingDegrees:270,exit:'FOYER'},
];
for(const r of [a,b]) {
  models=[r.model];
  const id=`best${r.model}`;
  add(id,r.cfg,()=>{});
  for(const groupPlan of [false,true]) for(const placement of ['existing','coverage','coverage10'] as const)
    add(`${id}-groups${groupPlan}-${placement}`,r.cfg,c=>{c.crowdManagers.groupPlan=groupPlan;c.crowdManagers.placement=placement;c.crowdManagers.count=placement==='coverage'?6:10;});
  for(const placement of ['existing','decision','bottleneck','hybrid222','robust','coverage','coverage10'] as const)
    for(const mode of ['fixed','managers','both'] as const) {
      add(`${id}-${placement}-${mode}`,r.cfg,c=>{
        c.crowdManagers.placement=placement;c.crowdManagers.count=placement==='coverage10'?10:6;
        c.adaptive.agents=mode==='both';c.adaptive.managers=mode!=='fixed';
      });
    }
  for(const channels of ['none','cm6','cm10','led','pre','cm-led','cm-pre','led-pre'])
    add(`${id}-${channels}`,r.cfg,c=>{
      c.crowdManagers.count=channels.includes('cm')?(channels==='cm6'?6:10):0;
      c.led.enabled=channels.includes('led');c.preassign.enabled=channels.includes('pre');
    });
  for(const range of [12,24])for(const occlusion of [true,false])
    add(`${id}-signs${range}-${occlusion?'walls':'clear'}`,r.cfg,c=>{c.led.spatial={range,halfAngleDegrees:75,occlusion,signs};});
  add(`${id}-vacated-rows`,r.cfg,c=>{c.crowdManagers.vacatedRowGuidance=true;},'route-assumption sensitivity (A only)');
  for(const slots of [['W0'],['E0'],['W1'],['E1'],['W2'],['E2'],['W0','E1'],['W1','E0'],['W1','E2'],['W2','E1'],['W0','E0','W2','E2']])
    for(const type of ['hard-panel','soft-rope'] as const)
      add(`${id}-${slots.join('-')}-${type}`,r.cfg,c=>{c.barriers=slots.map(s=>slotId(BAILEY_HALL,s));c.barrierTypes=Object.fromEntries(c.barriers.map(x=>[x,type]));c.ropePenalty=15;});
}
for(const minTime of [0,30,60])for(const margin of [15,30]) {
  const c=defaultConfig();c.adaptive.agents=c.adaptive.managers=true;c.adaptive.redirectMode='partial';c.adaptive.redirectMargin=margin;c.adaptive.redirectNoNewStage=true;c.adaptive.redirectMinTime=minTime;c.numerics={conserveService:true};
  cases.push({id:`guarded-partial-m${margin}-t${minTime}`,cfg:c,scope:'primary'});
}
writeFileSync('results/research-180/followup-cases.json',JSON.stringify(cases,null,2));
writeFileSync('results/research-180/start-A-config.json',JSON.stringify(a.cfg,null,2));
writeFileSync('results/research-180/start-A-plan.json',JSON.stringify({plan:a.cfg.crowdManagers.plan},null,2));
writeFileSync('results/research-180/start-B-config.json',JSON.stringify(b.cfg,null,2));
writeFileSync('results/research-180/start-B-plan.json',JSON.stringify({plan:b.cfg.crowdManagers.plan},null,2));
console.log({screenA:a.id,meanA:a.stats.mean,screenB:b.id,meanB:b.stats.mean,cases:cases.length});
