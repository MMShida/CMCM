import { describe, expect, it } from 'vitest';
import { BAILEY_HALL, slotId } from '../src/geometry/BaileyHall';
import { defaultConfig } from '../src/simulation/Params';
import { graphFor, SimulationEngine } from '../src/simulation/SimulationEngine';
import { GateSystem } from '../src/simulation/QueueSystem';
import { hardPanelIds, ropeCost } from '../src/simulation/Barriers';
import { NetworkSimulation } from '../src/network/NetworkSimulation';
import { SignVisibility, blocksSight } from '../src/simulation/SignVisibility';
import { createPopulation } from '../src/simulation/Population';
import { guidanceSeat } from '../src/simulation/Plan';
import { individualBound } from '../src/network/TimeExpanded';
import { networkFor } from '../src/network/NetworkGraph';

describe('conservative service integration', () => {
  it('delivers the stated saturated rate across time steps, including >1 person per step', () => {
    for (const dt of [0.05,0.1,0.25,1]) {
      const c=defaultConfig();c.numerics={conserveService:true};c.movement.fasterIsSlower.enabled=false;
      const g=graphFor(BAILEY_HALL), gates=new GateSystem(g,c);
      const li=g.links.find(l=>l.gate && gates.baseCap[l.idx]>1)!.idx;
      for(let k=0;k<100/dt;k++) {
        gates.refill(dt,k*dt);
        while(gates.canPass(li))gates.consume(li,k*dt);
        gates.finishStep();
      }
      expect(gates.passes[li]).toBeGreaterThanOrEqual(Math.floor(1+100*gates.baseCap[li]-1e-8));
      expect(gates.passes[li]).toBeLessThanOrEqual(1+100*gates.baseCap[li]+1e-8);
      expect(gates.tokens[li]).toBeLessThan(1);
    }
  });
  it('does not bank long idle periods or bypass responder capacity reductions', () => {
    const c=defaultConfig();c.numerics={conserveService:true};c.movement.fasterIsSlower.enabled=false;
    c.stress.responders={links:['FC1'],fromTime:5,capacityFactor:0.5};
    const g=graphFor(BAILEY_HALL), gates=new GateSystem(g,c),li=g.linkByIdOrThrow('FC1');
    gates.setResponderLinks([li]);
    for(let k=0;k<100;k++){gates.refill(0.1,k/10);gates.finishStep();}
    expect(gates.tokens[li]).toBe(1);
    expect(gates.cap[li]).toBeCloseTo(gates.baseCap[li]*0.5);
  });
});

describe('interventions retain the problem', () => {
  it('a rope is traversable in both engines, a panel closes the same physical link', () => {
    const c=defaultConfig(),id=slotId(BAILEY_HALL,'W1');c.barriers=[id];c.barrierTypes={[id]:'soft-rope'};c.ropePenalty=15;
    expect(hardPanelIds(c)).toEqual([]);expect(ropeCost(c,id)).toBe(15);
    const a=new SimulationEngine(BAILEY_HALL,c,11),b=new NetworkSimulation(BAILEY_HALL,c,11);
    expect(a.movement.closed[a.graph.linkByIdOrThrow(id)]).toBe(0);expect(b.barrierEdges.size).toBe(0);
    delete c.barrierTypes;
    expect(new SimulationEngine(BAILEY_HALL,c,11).barrierLinks.length).toBe(1);
    expect(new NetworkSimulation(BAILEY_HALL,c,11).barrierEdges.size).toBe(1);
  });
  it('guidance, barriers and service integration leave all sampled people identical', () => {
    const a=defaultConfig(),b=defaultConfig();b.numerics={conserveService:true};b.preassign.enabled=true;b.led.enabled=true;b.crowdManagers.count=10;
    b.adaptive.agents=b.adaptive.managers=true;b.barriers=[slotId(BAILEY_HALL,'E1')];
    const p=createPopulation(BAILEY_HALL,a,23).agents,q=createPopulation(BAILEY_HALL,b,23).agents;
    expect(p.length).toBe(1329);expect(p.filter(x=>x.wheelchair).length).toBe(3);
    const traits=(xs:typeof p)=>xs.map(x=>[x.seat,x.type,x.v0,x.radius,x.tRecognition,x.tResponse,x.tPrepare,x.group,x.uCM,x.uLED]);
    expect(traits(q)).toEqual(traits(p));
  });
});

