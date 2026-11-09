/** Prespecified fine-step confirmation, never choose the fastest integration step. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {SimPool} from './pool';
import {hashTree,snapshotSource} from './research-study';
const root='results/plus-study';
const protocol={declaredAt:new Date().toISOString(),dt:.0125,runs:100,roles:[{id:'six-manager-1.4-fine',config:'speed-alternative-config',base:73101},{id:'expanded-staff-1.4-fine',config:'staff-expanded-config',base:73403}],rule:'Always rerun both frozen policies at the declared finest step, on their original confirmation audiences. No policy retuning or fastest-step selection. Original 0.1 s and supplementary convergence results remain.'};
if(!existsSync(`${root}/final-resolution-protocol.json`))writeFileSync(`${root}/final-resolution-protocol.json`,JSON.stringify(protocol,null,2));
while(!existsSync(`${root}/speed-confirmation.json`)||!existsSync(`${root}/staff-expansion-confirmation.json`))await new Promise(r=>setTimeout(r,1000));
while(JSON.parse(readFileSync(`${root}/staff-expansion-confirmation.json`,'utf8')).cases.length<3)await new Promise(r=>setTimeout(r,1000));
snapshotSource(`${root}/final-resolution-source.json`);const sourceHash=hashTree('src'),pool=new SimPool(4),cases:any[]=[];
try{for(const role of protocol.roles){const cfg=JSON.parse(readFileSync(`${root}/${role.config}.json`,'utf8'));cfg.movement.dt=protocol.dt;cfg.label=role.id;
 const seeds=batchSeeds(role.base,protocol.runs),runs=await pool.run(cfg,seeds,'Plus');
 cases.push({id:role.id,cfg,seedBase:role.base,seeds,runs,stats:summarize(runs.map(r=>r.tEvac))});
 writeFileSync(`${root}/final-resolution.json`,JSON.stringify({sourceHash,cases},null,1));writeFileSync(`${root}/${role.id}-config.json`,JSON.stringify(cfg,null,1));console.log(role.id,cases.at(-1).stats);
}}finally{await pool.close();}
