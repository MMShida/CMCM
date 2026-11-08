/** Read-only diagnostics. Raw final-50 trajectories are gzip JSON, sampled every movement step. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {SimulationEngine} from '../src/simulation/SimulationEngine';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {NetworkSimulation} from '../src/network/NetworkSimulation';
import type {MovementObserver} from '../src/simulation/MovementObserver';
import {ST} from '../src/simulation/Agent';
import {batchSeeds,toRunSummary} from '../src/simulation/MonteCarlo';
import {hashTree,snapshotSource,type Case} from './research-study';
const arg=(k:string,d:string)=>process.argv.includes(`--${k}`)?process.argv[process.argv.indexOf(`--${k}`)+1]:d;
const Engine=arg('model','A')==='Lite'?LiteSimulation:SimulationEngine;
const out=arg('out','results/mechanism-audit/pilot'),cases:Case[]=JSON.parse(readFileSync(arg('cases','results/mechanism-audit/pilot-cases.json'),'utf8'));
const seeds=batchSeeds(Number(arg('seed','9001')),Number(arg('runs','1')));
mkdirSync(out,{recursive:true});snapshotSource(`${out}/source.json`);

class Observer implements MovementObserver {
  totals:Record<string,{seconds:number;speedDeficitMetres:number}>={};
  people:Record<string,number>[];byLink:Record<string,number>[];seen=new Set<string>();
  transitions=0;carrySpeedLoss=0;
  constructor(readonly s:SimulationEngine){this.people=s.agents.map(()=>({}));this.byLink=s.graph.links.map(()=>({}));}
  begin(){this.seen.clear();}
  count(id:number,reason:string,dt:number,link:number,deficit=0){
    if(!this.s.agents[id].inside)return;const key=`${id}:${reason}`;if(this.seen.has(key))return;this.seen.add(key);
    const t=this.totals[reason]??={seconds:0,speedDeficitMetres:0};t.seconds+=dt;t.speedDeficitMetres+=deficit;
    this.people[id][reason]=(this.people[id][reason]??0)+dt;this.byLink[link][reason]=(this.byLink[link][reason]??0)+dt;
  }
  limit(id:number,r:string,before:number,after:number,dt:number,link:number){if(before>after+1e-8)this.count(id,r,dt,link,(before-after)*dt);}
  block(id:number,r:string,dt:number,link:number){this.count(id,r,dt,link);}
  transition(id:number,from:number,to:number,v:number,carry:number,dt:number){if(this.s.agents[id].inside){this.transitions++;this.carrySpeedLoss+=carry/dt;}}
}

for(const c of cases)for(const seed of seeds){
  const s=new Engine(BAILEY_HALL,c.cfg,seed),o=new Observer(s);s.movementObserver=o;
  const series:number[][]=[],gates=s.graph.links.filter(l=>l.gate),gateSeries:any[]=[],capacity=new Float64Array(s.graph.links.length),queuedCapacity=new Float64Array(capacity.length),queuedPasses=new Int32Array(capacity.length),lastPass=new Int32Array(capacity.length);
  const stop=s.agents.map(()=>({episodes:0,current:0,max:0})),hist=s.agents.map(()=>[] as number[][]),last=s.agents.map(()=>[-99,-99,-99]),dt=c.cfg.movement.dt;
  let firstExit:number|null=null,prevSecond=-1;
  while(!s.finished){
    o.begin();s.step();const counts=[s.t,0,0,0,0,0,0,0,0,0]; // t,inside,not-in-lane,row,aisle,corridor,stair,other,exit-queue,group-wait
    for(const a of s.agents){
      if(a.inside){counts[1]++;const L=a.link>=0?s.graph.links[a.link]:null;
        counts[!L?2:L.isRow?3:['aisle','crossAisle'].includes(L.kind)?4:['corridor','foyer','passage'].includes(L.kind)?5:L.isStair?6:7]++;
        if(a.waitTarget>=0&&s.graph.links[a.waitTarget].exterior)counts[8]++;
        if(a.state===ST.WAITING&&!o.seen.has(`${a.id}:row-insertion-gap`)&&!o.seen.has(`${a.id}:row-insertion-yield`)){counts[9]++;o.count(a.id,'ready-group-wait',dt,s.seatLink[a.id]);}
        if(a.link>=0&&a.v<.05){if(!stop[a.id].current)stop[a.id].episodes++;stop[a.id].current+=dt;stop[a.id].max=Math.max(stop[a.id].max,stop[a.id].current);}else stop[a.id].current=0;
      }else if(firstExit===null)firstExit=s.t;
      const x=[a.link,a.state,a.targetGroup];if(x.some((v,i)=>v!==last[a.id][i])){hist[a.id].push([s.t,...x,a.sDir,a.v]);last[a.id]=x;}
    }
    series.push(counts);
    if(counts[1]>0)for(const L of gates){const i=L.idx;capacity[i]+=s.gates.cap[i]*dt;if(s.gates.queueNow[i]>0){queuedCapacity[i]+=s.gates.cap[i]*dt;queuedPasses[i]+=s.gates.passes[i]-lastPass[i];}lastPass[i]=s.gates.passes[i];}
    if(Math.floor(s.t)!==prevSecond){prevSecond=Math.floor(s.t);gateSeries.push([s.t,...gates.map(L=>[s.gates.passes[L.idx],s.gates.queueNow[L.idx],s.gates.cap[L.idx]])]);}
  }
  const result=s.result(),tail=[...s.agents].sort((a,b)=>(Number.isFinite(b.tLeftBuilding)?b.tLeftBuilding:Infinity)-(Number.isFinite(a.tLeftBuilding)?a.tLeftBuilding:Infinity)).slice(0,50).map(a=>a.id),tailSet=new Set(tail);
  const replay=new Engine(BAILEY_HALL,c.cfg,seed),trajectory:number[][]=[];
  const capture=()=>{for(const id of tail){const a=replay.agents[id];trajectory.push([replay.t,id,a.state,a.link,a.dir,a.lane,a.sDir,a.v,a.x,a.y,a.targetGroup,a.groupCap,a.blockedTime,a.inside?1:0]);}};
  capture();while(!replay.finished){replay.step();capture();}
  const check=(sim:SimulationEngine)=>sim.agents.map(a=>[a.tStartMove,a.tLeftBuilding,a.tSafe,a.exitLink,a.reroutes]);
  if(JSON.stringify(check(s))!==JSON.stringify(check(replay)))throw new Error('Observer changed trajectories');
  const b=new NetworkSimulation(BAILEY_HALL,c.cfg,seed);b.run();
  const record={id:c.id,seed,cfg:s.cfg,model:arg('model','A'),sourceHash:hashTree('src'),summary:toRunSummary(result),B:toRunSummary(b.result()),firstExit,observationalReplayEqual:true,
    notes:'Constraint-active seconds overlap and are not additive causal delays. Speed deficits are sequential cap reductions, not counterfactual travel-time savings. Exit idle capacity includes periods without upstream supply. Gate passes are admissions; building clearance is crossing the exterior boundary.',
    seriesColumns:['t','inside','notInLane','rows','aisles','corridors','stairs','otherLinks','exteriorQueueSubset','readyGroupWaitSubset'],series,
    constraints:o.totals,transitionCount:o.transitions,sumCarriedVelocity:o.carrySpeedLoss,
    links:s.graph.links.map(L=>({id:L.id,kind:L.kind,length:L.len,width:L.width,lanes:L.lanes,constraints:o.byLink[L.idx]})),
    gates:gates.map(L=>({id:L.id,exterior:L.exterior,passes:s.gates.passes[L.idx],capacityIntegral:capacity[L.idx],queuedCapacityIntegral:queuedCapacity[L.idx],queuedPasses:queuedPasses[L.idx]})),gateSeries,
    people:s.agents.map(a=>({id:a.id,seat:BAILEY_HALL.seats[a.seat].id,zone:BAILEY_HALL.seats[a.seat].zone,group:a.group,v0:a.v0,elderly:a.elderly,wheelchair:a.wheelchair,start:a.tStartMove,exit:a.tLeftBuilding,safe:a.tSafe,exitLink:a.exitLink,exitSwitches:a.exitSwitches,flipFlops:a.flipFlops,stops:stop[a.id],constraints:o.people[a.id],history:hist[a.id],final50:tailSet.has(a.id)})),
    Bpeople:b.agents.map(a=>({id:a.id,start:a.tStartMove,exit:a.tLeftBuilding,safe:a.tSafe,wait:b.na[a.id].waitTotal})),final50:tail};
  const stem=`${out}/${c.id}-${seed}`;writeFileSync(`${stem}.json`,JSON.stringify(record));
  writeFileSync(`${stem}-final50.json.gz`,gzipSync(JSON.stringify({columns:['t','agent','state','link','dir','lane','sDir','v','x','y','targetGroup','groupCap','blockedTime','inside'],rows:trajectory})));
  console.log(c.id,seed,'A',result.tEvac,'B',b.result().tEvac,'first',firstExit,'tail',tail.slice(0,5),'constraints',JSON.stringify(o.totals));
}
