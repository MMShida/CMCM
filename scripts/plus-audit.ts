/** Passive checks on complete runs: no physical or behavioural state is modified. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import {PlusSimulation} from '../src/plus/PlusSimulation';
import {auditPlus} from './plus-physical-check';
import {hashTree,snapshotSource} from './research-study';
import {batchSeeds} from '../src/simulation/MonteCarlo';
import {createPopulation} from '../src/simulation/Population';
import {networkFor} from '../src/network/NetworkGraph';
import {flowReport} from '../src/network/StaticFlow';
import {releasesFromPopulation,timeExpandedFlow} from '../src/network/TimeExpanded';
const root='results/plus-study',loadedSourceHash=hashTree('src');snapshotSource(`${root}/audit-loaded-source.json`);
while(!existsSync(`${root}/selection-roles.json`))await new Promise(r=>setTimeout(r,1000));
const roles=JSON.parse(readFileSync(`${root}/selection-roles.json`,'utf8')),selected=roles.cases.find((c:any)=>c.id==='selected');
const cases=[selected,...roles.cases.filter((c:any)=>c.id==='combined6')];
const blocked=structuredClone(selected);blocked.id='selected-FC2';blocked.cfg.blocked.links=['FC2'];blocked.cfg.blocked.knowledge='discovery';cases.push(blocked);
const records=[],seeds=batchSeeds(73207,2);
for(const c of cases)for(const seed of seeds){
 const r=auditPlus(c,seed);
 r.diagnostics.events=r.diagnostics.events.filter(e=>e.kind==='sign-update');records.push(r);
 writeFileSync(`${root}/physical-audit.json`,JSON.stringify({sourceHash:loadedSourceHash,seeds,records},null,1));console.log('audit',c.id,seed,r.tEvac);
}
const sim=new PlusSimulation(geo,selected.cfg,seeds[0]),cfg=sim.cfg,rep=flowReport(sim.geo,cfg),net=networkFor(sim.geo,cfg),pop=createPopulation(sim.geo,cfg,seeds[0]);
const ambulant=pop.agents.filter(a=>!a.wheelchair),flows=[];
for(const mode of ['immediate','intrinsic']){
 const releases=releasesFromPopulation(net,cfg,ambulant.map(a=>({seat:a.seat,tDepart:mode==='immediate'?0:a.tRecognition+a.tResponse+a.tPrepare})));
 const result=timeExpandedFlow(net,cfg,releases,{dt:1});flows.push({mode,...result});console.log('C',mode,result.tStar,result.N);
}
writeFileSync(`${root}/flow-benchmark.json`,JSON.stringify({sourceHash:loadedSourceHash,static:rep.all,building:rep.building,byLevel:rep.byLevel,flows,note:'C uses representative speed and perfectly coordinated routing; 1326 ambulant people only. Not a full-house achievable prediction or a calibrated Bailey evacuation.'},null,1));
