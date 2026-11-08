import {describe,it,expect} from 'vitest';
import {placementCases} from '../scripts/placement-cases';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {SignVisibility} from '../src/simulation/SignVisibility';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {SimulationEngine,graphFor} from '../src/simulation/SimulationEngine';
import {computeField} from '../src/geometry/NavigationGraph';
import {batchStats} from '../src/simulation/MonteCarlo';

describe('six-manager placement study',()=>{
 const cases=placementCases();
 it('keeps six actual staff, 1329 people, three wheelchair users and 24 m of strips',()=>{
  for(const c of cases){
   const sim=new LiteSimulation(BAILEY_HALL,c.cfg,41);
   expect(sim.guidance.cms).toHaveLength(6);expect(sim.agents).toHaveLength(1329);expect(sim.agents.filter(a=>a.wheelchair)).toHaveLength(3);
   if(c.cfg.led.enabled){
    expect(c.cfg.led.spatial.signs).toHaveLength(12);
    let length=0;for(const s of c.cfg.led.spatial.signs)for(let j=1;j<s.strip.points.length;j++)length+=Math.hypot(s.strip.points[j][0]-s.strip.points[j-1][0],s.strip.points[j][1]-s.strip.points[j-1][1]);
    expect(length).toBeCloseTo(24,6);
   }
   // All row ends retain ordinary egress; wheelchair seats retain a stair-free path to refuge.
   const g=sim.graph,closed=new Set(sim.barrierLinks);
   const targets=g.nodes.flatMap((n,i)=>n.kind==='safe'||n.kind==='refuge'?[i]:[]);
   for(const accessible of [false,true]){
    const field=computeField(g,targets,li=>closed.has(li)||g.links[li].prohibited||(accessible&&!g.links[li].accessible));
    for(const a of sim.agents.filter(a=>accessible?a.wheelchair:true)){
     const l=g.links[sim.seatLink[a.id]];expect(Math.min(field.dist[l.a],field.dist[l.b])).toBeLessThan(Infinity);
    }
   }
  }
 },30000);
 it('A-Lite honors a physical panel, traversable rope and fixed LED message just like A',()=>{
  for(const engine of [SimulationEngine,LiteSimulation])for(const type of ['hard1','rope1']){
   const c=structuredClone(cases.find(c=>c.id===`existing-early-${type}`)!.cfg),sim=new engine(BAILEY_HALL,c,41);
   expect(sim.movement.closed[sim.graph.linkByIdOrThrow(c.barriers[0])]).toBe(type==='hard1'?1:0);
   const s=c.led.spatial!.signs[0],a=sim.agents.find(a=>!a.wheelchair)!;a.x=s.x;a.y=s.y;a.floor=1;a.uLED=0;a.uLEDsee=0;
   sim.guidance.ledActive=true;sim.guidance.ledPerceive(a);expect(a.ledGroup).toBe(3);
   const accepted=a.ledGroup;a.x=1000;sim.guidance.ledPerceive(a);expect(a.ledGroup).toBe(accepted);
  }
 });
 it('uses the finite strip footprint, same floor, distance and wall occlusion',()=>{
  const c=structuredClone(cases[0].cfg);
  const spatial={range:2,halfAngleDegrees:10,occlusion:true,signs:[{id:'strip',x:5,y:0,floor:1,facingDegrees:0,exit:'FOYER' as const,strip:{linkId:'test',points:[[0,0],[10,0]] as [number,number][]}}]};
  const v=new SignVisibility({...BAILEY_HALL,walls:[]},spatial,c);
  expect(v.nearest(0,1,1)?.id).toBe('strip');expect(v.nearest(0,-1,1)?.id).toBe('strip');
  expect(v.nearest(0,3,1)).toBeUndefined();expect(v.nearest(0,1,2)).toBeUndefined();
  const wall={floor:1 as const,kind:'wall' as const,pts:[[-5,.5],[15,.5]] as [number,number][],id:'test'};
  expect(new SignVisibility({...BAILEY_HALL,walls:[wall]},spatial,c).nearest(5,1,1)).toBeUndefined();
 });
});

it('does not silently discard an unresolved audience from a full-house mean',()=>{
 const common:any={N:1329,tEvac:170,tEvacAmbulatory:170,tSafe:200,tSafeAll:220,allLeftBuilding:true,unresolvedInside:0,exitGroupUsage:{},maxQueue:{},trapped:0};
 const s=batchStats('test',[common,{...common,seed:2,tEvac:NaN,allLeftBuilding:false,unresolvedInside:1}]);
 expect(Number.isNaN(s.tEvac.mean)).toBe(true);expect(s.tEvac.n).toBe(2);expect(s.tEvac.nValid).toBe(1);expect(s.pMeet.p).toBe(.5);
 const inconsistent=batchStats('test',[{...common,allLeftBuilding:false,unresolvedInside:1}]);
 expect(inconsistent.pMeet.p).toBe(0);expect(Number.isNaN(inconsistent.tEvac.mean)).toBe(true);
});
