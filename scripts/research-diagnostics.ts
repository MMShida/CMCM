/** Paired time-step checks, observed tails and conditional ideal-flow benchmarks.
 * node --import tsx scripts/research-diagnostics.ts --cases ... --runs 3
 * These are diagnostics, never an optimisation objective or a full-house Model C claim.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BAILEY_HALL } from '../src/geometry/BaileyHall';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { NetworkSimulation } from '../src/network/NetworkSimulation';
import { benchmark } from '../src/compare/Comparison';
import { batchSeeds, toRunSummary } from '../src/simulation/MonteCarlo';
import { createPopulation } from '../src/simulation/Population';
import { hashTree, snapshotSource, type Case } from './research-study';
const arg=(k:string,d:string)=>process.argv.includes(`--${k}`)?process.argv[process.argv.indexOf(`--${k}`)+1]:d;
const cases:Case[]=JSON.parse(readFileSync(arg('cases','results/research-180/confirmation-cases.json'),'utf8'));
const out=arg('out','results/research-180/diagnostics.json'),seeds=batchSeeds(1800420,Number(arg('runs','3')));
const records:any[]=[];
const save=()=>writeFileSync(out,JSON.stringify({sourceHash:hashTree('src'),seeds,records},null,1));
snapshotSource(out.replace(/\.json$/,'')+'-source.json');
for(const c of cases)for(const seed of seeds){
  const row:any={id:c.id,seed,cfg:c.cfg};
  for(const model of ['A','B'] as const){
    for(const half of [false,true]){
      const cfg=structuredClone(c.cfg);if(model==='A'&&half)cfg.movement.dt/=2;
      const sim=model==='A'?new SimulationEngine(BAILEY_HALL,cfg,seed):new NetworkSimulation(BAILEY_HALL,cfg,seed,{dt:half?0.125:0.25});
      sim.run();const r=sim.result(),key=`${model}${half?'half':''}`;
      const people=sim.agents.map(a=>({id:a.id,seat:BAILEY_HALL.seats[a.seat].id,zone:BAILEY_HALL.seats[a.seat].zone,group:a.group,v0:a.v0,wheelchair:a.wheelchair,tStart:a.tStartMove,tExit:a.tLeftBuilding,wait:sim instanceof NetworkSimulation?sim.na[a.id].waitTotal:a.waitTotal}));
      row[key]={summary:toRunSummary(r),starts:sim.agents.map(a=>a.tStartMove),people};
      console.log(c.id,seed,key,r.tEvac);
    }
  }
  // Explicitly preserve Model C's ambulatory-only flow population and unknown-start count.
  row.C={};
  for(const release of ['imm','pre','A','B']){
    const starts=release==='imm'||release==='pre'?release:row[release].starts;
    const cflow=benchmark(BAILEY_HALL,c.cfg,seed,starts,1);
    row.C[release]={flowN:cflow.N,populationN:cflow.populationN,unknownStarts:cflow.unknownStarts,tStar:cflow.tStar,tInd:cflow.tInd,tBound:cflow.tBound};
  }
  const p=createPopulation(BAILEY_HALL,c.cfg,seed).agents;
  row.audience={N:p.length,wheelchairs:p.filter(a=>a.wheelchair).length,maxIntrinsic:Math.max(...p.map(a=>a.tRecognition+a.tResponse+a.tPrepare))};
  records.push(row);save();
}
