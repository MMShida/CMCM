/** Single complete A-Lite replication, with full configuration and agent records. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {hashTree} from './research-study';
const arg=(k:string,d:string)=>process.argv.includes(`--${k}`)?process.argv[process.argv.indexOf(`--${k}`)+1]:d;
const cfg=JSON.parse(readFileSync(arg('config','results/route-study/overall-config.json'),'utf8')),seed=Number(arg('seed',String(cfg.seed)));
const s=new LiteSimulation(BAILEY_HALL,cfg,seed);s.run();const result=s.result({agents:true});
const out=arg('out',`results/route-study/run-${seed}.json`);mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify({model:'A-Lite',sourceHash:hashTree('src'),cfg:s.cfg,seed,result,exchanges:s.movement.exchanges},null,1));
console.log(JSON.stringify({model:'A-Lite',N:result.N,allLeftBuilding:result.allLeftBuilding,tEvac:result.tEvac,tSafeAll:result.tSafeAll,unresolved:result.unresolved,out},null,2));
