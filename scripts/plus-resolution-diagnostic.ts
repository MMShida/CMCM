/** A smaller-step diagnostic of frozen policies; never selects a fastest step. */
import {readFileSync,writeFileSync} from 'node:fs';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {SimPool} from './pool';
import {hashTree,snapshotSource} from './research-study';
const root='results/plus-study',load=(n:string)=>JSON.parse(readFileSync(`${root}/${n}.json`,'utf8'));
const protocol=load('resolution-diagnostic-protocol'),sourceHash=hashTree('src');
snapshotSource(`${root}/resolution-diagnostic-source.json`);
const pool=new SimPool(8),cases:any[]=[];
try{
 for(const role of protocol.roles){
  const reference=load(role.file).cases.find((c:any)=>c.id===role.reference);
  if(!reference||reference.runs.length!==100)throw Error('Missing completed numerical reference');
  const cfg=structuredClone(reference.cfg);cfg.movement.dt=protocol.dt;
  const seeds=batchSeeds(role.base,protocol.runs);
  if(JSON.stringify(seeds)!==JSON.stringify(reference.runs.slice(0,protocol.runs).map((r:any)=>r.seed)))throw Error('Diagnostic audiences differ from reference');
  const runs=await pool.run(cfg,seeds,'Plus');
  writeFileSync(`${root}/${role.id}-config.json`,JSON.stringify(cfg,null,1));
  cases.push({id:role.id,reference:role.reference,cfg,seeds,runs,stats:summarize(runs.map(r=>r.tEvac))});
  writeFileSync(`${root}/resolution-diagnostic.json`,JSON.stringify({sourceHash,cases},null,1));
  console.log(role.id,cases.at(-1).stats.mean,runs.filter(r=>!r.allLeftBuilding||r.unresolvedInside).length,'unresolved');
 }
}finally{await pool.close();}
