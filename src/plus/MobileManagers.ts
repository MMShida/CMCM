import type {SimulationEngine} from '../simulation/SimulationEngine';
import type {CrowdManagerRT} from '../simulation/Guidance';
import type {ManagerPatrol} from './Config';
import {event} from './State';
import {MinHeap} from '../geometry/NavigationGraph';

/** A conservative information-coverage sensitivity, not body-resolved staff transport.
 * Patrols follow connected wide level walkways and STOP while their current/next
 * link contains any audience member. No gates, stairs, rows or occupied-link passing.
 * Staff bodies, as for inherited fixed posts, do not displace audience storage.
 */
export class MobileManagers {
  readonly routes:{spec:ManagerPatrol;cm:CrowdManagerRT;links:number[];nodes:number[];index:number;reverse:boolean;distance:number;waitUntil:number;walked:number;blockedSeconds:number}[]=[];
  constructor(private sim:SimulationEngine,cms:CrowdManagerRT[]){
    for(const spec of sim.cfg.plus?.managerPatrols??[]){
      const cm=cms[spec.manager],g=sim.graph,start=g.nodes.findIndex(n=>n.id===spec.startNode);
      if(!cm||start<0||!spec.links.length||spec.speed<=0||spec.speed>1.4||spec.start<0||spec.dwell<0||!Number.isFinite(spec.speed+spec.start+spec.dwell))throw Error('Invalid manager patrol.');
      if(this.routes.some(r=>r.cm===cm))throw Error('Duplicate manager patrol.');
      const n=g.nodes[start];if(Math.hypot(cm.post.x-n.x,cm.post.y-n.y)>1e-6||cm.post.floor!==sim.nodeFloorDisp[start])throw Error('Patrol must start at its explicit post node; no snapping or teleportation.');
      const nodes=[start],links:number[]=[];let u=start;
      for(const id of spec.links){const li=g.linkByIdOrThrow(id),l=g.links[li];
        if(l.isRow||l.gate||l.prohibited||l.exterior||l.kind==='stair'||l.width<1.8||sim.barrierLinks.includes(li)||sim.blockedLinks.includes(li)||!(l.a===u||l.b===u))throw Error('Patrol must follow connected, open, wide, level non-gate walkways.');
        const v=l.a===u?l.b:l.a;if(sim.nodeFloorDisp[v]!==cm.post.floor)throw Error('Patrol cannot change floor.');
        links.push(li);nodes.push(v);u=v;
      }
      this.routes.push({spec,cm,links,nodes,index:0,reverse:false,distance:0,waitUntil:Math.max(spec.start,cm.tActive),walked:0,blockedSeconds:0});
    }
  }
  step(dt:number){let changed=false;const sim=this.sim,g=sim.graph;
    for(const r of this.routes){if(sim.t<r.waitUntil)continue;const li=r.links[r.index],l=g.links[li];
      if(sim.movement.closed[li]||sim.movement.linkCount[li]>0){r.blockedSeconds+=dt;continue;}
      // One link per step, with exact polyline interpolation and finite travel budget.
      const d=Math.min(r.spec.speed*dt,l.len-r.distance);r.distance+=d;r.walked+=d;
      const from=r.nodes[r.reverse?r.index+1:r.index],forward=from===l.a;
      const source=sim.geo.links[li].pts,lengths=source.slice(1).map((p,i)=>Math.hypot(p[0]-source[i][0],p[1]-source[i][1]));
      const total=lengths.reduce((a,b)=>a+b,0);let s=(forward?r.distance:l.len-r.distance)/l.len*total;
      for(let k=0;k<lengths.length;k++){if(s<=lengths[k]+1e-9||k===lengths.length-1){const f=Math.min(1,s/(lengths[k]||1)),a=source[k],b=source[k+1];r.cm.post.x=a[0]+f*(b[0]-a[0]);r.cm.post.y=a[1]+f*(b[1]-a[1]);break;}s-=lengths[k];}
      changed=changed||d>0;
      if(r.distance>=l.len-1e-9){r.distance=0;const at=r.nodes[r.reverse?r.index:r.index+1];
        event(sim,{agent:-1,kind:'manager-arrival',source:`CM${r.cm.idx+1}`,exit:-1,reason:`Patrol arrival at ${g.nodes[at].id}; walked ${r.walked.toFixed(2)} m`});
        if(!r.reverse&&r.index===r.links.length-1){r.reverse=true;r.waitUntil=sim.t+r.spec.dwell;}
        else if(r.reverse&&r.index===0){r.reverse=false;r.waitUntil=sim.t+r.spec.dwell;}
        else r.index+=r.reverse?-1:1;
      }
    }return changed;
  }
  summary(){return this.routes.map(r=>({manager:r.cm.idx,walked:r.walked,blockedSeconds:r.blockedSeconds,x:r.cm.post.x,y:r.cm.post.y,links:r.spec.links}));}
  /** Hearing distance starts at both ends of the actually occupied link, never
   * at an unrelated nearest junction across a wall. */
  anchors(){const out=new Map<number,{node:number;dist:Float32Array}>(),g=this.sim.graph;
    for(const r of this.routes){const l=g.links[r.links[r.index]],from=r.nodes[r.reverse?r.index+1:r.index],s=from===l.a?r.distance:l.len-r.distance;
      const dist=new Float32Array(g.nodes.length).fill(Infinity),heap=new MinHeap();dist[l.a]=s;dist[l.b]=l.len-s;heap.push(dist[l.a],l.a);heap.push(dist[l.b],l.b);
      while(heap.size){const [d,u]=heap.pop();if(d>dist[u])continue;for(const e of g.adj[u]){if(g.links[e.link].prohibited)continue;const next=Math.fround(d+g.links[e.link].len);if(next<dist[e.other]){dist[e.other]=next;heap.push(next,e.other);}}}
      out.set(r.cm.idx,{node:s<l.len/2?l.a:l.b,dist});
    }return out;
  }
}
