/** Single-process, rotating-order runtime comparison; run after other simulation jobs finish. */
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {SimulationEngine} from '../src/simulation/SimulationEngine';
import {NetworkSimulation} from '../src/network/NetworkSimulation';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {hashTree} from './research-study';
const cfg=JSON.parse(readFileSync('results/lite-study/best-config.json','utf8'));cfg.numerics={conserveService:true};
const engines={A:SimulationEngine,B:NetworkSimulation,Lite:LiteSimulation},models=['A','B','Lite'] as const,records:any[]=[];
for(const model of models)new engines[model](BAILEY_HALL,cfg,714).run();
const seeds=batchSeeds(71426,3);
for(let k=0;k<3;k++)for(let j=0;j<3;j++){
 const model=models[(j+k)%3],start=performance.now(),sim=new engines[model](BAILEY_HALL,cfg,seeds[k]);sim.run();
 records.push({model,seed:seeds[k],wallMs:performance.now()-start,tEvac:sim.result().tEvac,allLeft:sim.result().allLeftBuilding});
}
const stats=Object.fromEntries(models.map(model=>[model,summarize(records.filter(r=>r.model===model).map(r=>r.wallMs))]));
writeFileSync('results/lite-study/runtime.json',JSON.stringify({sourceHash:hashTree('src'),node:process.version,platform:process.platform,arch:process.arch,cfg,seeds,records,stats,note:'Single process; one warm-up per model; rotated order. Wall time includes construction and run, excludes result serialization.'},null,2));console.log(stats);
