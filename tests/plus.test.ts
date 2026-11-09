import {describe,it,expect} from 'vitest';
import {BAILEY_HALL as geo,slotId} from '../src/geometry/BaileyHall';
import {defaultConfig} from '../src/simulation/Params';
import {PlusSimulation} from '../src/plus/PlusSimulation';
import {LiteSimulation} from '../src/lite/LiteSimulation';
import {plusDefaults} from '../src/plus/Config';
import {installationOverlay,barrierGeometry,signWarnings} from '../src/plus/Installations';
import {SignVisibility} from '../src/simulation/SignVisibility';
import {stateFor} from '../src/plus/State';
import {EXIT_GROUPS} from '../src/geometry/types';
import {fixture} from '../scripts/movement-bench';
import {PlusMovement} from '../src/plus/PlusMovement';
const config=()=>{const c=defaultConfig();c.plus=plusDefaults();c.adaptive.agents=true;return c;};
describe('A-Lite+ physical interventions and instruction semantics',()=>{
 it('rejects a floor strip whose endpoints are in a corridor but whose segment crosses a wall',()=>{
  const l={...geo.links.find(l=>l.kind==='corridor')!,id:'elbow',width:1.2,pts:[[0,0],[4,0],[4,4]] as [number,number][]};
  const g={...geo,links:[l]},s={id:'bend',x:0,y:0,floor:l.floor,facingDegrees:0,exit:'FOYER' as const,enabled:true,mode:'static' as const,activation:0,range:8,halfAngle:90,detection:.77,acceptance:.8,strip:{linkId:l.id,points:[[0,0],[4,4]] as [number,number][]}};
  expect(signWarnings(g,[s])).toContain('bend: strip must stay inside its existing non-row walkway');
  s.strip.points=[[0,0],[4,0],[4,4]];expect(signWarnings(g,[s])).toEqual([]);
  s.strip.points=[[0,.6],[4,.6],[4,4]];expect(signWarnings(g,[s])).toEqual([]);
  s.detection=NaN;expect(signWarnings(g,[s])).toContain('bend: invalid visibility or probability');
 });
 it('rejects an angled barrier that extends longitudinally beyond its slot',()=>{
  const c=config(),slot=slotId(geo,'W1'),g=structuredClone(geo),l=g.links.find(l=>l.id===slot)!;
  l.pts=[[0,0],[.25,0]];c.plus!.barriers=[{slot,enabled:true,type:'belt',length:1,angle:45}];
  expect(()=>installationOverlay(g,c)).toThrow(/footprint extends past/);
 });
 it('instantiates every requested coverage manager, rather than silently keeping six posts',()=>{for(const count of [6,8,10,12,18]){const c=config();c.crowdManagers.placement='coverage';c.crowdManagers.count=count;const s=new PlusSimulation(geo,c);expect(s.guidance.cms).toHaveLength(count);expect(new Set(s.guidance.cms.map(m=>m.post.id)).size).toBe(count);expect(s.agents).toHaveLength(1329);}});
 it('preserves audience draws and original geometry; refuses seatway shortcuts',()=>{const c=config();c.crowdManagers.vacatedRowGuidance=true;const s=new PlusSimulation(geo,c),old=new LiteSimulation(geo,defaultConfig());expect(s.cfg.crowdManagers.vacatedRowGuidance).toBe(false);expect(s.agents).toHaveLength(1329);expect(s.agents.map(a=>[a.seat,a.v0,a.uCM,a.group])).toEqual(old.agents.map(a=>[a.seat,a.v0,a.uCM,a.group]));expect(s.graph.links.length).toBe(old.graph.links.length);});
 it('acceptance is persistent and independent of trust; accepted destinations become paths',()=>{const s=new PlusSimulation(geo,config()),a=s.agents.find(a=>!a.wheelchair&&a.uCM<.8)!;a.trust=.2;expect(s.managerAcceptance(a)).toBe(.8);a.trust=1.2;expect(s.managerAcceptance(a)).toBe(.8);s.managerMessage(a,1,true,0);expect(a.targetGroup).toBe(1);expect(a.pathValid).toBe(true);s.routing.chooseExit(a,'event');expect(a.targetGroup).toBe(1);expect(stateFor(s).people[a.id].command).toBe(1);});
 it('mid-link intent changes cannot change the occupied link, distance or coordinates',()=>{const s=new PlusSimulation(geo,config()),a=s.agents.find(a=>!a.wheelchair)!;const l=s.graph.links.find(l=>l.kind==='corridor')!;s.movement.placeAt(a,l.idx,1,l.len/2);const before=[a.link,a.sDir,a.x,a.y];s.routing.commit(a,0,'test-sign');expect([a.link,a.sDir,a.x,a.y]).toEqual(before);expect(a.pathNodes[0]).toBe(l.b);expect(stateFor(s).people[a.id].pending).toBe(true);});
 it('barriers consume physical width and never add capacity; narrow bypasses and exit placement rejected',()=>{const c=config(),slot=slotId(geo,'W1'),l=geo.links.find(l=>l.id===slot)!;c.plus!.barriers=[{slot,enabled:true,type:'belt',length:l.width-1.2,angle:90}];const o=installationOverlay(geo,c);expect(o.geo.links.find(l=>l.id===slot)!.width).toBeCloseTo(1.2);expect(o.cfg.ropePenalty).toBe(0);expect(geo.links.find(l=>l.id===slot)!.width).toBe(l.width);const base=new PlusSimulation(geo,config()),s=new PlusSimulation(geo,c),li=s.graph.linkByIdOrThrow(slot);expect(s.movement.capacity[li]).toBeLessThanOrEqual(base.movement.capacity[li]);c.plus!.barriers[0].length=l.width-.7;expect(()=>installationOverlay(geo,c)).toThrow(/1.1 m/);c.plus!.barriers[0].slot='F3';expect(()=>installationOverlay(geo,c)).toThrow(/slot/);});
 it('open rails do not occlude; opaque closures do',()=>{const c=config(),slot=slotId(geo,'W1'),l=geo.links.find(l=>l.id===slot)!;c.plus!.barriers=[{slot,enabled:true,type:'open-rail',length:l.width,angle:90}];const v=barrierGeometry(geo,c.plus!.barriers[0]);const custom={...geo,walls:[]};const o=installationOverlay(custom,c),sp={range:100,halfAngleDegrees:180,occlusion:true,signs:[]};const p=l.pts[0],q=l.pts.at(-1)!;expect(new SignVisibility(o.geo,sp,o.cfg).visible(...p,v.floor,...q,v.floor)).toBe(true);o.cfg.plus!.barriers[0].type='opaque-panel';expect(new SignVisibility(o.geo,sp,o.cfg).visible(...p,v.floor,...q,v.floor)).toBe(false);});
 it('LED notice and acceptance are separate persistent events, and exported layout round trips',()=>{const c=config(),seat=geo.seats[40];c.led.enabled=true;c.plus!.signs=[{id:'unit',x:seat.x,y:seat.y,floor:1,facingDegrees:0,exit:EXIT_GROUPS[1],enabled:true,mode:'static',activation:3,range:2,halfAngle:180,detection:1,acceptance:0}];const s=new PlusSimulation(geo,JSON.parse(JSON.stringify(c))),a=s.agents.find(a=>a.seat===40)!;s.t=2;s.guidance.ledPerceive(a);expect(a.ledSeen).toBe(false);s.t=3;s.guidance.ledPerceive(a);expect(a.ledSeen).toBe(true);expect(a.knownExits&2).toBe(2);expect(a.ledGroup).toBe(-1);const n=stateFor(s).counts['led-noticed'];s.guidance.ledPerceive(a);expect(stateFor(s).counts['led-noticed']).toBe(n);expect(s.cfg.plus!.signs).toEqual(c.plus!.signs);});
 it('wall occlusion and floors restrict local observations',()=>{const s=new PlusSimulation(geo,config());expect(s.canObserve({x:0,y:0,floor:1},0,0,2)).toBe(false);expect(s.canObserve({x:0,y:0,floor:1},100,100,1)).toBe(false);const v=new SignVisibility({...geo,walls:[{id:'test',kind:'wall',floor:1,pts:[[0,-2],[0,2]]}]},{range:10,halfAngleDegrees:180,occlusion:true,signs:[]},s.cfg);expect(v.visible(-1,0,1,1,0,1)).toBe(false);});
});

