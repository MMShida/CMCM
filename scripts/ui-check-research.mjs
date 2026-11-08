import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const base='http://localhost:5180/',out='docs/research-180/screenshots';
const report=JSON.parse(readFileSync('public/results/research-180-summary.json','utf8'));
mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,pipe:true});
const page=await browser.newPage();await page.setViewport({width:1600,height:1050});page.setDefaultTimeout(120000);
const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
  await page.goto(base+'?tab=research&theme=light',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length>=8);
  const count=await page.$$eval('tbody tr',xs=>xs.length);if(count!==report.rows.length)throw new Error('Missing results');
  await page.screenshot({path:out+'/study.png',fullPage:true});checks.push('All confirmed results rendered');
  for(const stem of ['MODEL_GUIDE','RESULTS_AND_CHANGES','SIMPLIFICATION_AUDIT']){
    const status=await page.evaluate(async stem=>{const r=await fetch('/docs/research-180/'+stem+'.pdf');return {ok:r.ok,type:r.headers.get('content-type'),size:(await r.arrayBuffer()).byteLength};},stem);
    if(!status.ok||status.size<10000||!status.type.includes('pdf'))throw new Error('Broken PDF '+stem);checks.push(stem+' served as PDF');
  }
  for(const model of ['A','B']){
    const row=report.rows.find(r=>r.id===(report.selectedIds?.[model]??'selected-'+model)&&r.model===model);
    await page.goto(base+'?tab=research&theme=light',{waitUntil:'networkidle0'});
    await page.evaluate(({label,model})=>{const tr=[...document.querySelectorAll('tbody tr')].find(tr=>tr.children[0].textContent===label&&tr.children[1].textContent===model);if(!tr)throw new Error('Missing selected configuration');tr.querySelector('button').click();},{label:row.label,model});
    await page.waitForFunction(model=>JSON.parse(localStorage.getItem('bailey.tab'))===(model==='A'?'live':'net'),{},model);
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('bailey.config')));
    if(JSON.stringify(stored)!==JSON.stringify(row.cfg))throw new Error('Loaded configuration differs from confirmed input');
    await page.goto(base+`?tab=${model==='A'?'live':'net'}&theme=light&autostart=1&until=60&speed=50`,{waitUntil:'networkidle0',timeout:300000});
    if(!await page.$eval('.scenario-box .desc',el=>el.textContent.includes('Custom configuration loaded')))throw new Error('Loaded study mislabeled as preset');
    if(await page.$$eval('canvas',xs=>xs.filter(x=>x.width>0&&x.height>0).length)===0)throw new Error('Empty simulation canvas');
    await page.screenshot({path:out+`/selected-${model}-60s.png`,fullPage:true});checks.push(`Selected ${model}: exact configuration loaded, simulation advanced and canvas rendered`);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  writeFileSync('results/research-180/browser-validation.json',JSON.stringify({date:new Date().toISOString(),url:base,checks,errors},null,2));
  console.log(checks.join('\n'),'\nNo browser errors');
}finally{await browser.close();}
