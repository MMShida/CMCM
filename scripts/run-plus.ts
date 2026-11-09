/** Reproduce one audience or a matched batch using an exported A-Lite+ policy. */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {PlusSimulation} from '../src/plus/PlusSimulation';
import {batchSeeds, batchStats} from '../src/simulation/MonteCarlo';
import {SimPool} from './pool';
import {hashTree} from './research-study';

const arg=(key:string,fallback:string)=>{
  const i=process.argv.indexOf('--'+key);
  return i<0?fallback:process.argv[i+1];
};
const cfg=JSON.parse(readFileSync(arg('config','results/plus-study/selected-config.json'),'utf8'));
if(!cfg.plus)throw Error('Load an A-Lite+ configuration containing physical installations.');
const count=Number(arg('runs','1')),seed=Number(arg('seed',String(cfg.seed)));
if(!Number.isInteger(count)||count<1||!Number.isInteger(seed)||seed<0)throw Error('Use a positive run count and nonnegative integer seed.');
const out=arg('out','/tmp/bailey-plus-replay.json');
let record;
if(count===1){
  const sim=new PlusSimulation(BAILEY_HALL,cfg,seed);sim.run();
  record={model:'Plus',sourceHash:hashTree('src'),cfg:sim.cfg,seed,result:sim.result({agents:true}),diagnostics:sim.diagnostics()};
  console.log(JSON.stringify({N:record.result.N,tEvac:record.result.tEvac,allLeftBuilding:record.result.allLeftBuilding,unresolvedInside:record.result.unresolved.inside,out}));
}else{
  const seeds=batchSeeds(seed,count),pool=new SimPool(Number(arg('workers','4')));
  try{
    const runs=await pool.run(cfg,seeds,'Plus'),stats=batchStats('A-Lite+ replay',runs);
    record={model:'Plus',sourceHash:hashTree('src'),cfg,seeds,runs,stats};
    console.log(JSON.stringify({runs:count,mean:stats.tEvac.mean,ci:[stats.tEvac.ciLow,stats.tEvac.ciHigh],out}));
  }finally{await pool.close();}
}
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(record,null,1)+'\n');
