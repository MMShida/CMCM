import {expect,it} from 'vitest';
import {segmentation,laneFlow,fixture} from '../scripts/movement-bench';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {defaultConfig} from '../src/simulation/Params';
import {SimulationEngine} from '../src/simulation/SimulationEngine';
import {LiteMovement} from '../src/lite/LiteMovement';
import {GateSystem} from '../src/simulation/QueueSystem';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {ST} from '../src/simulation/Agent';
const corrected={conserveService:true,preserveTransitVelocity:true,synchronousHeadway:true,replanMissingPath:true};
it('preserves velocity across unobstructed link boundaries without increasing free speed',()=>{
  for(const dt of [.1,.05])for(const n of [1,12,24]){const r=segmentation(dt,n,corrected);expect(r.time).toBeLessThanOrEqual(10+dt+1e-8);expect(r.time).toBeGreaterThanOrEqual(10-1e-8);expect(r.minSpeed).toBeCloseTo(1.2,8);}
  expect(segmentation(.1,24).time).toBeGreaterThan(13);
});
it('synchronous headway reproduces paced-lane flow at three time steps and prevents overlap',()=>{
  for(const dt of [.1,.05,.025]){const r=laneFlow(dt,corrected);expect(r.observedFlow).toBeCloseTo(r.intendedFlow,7);expect(r.minGap).toBeGreaterThan(.44);}
  expect(laneFlow(.1).observedFlow).toBeGreaterThan(1.03);
});
it('an exhausted exterior-door path immediately replans to the street only when the fix is enabled',()=>{
  for(const fix of [false,true]){
    const c=defaultConfig();c.numerics={conserveService:true,replanMissingPath:fix};const s=new SimulationEngine(BAILEY_HALL,c,11),a=s.agents.find(a=>a.group<0&&!a.wheelchair)!;
    const li=s.graph.linkByIdOrThrow('F3'),L=s.graph.links[li];a.link=li;a.dir=1;a.sDir=L.len;a.tLeftBuilding=1;a.state=ST.OUTSIDE;a.knownExits=1;a.targetGroup=a.pathGroup=0;
    a.pathNodes=[L.a];a.pathAdj=[s.graph.adj[L.a].findIndex(e=>e.link===li)];a.pathPos=1;a.pathValid=true;
    const k=s.routing.nextLink(a,L.b,li);if(fix)expect(k).toBeGreaterThanOrEqual(0);else expect(k).toBe(-1);
  }
});
function liteFixture(lengths:number[],n:number,dt=.1){const s=fixture(lengths,n,dt);s.cfg.numerics=corrected;s.movement=new LiteMovement(s);return s;}
it('A-Lite corridor discharge respects the shared physical rate, FIFO and finite storage',()=>{
  const s=liteFixture([100,100],100),m=s.movement as LiteMovement;
  for(const a of s.agents){expect(m.placeAt(a,0,1,100)).toBe(true);m.ready[a.id]=0;}
  const order:number[]=[];s.recordTraversal=(a:any)=>order.push(a.id);
  for(let k=0;k<800;k++){s.t=(k+1)*.1;m.step(.1);s.gates.finishStep();for(let li=0;li<2;li++)expect(m.linkCount[li]).toBeLessThanOrEqual(m.occCap[li]);}
  expect(m.discharged[0]).toBeGreaterThan(73);expect(m.discharged[0]).toBeLessThanOrEqual(1+80*m.capacity[0]+1e-8);
  expect(order).toEqual([...order].sort((a,b)=>a-b));
});
it('A-Lite row delay follows seat distance and unchanged row speed',()=>{
  const s=liteFixture([12],1),a=s.agents[0];s.graph.links[0].isRow=true;s.geo.seats[0].s=3;a.pendingRowDir=1;
  expect(s.movement.tryEnterRow(a)).toBe(true);expect(s.movement.ready[0]).toBeCloseTo(9/.45);
});
it('A-Lite fully preserves audience draws, wheelchair routes, storage and outside states',()=>{
  const c=defaultConfig(),s=new LiteSimulation(BAILEY_HALL,c,1294506412),a=new SimulationEngine(BAILEY_HALL,c,1294506412);
  const traits=(x:SimulationEngine)=>x.agents.map(p=>[p.seat,p.v0,p.radius,p.group,p.tRecognition,p.tResponse,p.tPrepare,p.uCM]);expect(traits(s)).toEqual(traits(a));
  while(!s.finished){s.step();for(let li=0;li<s.graph.links.length;li++)if(s.movement.linkCount[li]<0||s.movement.linkCount[li]>s.movement.occCap[li])throw new Error('storage violation');
    if(s.movement.linkCount.reduce((x,y)=>x+y,0)!==s.agents.filter(p=>p.link>=0).length)throw new Error('population not conserved on links');
    for(const p of s.agents){if(p.wheelchair&&p.link>=0&&!s.graph.links[p.link].accessible)throw new Error('inaccessible path');if(!p.inside&&p.state<ST.OUTSIDE)throw new Error('outside state lost');}}
  expect(s.agents).toHaveLength(1329);expect(s.result().allLeftBuilding).toBe(true);expect(s.result().peakDensity).toBeGreaterThan(0);expect(s.result().density?.exposure.local).toContain('original link');
  for(let i=0;i<s.movement.credit.length;i++)expect(s.movement.discharged[i]).toBeLessThanOrEqual(1+s.movement.serviceIntegral[i]+1e-6);
},60000);
it('A-Lite doors and stairs enforce physical gate capacities under sustained demand',()=>{
  for(const stair of [false,true]){
    const s=fixture([100,.3],100,.1),L=s.graph.links[1];L.gate=true;L.isStair=stair;L.width=.6;L.lanes=1;
    s.cfg.numerics=corrected;s.gates=new GateSystem(s.graph,s.cfg);s.movement=new LiteMovement(s);
    for(const a of s.agents){s.movement.placeAt(a,0,1,100);s.movement.ready[a.id]=0;}
    for(let k=0;k<800;k++){s.t=(k+1)*.1;s.movement.step(.1);s.gates.finishStep();}
    const bound=s.gates.cap[1]*80;expect(s.gates.passes[1]).toBeLessThanOrEqual(bound+1+1e-8);expect(s.gates.passes[1]).toBeGreaterThan(bound*.9);
  }
});
it('opposing A-Lite heads exchange slots without increasing storage or bypassing service',()=>{
  const s=fixture([10,10],2,.1);s.graph.links.forEach((L:any)=>L.width=1.1);s.graph.adj[1].push({link:0,other:0,dir:-1});
  s.routing.nextLink=(a:any,n:number)=>s.graph.adj[n].findIndex((e:any)=>e.dir===a.dir);
  s.movement=new LiteMovement(s);const m=s.movement as LiteMovement;m.occCap.fill(1);
  m.placeAt(s.agents[0],0,1,10);m.placeAt(s.agents[1],1,-1,10);m.ready.fill(0);s.t=.1;m.step(.1);
  expect(m.exchanges).toBe(1);expect([...m.linkCount]).toEqual([1,1]);expect(s.agents.map((a:any)=>a.link)).toEqual([1,0]);
  for(let i=0;i<m.credit.length;i++)expect(m.discharged[i]).toBeLessThanOrEqual(1+m.serviceIntegral[i]+1e-8);
});
it('merging streams share downstream storage and service without a one-person-per-node rule',()=>{
  const s=fixture([100,100,100],20,.1);s.graph.links[0].b=2;s.graph.adj[0][0].other=2;s.movement=new LiteMovement(s);
  for(const a of s.agents){s.movement.placeAt(a,a.id%2,1,100);s.movement.ready[a.id]=0;}
  s.t=.1;s.movement.step(.1);
  expect(s.movement.linkCount[2]).toBe(2);expect([...s.movement.linkCount].reduce((a,b)=>a+b,0)).toBe(20);
});
it('A-Lite permits parallel lanes while preserving FIFO within each lane',()=>{
  const s=fixture([20,20],2,.1);s.graph.links[0].lanes=2;s.movement=new LiteMovement(s);
  const m=s.movement as LiteMovement;s.agents[0].v0=.6;s.agents[1].v0=1.2;
  m.placeAt(s.agents[0],0,1,10);m.placeAt(s.agents[1],0,1,10);
  expect(s.agents[0].lane).not.toBe(s.agents[1].lane);
  const order:number[]=[];s.recordTraversal=(a:any)=>order.push(a.id);
  for(let k=0;k<180;k++){s.t=(k+1)*.1;m.step(.1);s.gates.finishStep();}
  expect(order[0]).toBe(1);expect(order).toContain(0);
});

it('A-Lite discovers a blocked exterior door without admitting through it',()=>{
  const c=defaultConfig();c.blocked.links=['F3'];const s=new LiteSimulation(BAILEY_HALL,c,1294506412),li=s.graph.linkByIdOrThrow('F3');
  while(!s.finished){s.step();if(s.gates.passes[li]!==0)throw new Error('closed exit discharged');}
  expect(s.result().allLeftBuilding).toBe(true);expect(s.agents.filter(a=>a.wheelchair)).toHaveLength(3);
},60000);
