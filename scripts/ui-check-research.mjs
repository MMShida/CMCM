/** Verify real browser loaders, live endpoints and browser worker parity against archived runs. */
import puppeteer from 'puppeteer-core';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const placementsOnly=process.argv.includes('--placements-only');
const base='http://127.0.0.1:5180/',report=JSON.parse(readFileSync(placementsOnly?'public/results/placement-study.json':'public/results/research-180-summary.json'));
const tab=m=>m==='A'?'live':m==='Lite'?'lite':'net';
const out='results/placement-study/'+(placementsOnly?'browser-placements':'browser-verification')+'.json';mkdirSync('results/placement-study',{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,pipe:true,protocolTimeout:300000});
const page=await browser.newPage();page.setDefaultTimeout(180000);const errors=[],checks=[];
page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
try {
 await page.goto(base+'?tab=research',{waitUntil:'networkidle0'});
 console.log('Study loaded');await page.waitForSelector(`[data-study-id="${placementsOnly?'combined-six':'refined-A'}"][data-model="A"]`);
 await page.$$eval('details',xs=>xs.forEach(d=>d.open=true));
 for(const [id,model] of placementsOnly?[['combined-six','A'],['combined-six','Lite'],['combined-six','B']]:[['mateus-fixed','A'],['refined-A','A'],['selected-B','B']]){
  const row=report.rows.find(r=>r.id===id&&r.model===model),first=row.times[0];
  await page.goto(base+'?tab=research',{waitUntil:'networkidle0'});await page.waitForSelector(`[data-study-id="${id}"][data-model="${model}"]`);
  await page.$$eval('details',xs=>xs.forEach(d=>d.open=true));
  await page.$eval(`[data-study-id="${id}"][data-model="${model}"]`,el=>[...el.querySelectorAll('button')].find(b=>b.textContent.startsWith('Replay first audience')).click());
  await page.waitForFunction(({model,seed})=>JSON.parse(localStorage.getItem('bailey.tab'))===(model==='A'?'live':model==='Lite'?'lite':'net')&&JSON.parse(localStorage.getItem('bailey.config')).seed===seed,{}, {model,seed:first.seed});
  const cfg=await page.evaluate(()=>JSON.parse(localStorage.getItem('bailey.config')));
  if(JSON.stringify(cfg)!==JSON.stringify({...row.cfg,seed:first.seed}))throw Error('Loader changed configuration');
  await page.goto(base+`?tab=${tab(model)}&autostart=1&until=900`,{waitUntil:'networkidle0',timeout:300000});
  const tiles=await page.$$eval('.tile',xs=>xs.map(x=>({label:x.querySelector('.tile-label')?.textContent,value:x.querySelector('.tile-value')?.textContent})));
  const t=tiles.find(x=>/Evacuation time|Last person out/i.test(x.label??''));
  if(!t||Math.abs(parseFloat(t.value)-first.tEvac)>.051)throw Error(`${model}/${id} live mismatch ${JSON.stringify(tiles)} vs ${first.tEvac}`);
  console.log('Live parity',id,model,first.tEvac);checks.push({id,model,seed:first.seed,expected:first.tEvac,display:t.value,configExact:true});
 }
 // Exercise actual browser worker pool, not a Node surrogate. This is also the UI batch code path.
 const row=report.rows.find(r=>r.id===(placementsOnly?'combined-six':'refined-A')&&r.model===(placementsOnly?'Lite':'A'));
 console.log('Starting browser batch replay');const values=await page.evaluate(async cfg=>{
  const {runBatchInWorkers}=await import('/src/simulation/WorkerPool.ts');
  const {batchStats}=await import('/src/simulation/MonteCarlo.ts');
  const runs=await runBatchInWorkers(cfg.cfg,cfg.times.map(x=>x.seed),()=>{},undefined,cfg.model).promise;
  return {mean:batchStats('replay',runs).tEvac.mean,runs:runs.map(r=>({seed:r.seed,tEvac:r.tEvac}))};
 },row);
 if(Math.abs(values.mean-row.stats.mean)>1e-9||values.runs.some((r,i)=>r.tEvac!==row.times[i].tEvac))throw Error('Browser worker batch differs from archive');
 checks.push({id:row.id,model:row.model,browserWorkerRuns:row.times.length,mean:values.mean,exact:true});
 for(const stem of ['MODEL_GUIDE','RESULTS_AND_CHANGES','SIMPLIFICATION_AUDIT']){
  const ok=await page.evaluate(async stem=>{const r=await fetch('/docs/research-180/'+stem+'.pdf');return r.ok&&(await r.arrayBuffer()).byteLength>10000;},stem);if(!ok)throw Error('Missing PDF '+stem);
 }
 if(errors.length)throw Error(errors.join('\n'));
 writeFileSync(out,JSON.stringify({date:new Date().toISOString(),url:base,checks,errors},null,2));console.log(JSON.stringify(checks,null,2));
}finally{await browser.close();}
