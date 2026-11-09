/** Passive full-trajectory topology audit; never changes decisions or draws randomness. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {SimulationEngine} from '../src/simulation/SimulationEngine';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import type {SimConfig} from '../src/simulation/Params';
import {batchSeeds} from '../src/simulation/MonteCarlo';
import {hashTree} from './research-study';

export function auditWalkways(sim:SimulationEngine,afterStep?:()=>void){
 if(sim.cfg.crowdManagers.vacatedRowGuidance)throw Error('This audit requires seatway shortcuts disabled');
 const g=sim.graph,visited=new Set<number>(),used:Record<string,number>={};
 let transitions=0,seatwayChecks=0,positionChecks=0,backwardQueueUpdates=0,maxBackwardQueueUpdate=0;
 const previous=sim.agents.map(a=>({link:a.link,dir:a.dir,s:a.sDir}));
 sim.traceHook=e=>{
  const a=sim.agents[e.agent],from=g.links[e.from],to=g.links[e.to];
  const node=a.dir>0?to.a:to.b;
  if(from.a!==node&&from.b!==node)throw Error(`Nonadjacent transition: ${from.id} to ${to.id}`);
  if(to.isRow)throw Error(`Seatway used as a through-route: ${to.id}`);
  if(to.prohibited||sim.movement.closed[e.to])throw Error(`Closed/prohibited traversal: ${to.id}`);
  if(a.wheelchair&&!to.accessible)throw Error(`Inaccessible traversal: ${to.id}`);
  if(!g.adj[node].some(x=>x.link===e.to&&x.dir===a.dir))throw Error('Invalid direction');
  transitions++;used[to.kind]=(used[to.kind]??0)+1;visited.add(e.to);
 };
 while(!sim.finished){
  sim.step();
  afterStep?.();
  for(const a of sim.agents){
   if(a.link>=0){
    const L=g.links[a.link];
    if(a.sDir< -1e-7||a.sDir>L.len+1e-7)throw Error('Position outside its walkway');
    if(L.isRow){seatwayChecks++;if(a.link!==sim.seatLink[a.id])throw Error('Person entered somebody else’s seatway');}
    if(a.wheelchair&&!L.accessible)throw Error('Wheelchair on inaccessible link');
    if(sim.movement.closed[a.link])throw Error('Person on closed link');
    const p=previous[a.id];
    if(p.link===a.link&&p.dir===a.dir&&p.s>a.sDir+1e-7){backwardQueueUpdates++;maxBackwardQueueUpdate=Math.max(maxBackwardQueueUpdate,p.s-a.sDir);}
    positionChecks++;
   }
   previous[a.id]={link:a.link,dir:a.dir,s:a.sDir};
  }
 }
 sim.traceHook=null;
 const r=sim.result();
 if(!r.allLeftBuilding||r.N!==1329)throw Error('Full-house clearance failed');
 return {seed:sim.seed,N:r.N,wheelchairs:sim.agents.filter(a=>a.wheelchair).length,allLeftBuilding:r.allLeftBuilding,tEvac:r.tEvac,
  transitions,positionChecks,seatwayChecks,distinctWalkways:visited.size,traversalsByKind:used,
  violations:0,backwardQueueUpdates,maxBackwardQueueUpdate,
  note:'Queue-coordinate relocations along the same link are reported separately from forbidden seat-row shortcuts. They are not collision-resolved walking trajectories.'};
}

if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
 const arg=(k:string,d:string)=>process.argv.includes('--'+k)?process.argv[process.argv.indexOf('--'+k)+1]:d;
 const cases=JSON.parse(readFileSync(arg('cases','results/route-study/confirmation-cases.json'),'utf8'));
 const seeds=batchSeeds(Number(arg('seed','62306')),Number(arg('runs','3'))),records=[];
 for(const c of cases)for(const model of c.models.filter((m:string)=>m==='A'||m==='Lite'))for(const seed of seeds){
  const sim=model==='A'?new SimulationEngine(BAILEY_HALL,c.cfg as SimConfig,seed):new LiteSimulation(BAILEY_HALL,c.cfg as SimConfig,seed);
  const r={id:c.id,model,...auditWalkways(sim)};records.push(r);console.log(c.id,model,seed,r.tEvac,'walkway violations',r.violations);
 }
 const out=arg('out','results/route-study/walkway-audit.json');mkdirSync(dirname(out),{recursive:true});
 writeFileSync(out,JSON.stringify({sourceHash:hashTree('src'),seeds,records},null,2));
}
