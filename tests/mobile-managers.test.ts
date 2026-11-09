import {it,expect} from 'vitest';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import {defaultConfig} from '../src/simulation/Params';
import {plusDefaults} from '../src/plus/Config';
import {PlusSimulation} from '../src/plus/PlusSimulation';

function setup(){
  const c=defaultConfig();c.plus=plusDefaults();c.crowdManagers.count=1;c.crowdManagers.activationMedian=.001;
  const l=geo.links.find(l=>l.kind==='corridor'&&!l.gate&&!l.exterior&&l.width>=1.8&&l.pts.length===2)!,n=geo.nodes.find(n=>n.id===l.a)!;
  c.plus.managerPosts=[{id:'PATROL1',x:n.x,y:n.y,floor:n.floor,label:'Explicit test post',zones:[]}];
  c.plus.managerPatrols=[{manager:0,startNode:n.id,links:[l.id],start:10,speed:1,dwell:5}];return {c,l,n};
}
it('patrols respect activation, finite speed, empty-link restriction, adjacency and dwell',()=>{
  const {c,l,n}=setup(),s=new PlusSimulation(geo,c),m=s.guidance.mobile,r=m.routes[0];
  s.t=9;m.step(.5);expect(r.walked).toBe(0);
  s.t=10;m.step(.5);expect(r.walked).toBe(.5);expect(Math.hypot(r.cm.post.x-n.x,r.cm.post.y-n.y)).toBeCloseTo(.5);
  const li=s.graph.linkByIdOrThrow(l.id),before=[r.cm.post.x,r.cm.post.y];s.movement.linkCount[li]=1;m.step(.5);
  expect([r.cm.post.x,r.cm.post.y]).toEqual(before);expect(r.blockedSeconds).toBe(.5);s.movement.linkCount[li]=0;
  while(!r.reverse){s.t+=.1;m.step(.1);}const end=s.graph.nodes[r.nodes[1]];
  expect(r.cm.post.x).toBeCloseTo(end.x);expect(r.cm.post.y).toBeCloseTo(end.y);
  const walked=r.walked;m.step(.1);expect(r.walked).toBe(walked);expect(s.agents).toHaveLength(1329);
  expect(geo.crowdManagerPosts.some(p=>p.id==='PATROL1')).toBe(false);
});
it('refuses patrol snapping, seat rows and unconnected routes',()=>{
  const {c}=setup();c.plus!.managerPosts![0].x+=.2;expect(()=>new PlusSimulation(geo,c)).toThrow(/no snapping/);
  const b=setup().c;b.plus!.managerPatrols![0].links=[geo.links.find(l=>l.kind==='row')!.id];expect(()=>new PlusSimulation(geo,b)).toThrow(/connected/);
});
