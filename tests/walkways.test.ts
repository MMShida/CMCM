import {it,expect} from 'vitest';
import {auditWalkways} from '../scripts/audit-walkways';
import {placementCases} from '../scripts/placement-cases';
import {BAILEY_HALL} from '../src/geometry/BaileyHall';
import {SimulationEngine} from '../src/simulation/SimulationEngine';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {NavGraph} from '../src/geometry/NavigationGraph';
import {walkwayPoint} from '../src/components/WalkwayInterpolation';

it('A and A-Lite clear only through connected walkways, never through other seating rows',()=>{
 const cases=placementCases();
 for(const Engine of [SimulationEngine,LiteSimulation])for(const barrier of ['rope1','hard1']){
  const cfg=structuredClone(cases.find(c=>c.id===`coverage-decision-${barrier}`)!.cfg);
  cfg.blocked.links=['F3'];cfg.blocked.knowledge='discovery';
  const sim=new Engine(BAILEY_HALL,cfg,1466857514),r=auditWalkways(sim);
  expect(r.violations).toBe(0);expect(r.wheelchairs).toBe(3);expect(r.transitions).toBeGreaterThan(10000);
  expect(r.seatwayChecks).toBeGreaterThan(10000);expect(sim.gates.passes[sim.graph.linkByIdOrThrow('F3')]).toBe(0);
 }
},60000);

it('animation follows bends and junctions instead of drawing a chord across the seats',()=>{
 const nodes=[{id:'a',x:0,y:0,floor:1 as const,kind:'junction' as const},{id:'b',x:10,y:10,floor:1 as const,kind:'junction' as const},{id:'c',x:20,y:10,floor:1 as const,kind:'junction' as const}];
 const g=new NavGraph({...BAILEY_HALL,nodes,links:[{id:'curve',a:'a',b:'b',floor:1,width:1,kind:'walkway',pts:[[0,0],[10,0],[10,10]]},{id:'next',a:'b',b:'c',floor:1,width:1,kind:'walkway',pts:[[10,10],[20,10]]}],seats:[]});
 const p=new Float64Array(2);
 expect(walkwayPoint(g,0,0,0,20,0,0,.5,p)).toBe(true);expect([...p]).toEqual([10,0]);
 walkwayPoint(g,0,1,15,5,0,0,.5,p);expect([...p]).toEqual([10,10]);
 walkwayPoint(g,0,0,20,0,0,0,.5,p);expect([...p]).toEqual([10,0]);
});
