/** Reusable passive full-house verification; never modifies simulated state. */
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import {PlusSimulation} from '../src/plus/PlusSimulation';
import {auditWalkways} from './audit-walkways';
import type {SimConfig} from '../src/simulation/Params';
export function auditPlus(c:{id:string;cfg:SimConfig},seed:number){
 const sim=new PlusSimulation(geo,c.cfg,seed),m=sim.movement,integral=new Float64Array(sim.graph.links.length);let storageChecks=0,populationChecks=0;
 const previous=sim.guidance.mobile.routes.map(r=>({walked:r.walked,link:r.links[r.index]}));
 const beforeCounts=Int32Array.from(m.linkCount);
 const audit=auditWalkways(sim,()=>{
  for(let k=0;k<sim.guidance.mobile.routes.length;k++){const r=sim.guidance.mobile.routes[k],prior=previous[k],delta=r.walked-prior.walked;
   if(delta>r.spec.speed*sim.cfg.movement.dt+1e-7||delta<0||(beforeCounts[prior.link]>0&&delta>1e-7))throw Error('Staff motion exceeds finite speed or occupied-link restriction');
   prior.walked=r.walked;prior.link=r.links[r.index];
  }
  beforeCounts.set(m.linkCount);
  let total=0;for(let li=0;li<m.linkCount.length;li++){if(m.linkCount[li]<0||m.linkCount[li]>m.occCap[li])throw Error('Storage overflow');total+=m.linkCount[li];storageChecks++;integral[li]+=sim.gates.cap[li]*sim.cfg.movement.dt;}
  if(total!==sim.agents.filter(a=>a.link>=0).length||sim.agents.length!==1329)throw Error('Population conservation failed');populationChecks++;
  for(let i=0;i<m.discharged.length;i++)if(m.discharged[i]>1+m.serviceIntegral[i]+1e-5)throw Error('Passage service exceeded');
  for(let li=0;li<integral.length;li++)if(sim.gates.isGate[li]&&sim.gates.passes[li]>1+integral[li]+1e-5)throw Error('Gate service exceeded');
 });
 const r={id:c.id,...audit,storageChecks,populationChecks,serviceChecks:'All directions and gates, every step; cumulative service ≤ integral capacity + initial credit',diagnostics:sim.diagnostics()};

 r.diagnostics.events=r.diagnostics.events.filter(e=>e.kind==='sign-update'||e.kind==='manager-arrival');return r;
}
