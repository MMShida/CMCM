/** Predeclared two-stage selection: common training seeds, then untouched confirmation seeds. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defaultConfig } from '../src/simulation/Params';
import { describe, type Case } from './research-study';
const root='results/research-180/',mode=process.argv.includes('--confirm')?'confirm':'shortlist';
const read=(f:string)=>JSON.parse(readFileSync(root+f,'utf8'));
const key=(c:any)=>JSON.stringify(c,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).filter(([k,val])=>!['label','scenarioId','seed'].includes(k)&&!(k==='groupPlan'&&val===false)).sort(([a],[b])=>a.localeCompare(b))):v);
if(mode==='shortlist'){
  const staffReady=()=>{try{return read('staff-extension.json').results.length===read('staff-extension-cases.json').length;}catch{return false;}};
  while(!staffReady())await new Promise(resolve=>setTimeout(resolve,1000));
  const cases:Case[]=[],seen=new Map<string,Case>();
  const add=(id:string,cfg:any,model:'A'|'B')=>{const k=key(cfg),hit=seen.get(k);if(hit){if(!hit.models!.includes(model))hit.models!.push(model);return;}const c:Case={id,cfg,models:[model],scope:'primary'};seen.set(k,c);cases.push(c);};
  for(const file of ['screen.json','followup.json','placement-corrected.json','bands.json','staff-extension.json']){
    const data=read(file).results.filter((r:any)=>r.scope==='primary'&&r.stats.failures===0&&!(file==='followup.json'&&r.cfg.crowdManagers.placement==='coverage10'));
    for(const m of ['A','B'] as const){
      const ranked=data.filter((r:any)=>r.model===m).sort((a:any,b:any)=>a.stats.mean-b.stats.mean);
      for(const r of ranked.slice(0,2))add(`${file.split('.')[0]}-${r.id}`,r.cfg,m);
      const spatial=ranked.find((r:any)=>r.cfg.led.spatial?.occlusion===true);if(spatial)add(`visible-${m}`,spatial.cfg,m);
    }
  }
  for(const m of ['A','B'] as const){
    const r=read(`optimise-${m}.json`);add(`optimised-${m}`,r.config,m);
    if(m==='B'){const c=structuredClone(r.config);c.barriers=[];delete c.barrierTypes;add('optimised-B-no-barrier',c,m);}
  }
  writeFileSync(root+'shortlist-cases.json',JSON.stringify(cases,null,2));console.log(cases.length,'shortlisted configurations',cases.map(c=>[c.id,c.models]));
}else{
  const rows=read('shortlist.json').results.filter((r:any)=>r.stats.failures===0);
  const cases:Case[]=[{id:'mateus-fixed',cfg:defaultConfig(),scope:'primary'}];
  const c=defaultConfig();c.numerics={conserveService:true};cases.push({id:'service-fixed',cfg:c,scope:'primary'});
  const chosen:any[]=[];
  for(const m of ['A','B'] as const){
    const ranked=rows.filter((r:any)=>r.model===m).sort((a:any,b:any)=>a.stats.mean-b.stats.mean);
    const best=ranked[0],visible=ranked.find((r:any)=>r.cfg.led.spatial?.occlusion===true);
    if(!best||!visible)throw new Error(`Missing ${m} candidate or visibility comparison`);
    for(const [id,r] of [[`selected-${m}`,best],[`visible-${m}`,visible]] as const){cases.push({id,cfg:r.cfg,scope:'primary'});chosen.push({id,source:r.id,training:describe(r.runs)});}
  }
  const bestB=cases.find(x=>x.id==='selected-B')!;
  if(bestB.cfg.barriers.length){const c=structuredClone(bestB.cfg);c.barriers=[];delete c.barrierTypes;cases.push({id:'selected-B-no-barrier',cfg:c,scope:'primary'});}
  writeFileSync(root+'confirmation-cases.json',JSON.stringify(cases,null,2));
  writeFileSync(root+'selection.json',JSON.stringify({rule:'Minimum full-house training mean; occluding spatial signs selected separately; no confirmation outcomes used',chosen},null,2));
  writeFileSync(root+'diagnostic-selected-cases.json',JSON.stringify(cases.filter(x=>x.id==='selected-A'||x.id==='selected-B'),null,2));
  console.log(chosen);
}
