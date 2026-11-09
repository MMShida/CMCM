import {readFileSync,writeFileSync} from 'node:fs';
import {SimPool} from './pool';
import {hashTree} from './research-study';
const replaySourceHash=hashTree('src');
const study=JSON.parse(readFileSync('results/plus-study/screen.json','utf8')),cases=[study.cases[0],study.cases[2],study.cases[4]],pool=new SimPool(4),checks:any[]=[];
try{for(const c of cases){const fresh=await pool.run(c.cfg,c.runs.map((r:any)=>r.seed),'Plus');for(let i=0;i<fresh.length;i++)for(const key of ['tEvac','p95Exit','highDensityExposure','exitGroupUsage','unresolvedInside'])if(JSON.stringify((fresh[i] as any)[key])!==JSON.stringify(c.runs[i][key]))throw Error(`${c.id} seed ${fresh[i].seed}: ${key} differs`);checks.push({id:c.id,runs:fresh.length,exact:true});console.log(c.id,'exact');}}finally{await pool.close();}
writeFileSync(process.argv[2]??'results/plus-study/visibility-index-parity.json',JSON.stringify({oldSourceHash:study.sourceHash,newSourceHash:replaySourceHash,checks,note:'Batched simultaneous visible queue counts and indexed sightline intersection; no physical or behavioral parameter changes.'},null,2));