describe('sign visibility is geometric and carries one public message', () => {
  it('obeys floor, range, facing and opaque intersections', () => {
    const c=defaultConfig();
    const v=new SignVisibility({...BAILEY_HALL,walls:[]},{range:10,halfAngleDegrees:60,occlusion:true,signs:[{id:'s',x:0,y:0,floor:1,facingDegrees:0,exit:'PORTICO_W'}]},c);
    expect(v.nearest(5,0,1)?.exit).toBe('PORTICO_W');expect(v.nearest(-5,0,1)).toBeUndefined();expect(v.nearest(11,0,1)).toBeUndefined();expect(v.nearest(5,0,2)).toBeUndefined();
    expect(blocksSight(0,0,10,0,{ax:5,ay:-1,bx:5,by:1,floor:1})).toBe(true);
    expect(blocksSight(0,0,10,0,{ax:5,ay:1,bx:5,by:2,floor:1})).toBe(false);
  });
  it('a fixed sign does not become a personalized route instruction during a closure', () => {
    const c=defaultConfig();c.led.enabled=true;c.led.dynamic=true;c.blocked.links=['FC1'];
    c.led.spatial={range:100,halfAngleDegrees:180,occlusion:false,signs:[{id:'fixed',x:0,y:0,floor:1,facingDegrees:0,exit:'PORTICO_W'}]};
    const s=new SimulationEngine(BAILEY_HALL,c,41);s.guidance.ledActive=true;
    for(const a of s.agents.filter(a=>a.floor===1&&!a.wheelchair).slice(0,10)){
      a.uLED=a.uLEDsee=0;s.guidance.ledPerceive(a);expect(a.ledGroup).toBe(1);
    }
  });
});

it('unknown departure times cannot produce a finite all-person bound', () => {
  const c=defaultConfig(),net=networkFor(BAILEY_HALL,c);
  const r=individualBound(net,c,[{seat:0,tDepart:NaN,v0:1.2,stairRatio:0.57}]);
  expect(r.tInd).toBe(Infinity);expect(r.who).toBe(0);
});

it('group-consistent messages use the leader block without changing the audience', () => {
  const c=defaultConfig(),p=createPopulation(BAILEY_HALL,c,41);
  const group=p.groups.find(g=>g.length>1)!,follower=p.agents[group[1]],leader=p.agents[group[0]];
  expect(guidanceSeat(c,p.agents,p.groups,follower)).toBe(follower.seat);
  c.crowdManagers.groupPlan=true;
  expect(guidanceSeat(c,p.agents,p.groups,follower)).toBe(leader.seat);
  c.population.groupMeetOutside=true;
  expect(guidanceSeat(c,p.agents,p.groups,follower)).toBe(follower.seat);
});

it('extended staffing uses real posts, distinct activation draws and honors absent staff in both engines', () => {
  const c=defaultConfig();c.crowdManagers.placement='coverage18';c.crowdManagers.count=18;c.crowdManagers.unavailable=['CV11'];
  const a=new SimulationEngine(BAILEY_HALL,c,41),b=new NetworkSimulation(BAILEY_HALL,c,41);
  expect(a.guidance.cms.length).toBe(17);expect(b.cmTimes.length).toBe(17);
  expect(a.guidance.cms.some(m=>m.post.id==='CV11')).toBe(false);expect(b.cmTimes.some(m=>m.id==='CV11')).toBe(false);
  expect(new Set(a.guidance.cms.map(m=>m.tActive)).size).toBe(17);
  expect(new Set(b.cmTimes.map(m=>m.tActive)).size).toBe(17);
  expect(a.agents.length).toBe(1329);expect(b.agents.filter(x=>x.wheelchair).length).toBe(3);
});
