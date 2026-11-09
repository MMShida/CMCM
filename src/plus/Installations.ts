import type {GeometryData} from '../geometry/types';
import {NavGraph} from '../geometry/NavigationGraph';
import {OUTWARD_ONLY} from '../simulation/Routing';
import type {SimConfig} from '../simulation/Params';
import type {PhysicalBarrier,PhysicalSign} from './Config';

export function barrierGeometry(geo:GeometryData,b:PhysicalBarrier){
  const l=geo.links.find(l=>l.id===b.slot);if(!l)throw Error(`Unknown slot ${b.slot}`);
  const p=l.pts[0],q=l.pts[l.pts.length-1],axis=Math.atan2(q[1]-p[1],q[0]-p[0]),angle=axis+b.angle*Math.PI/180;
  const x=(p[0]+q[0])/2,y=(p[1]+q[1])/2;
  const span=Math.abs(b.length*Math.sin(b.angle*Math.PI/180));
  // A barrier anchored at one side leaves ONE bypass channel, not two fictional half lanes.
  const gap=Math.max(0,l.width-span);
  const nx=-Math.sin(axis),ny=Math.cos(axis),cx=x-nx*gap/2,cy=y-ny*gap/2;
  return {gap,width:l.width,span,points:[[cx-Math.cos(angle)*b.length/2,cy-Math.sin(angle)*b.length/2],[cx+Math.cos(angle)*b.length/2,cy+Math.sin(angle)*b.length/2]] as [number,number][],floor:l.floor};
}
function pathDistance(x:number,y:number,pts:[number,number][]){let best=Infinity;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1],u=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(x-a[0]-u*dx,y-a[1]-u*dy));}return best;}
/** Exact segment coverage by the union of walkway-segment capsules. Checking only
 * vertices would allow a drawn strip to cut across the inside of an L-shaped wall. */