describe('A-Lite+ delayed and local information',()=>{
 it('a large observed cost change triggers an immediate mid-link review and a feasible next-node route',()=>{
  const s=new PlusSimulation(geo,config()),a=s.agents.find(a=>!a.wheelchair&&a.group<0)!,l=s.graph.links.find(l=>l.kind==='corridor')!;
  s.movement.placeAt(a,l.idx,1,l.len/2);a.targetGroup=0;a.knownExits=127;a.lastDecisionT=0;a.lastSwitchT=-Infinity;s.t=50;
  // Inject a controlled measured-delay shock at the cost boundary, retaining the real
  // route search, utility engine and path construction. Visibility is tested separately.
  const search=(s.routing as any).search.bind(s.routing);
  (s.routing as any).search=(...args:any[])=>{const r=search(...args);r.cost[0]+=900;return r;};
  const before=[a.link,a.sDir,a.x,a.y];s.routing.observe(a);
  expect(a.targetGroup).not.toBe(0);expect([a.link,a.sDir,a.x,a.y]).toEqual(before);
  expect(a.pathNodes[0]).toBe(l.b);expect(stateFor(s).people[a.id].pending).toBe(true);
  expect(stateFor(s).counts['switch-observation']).toBeGreaterThan(0);
 });
 it('dynamic signs wait for controller delivery and hold a public message',()=>{const c=config();c.led.enabled=true;c.plus!.controllerDelay=3;c.plus!.controllerHold=20;c.plus!.controllerMargin=0;const seat=geo.seats[0];c.plus!.signs=[{id:'dynamic',x:seat.x,y:seat.y,floor:1,facingDegrees:0,exit:'BAL_NE',enabled:true,mode:'dynamic',activation:0,range:8,halfAngle:180,detection:1,acceptance:1}];const s=new PlusSimulation(geo,c);for(const m of s.guidance.cms)m.tActive=0;const item=s.guidance.installations.find(i=>i.sign.id==='dynamic')!;
 s.t=1;s.guidance.step(1);expect(item.sign.exit).toBe('BAL_NE');s.t=3;s.guidance.step(1);expect(item.sign.exit).toBe('BAL_NE');s.t=4;s.guidance.step(1);expect(item.version).toBe(1);const chosen=item.sign.exit;s.t=10;s.guidance.step(1);expect(item.sign.exit).toBe(chosen);expect(item.lastChange).toBe(4);
 });
 it('people cannot read a distant gate queue',()=>{const s=new PlusSimulation(geo,config()),a=s.agents[0],l=s.graph.links.find(l=>l.gate&&Math.hypot(s.graph.nodes[l.a].x-a.x,s.graph.nodes[l.a].y-a.y)>s.visibilityRange)!;s.gates.queueNow[l.idx]=999;expect(s.perceivedGateQueue(a,l.idx)).toBe(0);});
 it('local group pace releases a distant slow member without changing gate service',()=>{const c=config(),s=new PlusSimulation(geo,c),group=s.groups.find(ids=>ids.length>1)!,a=s.agents[group[0]],b=s.agents[group[1]],l=s.graph.links.find(l=>l.kind==='corridor')!;a.v0=1.2;b.v0=.5;s.movement.placeAt(a,l.idx,1,0);b.link=-1;const local=(s.movement as any).speed(a,l.idx,1);s.cfg.plus!.groupPace='permanent';s.movement.groupPace[a.id]=.5;const permanent=(s.movement as any).speed(a,l.idx,1);expect(local).toBeGreaterThan(permanent);s.cfg.plus!.groupPace='local';b.link=l.idx;b.dir=1;b.sDir=0;expect((s.movement as any).speed(a,l.idx,1)).toBeCloseTo(permanent);});
});

