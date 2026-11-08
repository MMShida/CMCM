/** Independently inspect final engine state for blocked-exit and device comparisons. */
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {SimulationEngine} from '../src/simulation/SimulationEngine';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {NetworkSimulation} from '../src/network/NetworkSimulation';
const path='results/placement-study/blocked.json';
let data:any;try{data=JSON.parse(readFileSync(path,'utf8'));}catch{data=JSON.parse(gunzipSync(readFileSync(path+'.gz')).toString());}
const records:any[]=[];
for(const row of data.results.filter((r:any)=>r.id==='combined-six-blocked-F3')){
 for(const expected of row.runs){
  const sim=row.model==='Lite'?new LiteSimulation(BAILEY_HALL,row.cfg,expected.seed):row.model==='B'?new NetworkSimulation(BAILEY_HALL,row.cfg,expected.seed):new SimulationEngine(BAILEY_HALL,row.cfg,expected.seed);
  const result:any=sim.run();const r=result.result??result;
  const gate=r.gates.find((g:any)=>g.id==='F3');
  if(!gate||gate.passes!==0||r.N!==1329||!r.allLeftBuilding||r.tEvac!==expected.tEvac)throw Error('Blocked-door verification failed '+row.model+' '+expected.seed);
  const agents=sim.agents;
  records.push({model:row.model,seed:expected.seed,tEvac:r.tEvac,blockedDoorPasses:gate.passes,N:r.N,allLeftBuilding:r.allLeftBuilding,LEDeligible:agents.filter(a=>a.ledSeen).length,LEDaccepted:agents.filter(a=>a.ledGroup>=0).length});
 }
 console.log(row.model,'12 blocked runs: zero F3 passages; all 1329 outside; exact replay');
}
writeFileSync('results/placement-study/blocked-verification.json',JSON.stringify({passed:true,records},null,2));
