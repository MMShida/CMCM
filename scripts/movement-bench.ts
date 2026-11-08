/** Synthetic verification only: these geometries never enter the Bailey study. */
import { NavGraph } from '../src/geometry/NavigationGraph';
import type { GeometryData } from '../src/geometry/types';
import { defaultConfig, type SimConfig } from '../src/simulation/Params';
import { Agent, ST } from '../src/simulation/Agent';
import { MovementSystem } from '../src/simulation/Movement';
import { GateSystem } from '../src/simulation/QueueSystem';

export function fixture(lengths:number[], n=1, dt=0.1, numerics:SimConfig['numerics']=undefined) {
  const cfg=defaultConfig();cfg.movement.dt=dt;cfg.numerics=numerics;
  const positions=[0];for(const l of lengths)positions.push(positions.at(-1)!+l);
  const geo:GeometryData={version:1,name:'synthetic verification',notes:[],walls:[],overlays:[],zones:[],crowdManagerPosts:[],labels:[],capacity:{total:n,orchestra:n,mezzanine:0,balcony:0,wheelchair:0},
    nodes:positions.map((x,i)=>({id:`n${i}`,x,y:0,floor:1,kind:i===lengths.length?'safe':'junction',exitGroup:i===lengths.length?'FOYER':undefined})),
    links:lengths.map((l,i)=>({id:`l${i}`,a:`n${i}`,b:`n${i+1}`,pts:[[positions[i],0],[positions[i+1],0]],width:0.8,lanes:1,kind:'walkway',floor:1,accessible:true,oneWay:true})),
    seats:Array.from({length:n},(_,i)=>({id:`s${i}`,level:'orchestra',section:'x',row:'x',link:'l0',s:0,x:0,y:0,zone:'x',aisleDist:0,rowIndex:0}))};
  const graph=new NavGraph(geo),agents=Array.from({length:n},(_,i)=>{const a=new Agent(i,i,'shortest');a.state=ST.MOVING;a.v=a.v0=1.2;a.radius=.22;return a;});
  const sim:any={cfg,geo,graph,agents,seatLink:new Int32Array(n),envSpeed:1,t:0,cohesionTick:false,movementObserver:null,
    density:{clearList(){},add(){},densityAhead(){return 0;}},gates:new GateSystem(graph,cfg),rngDyn:{random:()=>.5},progress(){},cueByPassing(){},onArrive(){},recordTraversal(){},
    markSafe(a:Agent){a.state=ST.EXITED;a.link=-1;},routing:{nextLink(a:Agent,node:number){return graph.adj[node].findIndex(e=>e.dir===1);}},reconsiderWhileWaiting(){},noRoute(){}};
  sim.movement=new MovementSystem(sim);
  return sim;
}

export function segmentation(dt:number,segments:number,numerics?:SimConfig['numerics']){
  const s=fixture(Array(segments).fill(12/segments),1,dt,numerics),a=s.agents[0] as Agent;
  s.movement.placeAt(a,0,1,0);
  const speeds:number[]=[];
  while(!a.done&&s.t<100){s.t+=dt;s.movement.step(dt);speeds.push(a.v);}
  return {dt,segments,time:s.t,minSpeed:Math.min(...speeds.slice(0,-1))};
}

export function laneFlow(dt:number,numerics?:SimConfig['numerics']){
  const s=fixture([2000],60,dt,numerics),cross:number[]=[],previous=new Float64Array(60);
  for(const a of s.agents as Agent[]){a.v0=a.id?1.3:1.2;s.movement.placeAt(a,0,1,500-a.id*1.28);}
  let minGap=Infinity;
  while(s.t<450){for(const a of s.agents as Agent[])previous[a.id]=a.sDir;s.t+=dt;s.movement.step(dt);
    for(const a of s.agents as Agent[]){if(previous[a.id]<900&&a.sDir>=900)cross[a.id]=s.t-dt+dt*(900-previous[a.id])/(a.sDir-previous[a.id]);
      if(a.id)minGap=Math.min(minGap,s.agents[a.id-1].sDir-a.sDir);}}
  return {dt,observedFlow:30/(cross[40]-cross[10]),intendedFlow:1.2/(.44+1.2*.7),minGap,crossings:cross};
}
