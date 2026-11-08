/** Existing Model B options only; diagnostic sensitivities, not new calibrated physics. */
import { readFileSync, writeFileSync } from 'node:fs';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { NetworkSimulation } from '../src/network/NetworkSimulation';
import { batchSeeds, toRunSummary } from '../src/simulation/MonteCarlo';
import { describe, snapshotSource, hashTree } from './research-study';
const arg=(k:string,d:string)=>process.argv.includes(`--${k}`)?process.argv[process.argv.indexOf(`--${k}`)+1]:d;
const root='results/research-180/',id=arg('id','visible-B');
const cases=JSON.parse(readFileSync(root+(id==='refined-A'?'refinement-confirmation-cases.json':'confirmation-cases.json'),'utf8'));
const cfg=cases.find((c:any)=>c.id===id).cfg,seeds=batchSeeds(9001,12),results:any[]=[];
const out=root+`network-audit-${id}.json`;snapshotSource(out.replace('.json','-source.json'));
const variants=[
  {id:'inherited',opt:{dt:.25,storageRelief:30,densitySpeed:false}},
  {id:'density-slowing',opt:{dt:.25,storageRelief:30,densitySpeed:true}},
  {id:'no-storage-relief',opt:{dt:.25,storageRelief:1e9,densitySpeed:false}},
  {id:'density-and-no-relief',opt:{dt:.25,storageRelief:1e9,densitySpeed:true}},
];
for(const v of variants){
 const runs=seeds.map(seed=>{const s=new NetworkSimulation(BAILEY_HALL,cfg,seed,v.opt);s.run();return toRunSummary(s.result());});
 const stats=describe(runs);results.push({id:v.id,plan:id,model:'B',cfg,options:v.opt,scope:'network assumption diagnostic',runs,stats});
 writeFileSync(out,JSON.stringify({sourceHash:hashTree('src'),seeds,results},null,1));
 console.log(id,v.id,stats.mean,stats.failures,'incomplete',stats.inside180,'inside180');
}
