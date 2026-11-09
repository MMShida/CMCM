/** Real browser policy loading, live endpoints and worker parity against completed archives. */
import puppeteer from 'puppeteer-core';
import {readFileSync,writeFileSync} from 'node:fs';
const report=JSON.parse(readFileSync('public/results/plus-study.json','utf8'));
if(!['complete','finalized'].includes(report.status))throw Error('Complete the independent experiments first.');
const base='http://127.0.0.1:5180/',checks=[],errors=[];
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,pipe:true,protocolTimeout:600000});
const page=await browser.newPage();page.setDefaultTimeout(300000);page.on('pageerror',e=>errors.push(e.message));
const open=async()=>{await page.goto(base+'?tab=plus',{waitUntil:'networkidle0'});await page.waitForSelector('[data-plus-result="selected"]');await page.$$eval('details',ds=>ds.forEach(d=>d.open=true));};
const button=async(id,text)=>page.$eval(`[data-plus-result="${id}"]`,(row,text)=>{const b=[...row.querySelectorAll('button')].find(b=>b.textContent===text);if(!b)throw Error('Missing '+text);b.click();},text);
try{
 for(const id of ['selected','six-manager-1.4-fine','expanded-staff-1.4-fine','refined-guidance-fine'].filter(id=>report.rows.some(r=>r.id===id))){
  const row=report.rows.find(r=>r.id===id);if(!row)throw Error('Missing '+id);
  await open();await button(id,'Prepare 100-run reproduction');
  await page.waitForFunction(base=>JSON.parse(localStorage.getItem('bailey.config')).seed===base,{},row.seedBase);
  const prepared=await page.evaluate(()=>({cfg:JSON.parse(localStorage.getItem('bailey.config')),count:Number(document.querySelector('input[aria-label="Plus comparison replications"]').value)}));
  if(prepared.count!==100||JSON.stringify(prepared.cfg)!==JSON.stringify({...row.cfg,seed:row.seedBase}))throw Error('Incorrect reproduction settings '+id);
  checks.push({id,prepare100Exact:true,seedBase:row.seedBase});
  await button(id,'Replay first seed');await page.waitForFunction(seed=>JSON.parse(localStorage.getItem('bailey.config')).seed===seed,{},row.times[0].seed);
  const cfg=await page.evaluate(()=>JSON.parse(localStorage.getItem('bailey.config')));
  if(JSON.stringify(cfg)!==JSON.stringify({...row.cfg,seed:row.times[0].seed}))throw Error('Policy loader changed '+id);
  await page.waitForFunction(id=>document.querySelector('[data-plus-loaded]')?.getAttribute('data-plus-loaded')===id,{},id);
  await page.goto(base+'?tab=plus&autostart=1&until=900',{waitUntil:'networkidle0',timeout:600000});
  const tiles=await page.$$eval('.tile',xs=>xs.map(x=>({label:x.querySelector('.tile-label')?.textContent,value:x.querySelector('.tile-value')?.textContent})));
  const tile=tiles.find(x=>/Evacuation time|Last person out/i.test(x.label??''));
  const expected=row.times[0].tEvac,shown=parseFloat(tile?.value??'');
  if(!tile||(expected==null?tile.value!=='not completed':!Number.isFinite(shown)||Math.abs(shown-expected)>.051))throw Error('Live result differs '+id+': '+JSON.stringify(tiles));
  checks.push({id,liveSeed:row.times[0].seed,expected:row.times[0].tEvac,display:tile.value,configExact:true});console.log('Live and loader parity',id,row.times[0].tEvac);
 }
 const row=report.rows.find(r=>r.id==='refined-guidance-fine')??report.rows.find(r=>r.id==='selected'),sample=row.times.slice(0,2);
 const runs=await page.evaluate(async ({cfg,seeds})=>{
  const {runBatchInWorkers}=await import('/src/simulation/WorkerPool.ts');
  return (await runBatchInWorkers(cfg,seeds,()=>{},undefined,'Plus').promise).map(r=>({seed:r.seed,tEvac:Number.isFinite(r.tEvac)?r.tEvac:null,N:r.N,allLeftBuilding:r.allLeftBuilding}));
 },{cfg:row.cfg,seeds:sample.map(r=>r.seed)});
 if(runs.some((r,i)=>r.tEvac!==sample[i].tEvac||r.N!==1329||r.allLeftBuilding!==(sample[i].tEvac!=null)))throw Error('Browser workers differ from archived Node runs');
 checks.push({id:row.id,browserWorkers:runs,exact:true});
 await open();
 await page.select('select[aria-label="A-Lite+ policy"]','staff-12-patrol20');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bailey.config')).plus.managerPatrols.length>0);
 const patrol=await page.evaluate(()=>({cfg:JSON.parse(localStorage.getItem('bailey.config')),shown:document.body.textContent.includes('Moving manager paths')}));
 if(!patrol.shown||patrol.cfg.crowdManagers.count!==12)throw Error('Patrol policy not shown');
 checks.push({patrolPolicyLoaded:true,routes:patrol.cfg.plus.managerPatrols.length});
 for(const stem of ['MODEL_GUIDE','RESULTS_AND_CHANGES','SIMPLIFICATION_AUDIT']){
  const ok=await page.evaluate(async stem=>{const r=await fetch('/docs/research-180/'+stem+'.pdf');return r.ok&&(await r.arrayBuffer()).byteLength>10000;},stem);if(!ok)throw Error('Missing PDF '+stem);
 }
 if(errors.length)throw Error(errors.join('\n'));
 writeFileSync('results/plus-study/browser-results.json',JSON.stringify({date:new Date().toISOString(),url:base,checks,errors},null,2)+'\n');
 console.log(JSON.stringify(checks,null,2));
}finally{
 const cleanup=setTimeout(()=>browser.process()?.kill('SIGKILL'),10000);cleanup.unref();
 try{await browser.close();}finally{clearTimeout(cleanup);}
}
