/** Matched, failure-aware A/A-Lite/B experiments. Complete cfg in each case; no implicit physics changes. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {batchSeeds,summarize,wilson} from '../src/simulation/MonteCarlo';
import {SimPool,type ModelId} from './pool';
import {hashTree,snapshotSource,assertScope} from './research-study';
const arg=(k:string,d:string)=>process.argv.includes(`--${k}`)?process.argv[process.argv.indexOf(`--${k}`)+1]:d;
const cases=JSON.parse(readFileSync(arg('cases','results/mechanism-audit/ablation-cases.json'),'utf8'));
const out=arg('out','results/mechanism-audit/ablations.json'),seeds=batchSeeds(Number(arg('seed','9001')),Number(arg('runs','4')));
mkdirSync(dirname(out),{recursive:true});snapshotSource(out.replace('.json','-source.json'));
const results:any[]=[],pool=new SimPool(Number(arg('workers','3'))),metadata={sourceHash:hashTree('src'),seeds,started:new Date().toISOString()};
try{for(const c of cases){
  if(c.scope==='intervention')assertScope(c.cfg);
  for(const model of c.models as ModelId[]){
    const runs=await pool.run(c.cfg,seeds,model);const failures=runs.filter(r=>!r.allLeftBuilding||r.N!==1329||r.unresolvedInside||!Number.isFinite(r.tEvac)).length;
    const complete=runs.filter(r=>r.allLeftBuilding&&r.N===1329&&!r.unresolvedInside&&Number.isFinite(r.tEvac));
    const stat=summarize(complete.map(r=>r.tEvac));const avg=(key:string)=>runs.reduce((s,r)=>s+(r as any)[key],0)/runs.length;
    const stats={...stat,mean:failures?null:stat.mean,ciLow:failures?null:stat.ciLow,ciHigh:failures?null:stat.ciHigh,conditionalMean:stat.mean,completionConditioned:stat,median:failures?null:stat.median,p95:failures?null:stat.p95,sd:failures?null:stat.sd,n:runs.length,failures,p180:wilson(complete.filter(r=>r.tEvac<=180).length,runs.length),peakDensityMean:avg('peakDensity'),peakDensityMax:Math.max(...runs.map(r=>r.peakDensity)),exposureMean:runs.reduce((s,r)=>s+(r.density?.exposure.mean??0),0)/runs.length,highDensityPersonSeconds:avg('highDensityExposure'),regionalPeakMax:Math.max(...runs.flatMap(r=>r.density?.peak??[])),runtimeMeanMs:avg('wallTimeMs'),safeAll:summarize(runs.map(r=>r.tSafeAll??NaN)),usage:Object.fromEntries(Object.keys(runs[0].exitGroupUsage).map(k=>[k,runs.reduce((s,r)=>s+(r.exitGroupUsage[k]??0),0)/runs.length]))};
    const effectiveCfg=model==='Lite'?{...c.cfg,numerics:{...c.cfg.numerics,conserveService:true,replanMissingPath:true}}:c.cfg;
    results.push({...c,cfg:effectiveCfg,model,runs,stats});writeFileSync(out,JSON.stringify({...metadata,results},null,1));console.log(c.id,model,'mean',stats.mean?.toFixed(2),'CI',stats.ciLow?.toFixed(1),stats.ciHigh?.toFixed(1),'fail',failures,'ms',stats.runtimeMeanMs.toFixed(0));
  }
}}finally{await pool.close();}
