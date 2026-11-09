/** Paired step refinement of the frozen policy, with all physical parameters fixed. */
import {readFileSync,writeFileSync} from 'node:fs';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {SimulationEngine} from '../src/simulation/SimulationEngine';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {batchSeeds,toRunSummary,summarize} from '../src/simulation/MonteCarlo';
import {hashTree,snapshotSource} from './research-study';
const arg=(k:string,d:string)=>process.argv.includes(`--${k}`)?process.argv[process.argv.indexOf(`--${k}`)+1]:d;
const cfg=JSON.parse(readFileSync(arg('config','results/lite-study/best-config.json'),'utf8')),out=arg('out','results/lite-study/convergence.json'),seeds=batchSeeds(Number(arg('seed','1800421')),Number(arg('runs','3'))),records:any[]=[];
const models=arg('models','A,A-corrected,Lite').split(',');
if(models.some(m=>!['A','A-corrected','Lite'].includes(m)))throw Error('Unknown convergence model');
snapshotSource(out.replace('.json','-source.json'));
for(const seed of seeds)for(const model of models)for(const dt of [.1,.05,.025]){
 const c=structuredClone(cfg);c.movement.dt=dt;
 if(model==='A')c.numerics={conserveService:true};
 if(model==='A-corrected')c.numerics={conserveService:true,preserveTransitVelocity:true,synchronousHeadway:true,replanMissingPath:true};
 const sim=model==='Lite'?new LiteSimulation(BAILEY_HALL,c,seed):new SimulationEngine(BAILEY_HALL,c,seed);sim.run();const summary=toRunSummary(sim.result());records.push({model,dt,seed,cfg:sim.cfg,summary});
 writeFileSync(out,JSON.stringify({sourceHash:hashTree('src'),seeds,records},null,1));console.log(model,seed,dt,summary.tEvac);
}
for(const model of models)for(const dt of [.05,.025]){
 const delta=seeds.map(seed=>records.find(r=>r.model===model&&r.dt===dt&&r.seed===seed).summary.tEvac-records.find(r=>r.model===model&&r.dt===.1&&r.seed===seed).summary.tEvac);console.log(model,dt,'paired vs .1',summarize(delta));
}
