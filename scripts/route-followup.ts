/** Operational search only. All movement, population and compliance parameters stay fixed. */
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {placementCases,assertSix} from './placement-cases';
import {hashTree} from './research-study';

const dir='results/route-study';mkdirSync(dir,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const save=(name:string,x:unknown)=>writeFileSync(`${dir}/${name}.json`,JSON.stringify(x,null,1));
async function batch(name:string,cases:any[],runs:number,seed:number){
 save(`${name}-cases`,cases);
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','scripts/lite-study.ts','--cases',`${dir}/${name}-cases.json`,'--out',`${dir}/${name}.json`,'--runs',String(runs),'--seed',String(seed),'--workers','4'],{stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${name}: exit ${code}`)));
 });
 return read(`${dir}/${name}.json`).results;
}
while(!existsSync(`${dir}/opt-Lite.json`))await new Promise(r=>setTimeout(r,1000));
const opt=read(`${dir}/opt-Lite.json`);
const screen=placementCases().map(c=>{
 c.id=`route-${c.id}`;
 c.cfg.crowdManagers.plan={...opt.plan};c.cfg.preassign.plan={...opt.plan};c.cfg.led.plan={...opt.plan};
 c.cfg.label=`Optimized block instructions; ${c.cfg.label}`;assertSix(c.cfg);return c;
});
const screened=await batch('screen',screen,8,62006);
const rank=(xs:any[])=>xs.filter(x=>!x.stats.failures).sort((a,b)=>a.stats.mean-b.stats.mean);
const ranked=rank(screened),shortlist:any[]=[];
const add=(c:any)=>{if(!shortlist.some(x=>x.id===c.id))shortlist.push({id:c.id,cfg:c.cfg,models:['Lite'],scope:'intervention',placement:c.placement,led:c.led,barrier:c.barrier});};
ranked.slice(0,4).forEach(add);
ranked.filter(c=>c.led!=='none'&&c.barrier!=='none').slice(0,6).forEach(add);
add({id:'previous-combined',cfg:read('results/placement-study/combined-config.json'),placement:'coverage',led:'decision',barrier:'rope1'});
const validated=await batch('validation',shortlist,24,62007);
const selected=rank(validated).find(c=>c.led!=='none'&&c.barrier!=='none');
if(!selected)throw Error('No complete combined intervention');
const cfg=selected.cfg;cfg.label='Selected six-manager block-plan study: '+selected.id;assertSix(cfg);
save('selected-config',cfg);
save('selection',{frozenAt:new Date().toISOString(),sourceHash:hashTree('src'),rule:'Lowest complete 24-audience validation mean among prescreened configurations with physical LEDs and barriers; no holdout inspected',trainingBase:62006,validationBase:62007,confirmationBase:62106,selectedId:selected.id,validationMean:selected.stats.mean,screenCases:screen.length,shortlist:shortlist.map(c=>c.id)});
const reference=read('results/placement-study/combined-config.json');
const confirmation=[{id:'selected',models:['Lite','A','B'],scope:'intervention',cfg},{id:'previous-combined',models:['Lite'],scope:'intervention',cfg:reference}];
await batch('confirmation',confirmation,60,62106);
const variants:any[]=[];
for(const [id,modify] of [
 ['selected',(c:any)=>{}],
 ['no-led',(c:any)=>{c.led.enabled=false;}],
 ['no-barriers',(c:any)=>{c.barriers=[];c.barrierTypes={};}],
 ['neither',(c:any)=>{c.led.enabled=false;c.barriers=[];c.barrierTypes={};}],
 ['blocked-F3',(c:any)=>{c.blocked.links=['F3'];c.blocked.knowledge='discovery';}],
 ['blocked-FC2',(c:any)=>{c.blocked.links=['FC2'];c.blocked.knowledge='discovery';}],
 ['blocked-D3',(c:any)=>{c.blocked.links=['D3'];c.blocked.knowledge='discovery';}],
 ['short-visibility',(c:any)=>{c.led.spatial.range=6;}],
 ['group-message',(c:any)=>{c.crowdManagers.groupPlan=true;}],
] as const){const c=structuredClone(cfg);modify(c);variants.push({id,cfg:c,models:['Lite'],scope:'diagnostic'});}
await batch('robustness',variants,20,62206);
console.log('Route study complete; confirmation was not used for selection.');
