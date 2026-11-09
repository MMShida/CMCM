/** Prespecified second role: lowest validation mean, without requiring a device to help. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const dir='results/route-study',read=(n:string)=>JSON.parse(readFileSync(`${dir}/${n}.json`,'utf8'));
writeFileSync(`${dir}/overall-protocol.json`,JSON.stringify({declaredAt:new Date().toISOString(),rule:'Choose the lowest complete mean among the same 24-audience validation candidates, regardless of device presence; never consult confirmation outcomes',confirmationBase:62106,runs:60},null,2));
while(!existsSync(`${dir}/selection.json`))await new Promise(r=>setTimeout(r,1000));
const data=read('validation');
if(data.results.length!==read('validation-cases').length)throw Error('Incomplete validation');
const best=data.results.filter((r:any)=>!r.stats.failures).sort((a:any,b:any)=>a.stats.mean-b.stats.mean)[0];
writeFileSync(`${dir}/overall-selection.json`,JSON.stringify({frozenAt:new Date().toISOString(),selectedId:best.id,validationMean:best.stats.mean,sameAsCombined:best.id===read('selection').selectedId},null,2));
writeFileSync(`${dir}/overall-config.json`,JSON.stringify(best.cfg,null,1));
const cases=[{id:'overall-selected',cfg:best.cfg,models:['Lite','A','B'],scope:'intervention'}];
writeFileSync(`${dir}/overall-confirmation-cases.json`,JSON.stringify(cases,null,1));
await new Promise<void>((resolve,reject)=>{
 const child=spawn(process.execPath,['--import','tsx','scripts/lite-study.ts','--cases',`${dir}/overall-confirmation-cases.json`,'--out',`${dir}/overall-confirmation.json`,'--runs','60','--seed','62106','--workers','2'],{stdio:'inherit'});
 child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error(`exit ${c}`)));
});
