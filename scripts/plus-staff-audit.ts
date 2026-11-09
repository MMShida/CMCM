import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {batchSeeds} from '../src/simulation/MonteCarlo';
import {auditPlus} from './plus-physical-check';
import {hashTree,snapshotSource} from './research-study';
const root='results/plus-study',loadedSourceHash=hashTree('src');snapshotSource(`${root}/staff-physical-source.json`);
while(!existsSync(`${root}/staff-expansion-selection.json`))await new Promise(r=>setTimeout(r,1000));
const selected=JSON.parse(readFileSync(`${root}/staff-expansion-selection.json`,'utf8'));
// The six coverage posts have no eligible wide patrol within 4 m. Audit a
// genuinely moving candidate, rather than a zero-route stationary fallback.
const moving=JSON.parse(readFileSync(`${root}/staff-expansion-protocol.json`,'utf8')).cases.find((c:any)=>c.id==='staff-12-patrol20');
if(!moving.cfg.plus.managerPatrols.length)throw Error('Physical staff audit requires actual patrol routes.');
const blocked=structuredClone(selected);blocked.id='expanded-FC2';blocked.cfg.blocked.links=['FC2'];blocked.cfg.blocked.knowledge='discovery';
const records=[],seeds=batchSeeds(73407,2);
for(const c of [selected,moving,blocked])for(const seed of seeds){
 const r=auditPlus(c,seed);records.push(r);writeFileSync(`${root}/staff-physical-audit.json`,JSON.stringify({sourceHash:loadedSourceHash,seeds,records},null,1));console.log('staff audit',c.id,seed,r.tEvac);
}