function stripInside(points:[number,number][],walk:[number,number][],radius:number){
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],dd=dx*dx+dy*dy;
    if(dd<1e-18){if(pathDistance(...a,walk)>radius)return false;continue;}
    const intervals:[number,number][]=[];
    for(let j=1;j<walk.length;j++){
      const p=walk[j-1],q=walk[j],len=Math.hypot(q[0]-p[0],q[1]-p[1]);
      for(const e of [p,q]){const x=a[0]-e[0],y=a[1]-e[1],dot=x*dx+y*dy,disc=dot*dot-dd*(x*x+y*y-radius*radius);
        if(disc>=0){const root=Math.sqrt(disc);intervals.push([Math.max(0,(-dot-root)/dd),Math.min(1,(-dot+root)/dd)]);}}
      if(len<1e-12)continue;const ux=(q[0]-p[0])/len,uy=(q[1]-p[1])/len;let lo=0,hi=1;
      const clip=(v:number,slope:number,min:number,max:number)=>{
        if(Math.abs(slope)<1e-12){if(v<min||v>max)hi=-1;return;}
        const t0=(min-v)/slope,t1=(max-v)/slope;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));
      };
      clip((a[0]-p[0])*ux+(a[1]-p[1])*uy,dx*ux+dy*uy,0,len);
      clip((a[1]-p[1])*ux-(a[0]-p[0])*uy,dy*ux-dx*uy,-radius,radius);
      if(lo<=hi)intervals.push([lo,hi]);
    }
    let covered=0;for(const [lo,hi] of intervals.sort((a,b)=>a[0]-b[0])){if(hi<lo)continue;if(lo>covered+1e-8)return false;covered=Math.max(covered,hi);if(covered>=1-1e-8)break;}
    if(covered<1-1e-8)return false;
  }return true;
}
export function signWarnings(geo:GeometryData,signs:PhysicalSign[]):string[]{const w:string[]=[];for(const s of signs){
  if(!s.enabled)continue;
  if(![s.x,s.y,s.facingDegrees,s.range,s.activation,s.halfAngle,s.detection,s.acceptance].every(Number.isFinite)||s.range<=0||s.activation<0||s.halfAngle<=0||s.halfAngle>180||s.detection<0||s.detection>1||s.acceptance<0||s.acceptance>1)w.push(`${s.id}: invalid visibility or probability`);
  if(![1,2].includes(s.floor))w.push(`${s.id}: signs must be on an occupied floor`);
  if(s.strip){const l=geo.links.find(l=>l.id===s.strip!.linkId);if(!l||l.kind==='row'||l.floor!==s.floor||s.strip.points.length<2||s.strip.points.some(p=>!Number.isFinite(p[0]+p[1]))||!stripInside(s.strip.points,l.pts,l.width/2))w.push(`${s.id}: strip must stay inside its existing non-row walkway`);}
  for(const q of signs)if(q.enabled&&q.id>s.id&&q.floor===s.floor&&q.exit!==s.exit&&Math.hypot(q.x-s.x,q.y-s.y)<2)w.push(`${s.id}/${q.id}: nearby conflicting messages`);
}return w;}
export function installationOverlay(geo:GeometryData,cfg:SimConfig):{geo:GeometryData;cfg:SimConfig;warnings:string[]}{
  const c=structuredClone(cfg),g=structuredClone(geo),errors:string[]=[],warnings:string[]=[];
  if(c.plus?.managerPosts){
    const posts=c.plus.managerPosts;
    if(new Set(posts.map(p=>p.id)).size!==posts.length||posts.some(p=>!Number.isFinite(p.x+p.y)||![1,2].includes(p.floor)))throw Error('Invalid or duplicate explicit manager posts.');
    g.crowdManagerPosts=structuredClone(posts);c.crowdManagers.placement='existing';
    if(c.crowdManagers.count>posts.length)throw Error('Requested managers exceed the explicit posts.');
  }
  c.barriers=[];c.barrierTypes={};c.ropePenalty=0;
  const used=new Set<string>();
  for(const b of c.plus?.barriers??[]){if(!b.enabled)continue;const l=g.links.find(l=>l.id===b.slot);
    if(!l||!l.barrierSlot||l.exterior||l.gate||l.kind==='row'){errors.push(`${b.slot}: not an approved corridor slot`);continue;}
    if(used.has(b.slot)){errors.push(`${b.slot}: duplicate barrier`);continue;}used.add(b.slot);
    if(!Number.isFinite(b.length+b.angle)||b.length<=0||b.angle<45||b.angle>135){errors.push(`${b.slot}: length must be positive and angle 45–135 degrees`);continue;}
    const v=barrierGeometry(geo,b);
    if(v.span>v.width+1e-6){errors.push(`${b.slot}: barrier extends beyond corridor`);continue;}
    const ends=l.pts,slotLength=Math.hypot(ends.at(-1)![0]-ends[0][0],ends.at(-1)![1]-ends[0][1]);
    if(Math.abs(b.length*Math.cos(b.angle*Math.PI/180))>slotLength+1e-6){errors.push(`${b.slot}: barrier footprint extends past the installation slot`);continue;}
    if(v.gap>.01&&v.gap<1.1){errors.push(`${b.slot}: bypass below 1.1 m research screening minimum`);continue;}
    if(v.gap<=.01){c.barriers.push(b.slot);c.barrierTypes[b.slot]='hard-panel';}
    else{l.width=v.gap;l.lanes=Math.max(1,Math.floor(v.gap/c.movement.laneWidth));
      const a=l.pts[0],z=l.pts[l.pts.length-1],len=Math.hypot(z[0]-a[0],z[1]-a[1]);
      // Explicit bypass centreline; endpoints remain the same physical junctions.
      // The barrier is anchored on the negative-normal side, leaving the positive side open.
      const x=(a[0]+z[0])/2-(z[1]-a[1])/len*v.span/2,y=(a[1]+z[1])/2+(z[0]-a[0])/len*v.span/2;
      l.pts=[a,[x,y],z];
    }
    if(b.type==='opaque-panel')warnings.push(`${b.slot}: opaque historical comparator, obscures sightlines`);
  }
  warnings.push(...signWarnings(g,c.plus?.signs??[]));
  errors.push(...warnings.filter(w=>w.includes('invalid')||w.includes('must')));
  if(errors.length)throw Error(errors.join('; '));
  const nav=new NavGraph(g,c.movement.laneWidth),closed=new Set([...c.barriers,...c.blocked.links]);
  const patrolManagers=new Set<number>();
  for(const r of c.plus?.managerPatrols??[]){
    const p=c.plus?.managerPosts?.[r.manager],ni=nav.nodes.findIndex(n=>n.id===r.startNode),n=nav.nodes[ni];
    if(!p||!n||patrolManagers.has(r.manager)||r.manager>=c.crowdManagers.count||!r.links.length||!Number.isFinite(r.speed+r.start+r.dwell)||r.speed<=0||r.speed>1.4||r.start<0||r.dwell<0)throw Error('Invalid or duplicate manager patrol.');
    if(Math.hypot(p.x-n.x,p.y-n.y)>1e-6||p.floor!==n.floor)throw Error('Patrol must start at its explicit post node; no snapping or teleportation.');
    patrolManagers.add(r.manager);let u=ni;
    for(const id of r.links){const l=nav.links.find(l=>l.id===id);
      if(!l||l.isRow||l.gate||l.prohibited||l.exterior||l.kind==='stair'||l.width<1.8||closed.has(id)||!(l.a===u||l.b===u))throw Error('Patrol must follow connected, open, wide, level non-gate walkways.');
      u=l.a===u?l.b:l.a;if(nav.nodes[u].floor!==p.floor)throw Error('Patrol cannot change floor.');
    }
  }
  // Reverse reachability, preserving accessibility, outward-only links and no storey climb.
  for(const wheelchair of [false,true]){
    const seen=new Set<number>(),queue=nav.nodes.map((n,i)=>n.kind==='safe'||(wheelchair&&n.kind==='refuge')?i:-1).filter(i=>i>=0);
    const reverse:number[][]=nav.nodes.map(()=>[]);
    for(let u=0;u<nav.nodes.length;u++)for(const e of nav.adj[u]){const l=nav.links[e.link];
      if(l.isRow||closed.has(l.id)||l.prohibited||(wheelchair&&!l.accessible)||nav.climbs(e.link,e.dir)||(e.dir<0&&OUTWARD_ONLY.test(l.id)))continue;
      reverse[e.other].push(u);
    }
    for(const n of queue)seen.add(n);
    for(let j=0;j<queue.length;j++)for(const u of reverse[queue[j]])if(!seen.has(u)){seen.add(u);queue.push(u);}
    for(const seat of g.seats){if(wheelchair&&!seat.wheelchair)continue;const l=nav.links[nav.linkByIdOrThrow(seat.link)];if(!seen.has(l.a)&&!seen.has(l.b))errors.push(`${seat.id}: ${wheelchair?'accessible ':''}escape disconnected`);}
  }
  if(errors.length)throw Error(errors.slice(0,8).join('; '));
  return {geo:g,cfg:c,warnings};
}
