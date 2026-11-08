/** Replay every published confirmation run against current code, without fitting parameters.
 * node --import tsx scripts/verify-published-study.ts [--workers 4]
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {SimPool} from './pool';
import {hashTree} from './research-study';

const paths=['results/research-180/confirmation.json.gz','results/research-180/refinement-confirmation.json.gz','results/lite-study/confirmation.json.gz'];
const wi=process.argv.indexOf('--workers');
const pool=new SimPool(wi<0?4:Number(process.argv[wi+1]));
const output='results/placement-study/reproduction-audit.json';
mkdirSync('results/placement-study',{recursive:true});
const report:any={sourceHash:hashTree('src'),geometryHash:createHash('sha256').update(readFileSync('src/data/geometry/bailey-hall.json')).digest('hex'),date:new Date().toISOString(),rows:[]};
// Runtime is machine-dependent; all numerical/public result fields must reproduce.
const clean=(x:any):any=>Array.isArray(x)?x.map(clean):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['runtimeMs','wallTimeMs','lite'].includes(k)).map(([k,v])=>[k,clean(v)])):x;
try {
 for(const path of paths){
  const data=JSON.parse(gunzipSync(readFileSync(path)).toString());
  for(const row of data.results){
   const runs=await pool.run(row.cfg,data.seeds,row.model);
   const mismatches=runs.flatMap((r,i)=>{
    const old=row.runs[i],a=clean(r),b=clean(old);
    const keys=Object.keys(b).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));
    return keys.length?[{seed:r.seed,keys,expected:old.tEvac,actual:r.tEvac}]:[];
   });
   const item={archive:path,id:row.id,model:row.model,runs:runs.length,mismatches,values:runs.map(r=>({seed:r.seed,tEvac:r.tEvac,tSafe:r.tSafe,N:r.N,allLeftBuilding:r.allLeftBuilding,unresolvedInside:r.unresolvedInside})),mean:runs.every(r=>r.allLeftBuilding&&Number.isFinite(r.tEvac))?runs.reduce((s,r)=>s+r.tEvac,0)/runs.length:null};
   report.rows.push(item);writeFileSync(output,JSON.stringify(report,null,2));
   console.log(`${row.model} ${row.id}: ${runs.length} runs, ${mismatches.length} differing records, mean=${item.mean}`);
  }
 }
 report.passed=report.rows.every((r:any)=>r.mismatches.length===0);
 writeFileSync(output,JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
} finally {await pool.close();}