describe('indexed sightline verification',()=>{
 it('matches brute-force wall intersection for seeded rays and cell boundaries',async()=>{const {blocksSight}=await import('../src/simulation/SignVisibility');const v=new SignVisibility(geo,{range:100,halfAngleDegrees:180,occlusion:true,signs:[]},config());const walls=(v as any).segments;let z=1731;const random=()=>{z=(Math.imul(z,1664525)+1013904223)>>>0;return z/4294967296;};for(let i=0;i<2000;i++){const x=i<100?3*Math.floor(random()*15-7):random()*50-25,y=random()*60-25,sx=i<100?x:random()*50-25,sy=random()*60-25,floor=i%2+1;const brute=!walls.some((w:any)=>w.floor===floor&&blocksSight(x,y,sx,sy,w));expect(v.visible(x,y,floor,sx,sy,floor)).toBe(brute);}});
});

it('limited passing uses an empty wide-corridor lane without adding service or storage',()=>{
 for(const width of [1.1,2.4]){
  const s=fixture([20,20],2,.1);s.cfg.plus=plusDefaults();s.graph.links[0].lanes=2;s.graph.links[0].width=width;
  const m=new PlusMovement(s);s.movement=m;s.agents[0].v0=.6;s.agents[1].v0=1.2;
  m.placeAt(s.agents[0],0,1,0);m.placeAt(s.agents[1],0,1,0);
  m.lanes[0][0][1]=[];m.lanes[0][0][0].push(1);s.agents[1].lane=0;
  const rate=m.capacity[0];s.t=.1;m.step(.1);
  expect(s.agents[1].lane).toBe(width>=1.8?1:0);expect(m.capacity[0]).toBe(rate);
  expect(m.linkCount[0]).toBe(2);expect(m.discharged[0]).toBe(0);
 }
});
