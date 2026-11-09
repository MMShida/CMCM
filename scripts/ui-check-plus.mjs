import puppeteer from 'puppeteer-core';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,pipe:true,protocolTimeout:300000});
const page=await browser.newPage();await (await page.createCDPSession()).send('Page.setDownloadBehavior',{behavior:'deny'});page.setDefaultTimeout(120000);await page.setViewport({width:1600,height:1100});const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const clickText=async text=>page.evaluate(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!b)throw Error('Missing '+t);b.click();},text);
try{
 await page.goto('http://127.0.0.1:5180/?tab=plus',{waitUntil:'networkidle0'});
 await clickText('Load six-manager baseline');await page.waitForSelector('select[aria-label="A-Lite+ policy"]');
 await page.select('select[aria-label="A-Lite+ policy"]','coverage-strips-partial');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bailey.config')).plus?.signs.length===12);
 await page.$$eval('details',ds=>ds.forEach(d=>d.open=true));
 const cfg=await page.evaluate(()=>JSON.parse(localStorage.getItem('bailey.config')));
 if(cfg.plus.barriers.filter(b=>b.enabled).length!==2)throw Error('Policy did not load devices');checks.push('physical policy load: 12 strips, 2 belts');
 await page.select('select[aria-label="Selected LED"]',cfg.plus.signs[0].id);
 await page.select('select[aria-label="LED exit"]','FOYER');
 await page.select('select[aria-label="LED mode"]','dynamic');
 const set=async(selector,value)=>page.$eval(selector,(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await set('input[aria-label="LED activation"]',7);
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bailey.config')).plus.signs[0].activation===7);
 let after=await page.evaluate(()=>JSON.parse(localStorage.getItem('bailey.config')));if(after.plus.signs[0].mode!=='dynamic'||after.plus.signs[0].exit!=='FOYER')throw Error('LED edit lost');checks.push('LED message, dynamic mode and activation edit');
 const slot=cfg.plus.barriers[0].slot;
 await set(`input[aria-label="Barrier length ${slot}"]`,cfg.plus.barriers[0].length+.5);
 await page.waitForFunction(()=>document.body.textContent.includes('bypass below'));
 const invalid=await page.evaluate(()=>JSON.parse(localStorage.getItem('bailey.config')));if(invalid.plus.barriers[0].length===cfg.plus.barriers[0].length+.5)throw Error('Invalid narrow bypass accepted');checks.push('invalid bypass rejected');
 await page.click(`input[aria-label="Barrier ${slot}"]`);await page.waitForFunction(slot=>!JSON.parse(localStorage.getItem('bailey.config')).plus.barriers.find(b=>b.slot===slot).enabled,{},slot);checks.push('barrier disable');
 // Exercise actual map placement using world coordinate transform of its first pane.
 await clickText('Add sign');const canvas=await page.$('canvas'),box=await canvas.boundingBox();await page.mouse.click(box.x+box.width*.25,box.y+box.height*.55);
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bailey.config')).plus.signs.length===13);checks.push('map sign placement');
 await clickText('Remove LED');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bailey.config')).plus.signs.length===12);checks.push('sign removal');
 // Draw a real strip using the map transform, then remove the temporary installation.
 const strip=cfg.plus.signs.find(s=>s.strip&&s.floor===1);
 await clickText('Draw strip');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Draw strip'&&b.classList.contains('on')));await page.$eval('canvas',el=>el.scrollIntoView({block:'center'}));
 for(const point of strip.strip.points){const xy=await page.evaluate(async ({point,floor})=>{const {fitView,worldToScreen}=await import('/src/components/MapRenderer.ts');const box=document.querySelector('canvas').getBoundingClientRect(),w=box.width/2;const p=worldToScreen(fitView(floor,w,box.height),w,box.height,...point);return [box.x+(floor===2?w:0)+p[0],box.y+p[1]];},{point,floor:strip.floor});await page.mouse.click(...xy);}
 await page.select('select[aria-label="Strip walkway"]',strip.strip.linkId);await clickText('Finish strip');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bailey.config')).plus.signs.length===13);checks.push('draw and finish floor strip on an existing walkway');
 await clickText('Remove LED');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bailey.config')).plus.signs.length===12);
 await clickText('↺ Reset');await clickText('Step');await page.waitForFunction(()=>document.body.textContent.includes('▶ Resume'));
 await clickText('▶ Resume');await page.waitForFunction(()=>document.body.textContent.includes('❚❚ Pause'));await clickText('❚❚ Pause');await clickText('↺ Reset');checks.push('live step, resume, pause and reset controls');
 // JSON export is intercepted at the Blob layer to check actual button payload.
 await page.evaluate(()=>{window.__exports=[];const old=URL.createObjectURL;URL.createObjectURL=function(blob){blob.text().then(t=>window.__exports.push(t));return old.call(this,blob);};});
 await clickText('Export layout/config');await page.waitForFunction(()=>window.__exports.length>0);
 const exported=await page.evaluate(()=>window.__exports[0]);after=await page.evaluate(()=>JSON.parse(localStorage.getItem('bailey.config')));if(JSON.stringify(JSON.parse(exported))!==JSON.stringify(after))throw Error('Export differs from UI config');checks.push('exact JSON layout export');
 writeFileSync('/private/tmp/bailey-plus-ui-import.json',exported);const input=await page.$('input[aria-label="Import A-Lite+ configuration"]');await input.uploadFile('/private/tmp/bailey-plus-ui-import.json');await page.waitForFunction(()=>document.body.textContent.includes('Configuration imported.'));checks.push('actual file import');
 const parity=await page.evaluate(async c=>{const {PlusSimulation}=await import('/src/plus/PlusSimulation.ts'),{BAILEY_HALL}=await import('/src/geometry/BaileyHall.ts');const a=new PlusSimulation(BAILEY_HALL,c),b=new PlusSimulation(BAILEY_HALL,JSON.parse(JSON.stringify(c)));for(let k=0;k<100;k++){a.step();b.step();}return {same:JSON.stringify(a.agents.map(x=>[x.link,x.sDir,x.targetGroup]))===JSON.stringify(b.agents.map(x=>[x.link,x.sDir,x.targetGroup])),N:a.agents.length,staff:a.guidance.cms.length,signs:a.cfg.plus.signs.length,barriers:a.cfg.plus.barriers.filter(b=>b.enabled).length};},after);
 if(!parity.same||parity.N!==1329||parity.staff!==6||parity.barriers!==1)throw Error('UI/engine layout mismatch');checks.push({roundTrip:parity});
 await page.screenshot({path:'/private/tmp/bailey-plus-editor.png',fullPage:false});
 if(errors.length)throw Error(errors.join('\n'));
 mkdirSync('results/plus-study',{recursive:true});writeFileSync('results/plus-study/browser-interactions.json',JSON.stringify({date:new Date().toISOString(),checks,errors},null,2));console.log(checks);
}finally{
 const cleanup=setTimeout(()=>browser.process()?.kill('SIGKILL'),10000);cleanup.unref();
 try{await browser.close();}finally{clearTimeout(cleanup);}
}
