/** Joint, mirrored orchestra assignments complement one-block coordinate descent. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Case } from './research-study';
const base=JSON.parse(readFileSync('results/research-180/start-A-config.json','utf8'));
const patterns=new Set<string>();
for(let bits=0;bits<16;bits++)patterns.add(Array.from({length:4},(_,i)=>bits&(1<<i)?'P':'F').join(''));
for(let stage=0;stage<=4;stage++)for(let portico=0;portico<=4-stage;portico++)patterns.add('S'.repeat(stage)+'P'.repeat(portico)+'F'.repeat(4-stage-portico));
const keys=[['ORCH_C_FRONT','F'],['ORCH_C_FRONT','B'],['ORCH_C_BACK','F'],['ORCH_C_BACK','B']];
const cases:Case[]=[];
for(const pattern of patterns){
  const cfg=structuredClone(base),plan=cfg.crowdManagers.plan;
  keys.forEach(([z,band],i)=>{for(const side of ['W','E'])plan[`${z}:${side}:${band}`]=pattern[i]==='F'?'FOYER':`${pattern[i]==='P'?'PORTICO':'STAGE'}_${side}`;});
  cfg.preassign.plan={...plan};cfg.led.plan={...plan};
  cases.push({id:`bands-${pattern}`,cfg,models:['A'],scope:'primary'});
}
writeFileSync('results/research-180/band-cases.json',JSON.stringify(cases,null,2));
console.log(cases.length,'joint paired plans');
