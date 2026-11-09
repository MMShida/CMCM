/** A-Lite: finite-storage FIFO transport on A's ORIGINAL, uncontracted spatial graph.
 * No NetworkSimulation code or contracted network is used. Physical service is at
 * link discharge; door/stair admission also requires the original gate credit.
 * This is a queue abstraction: displayed circles are not collision-resolved bodies.
 */
import {MovementSystem} from '../simulation/Movement';
import type {SimulationEngine} from '../simulation/SimulationEngine';
import type {Agent} from '../simulation/Agent';
import {ST} from '../simulation/Agent';

export class LiteMovement extends MovementSystem {
  readonly credit:Float64Array;
  readonly capacity:Float64Array;
  readonly discharged:Int32Array;
  readonly serviceIntegral:Float64Array;
  readonly ready:Float64Array;
  readonly entered:Float64Array;
  readonly groupPace:Float64Array;
  readonly waitSeconds:Float64Array;
  exchanges=0;
  peakAverageDensity=0;
  peakAverageLink=-1;
  private sequence=0;
  constructor(sim:SimulationEngine){
    super(sim);const n=this.g.links.length;
    this.credit=new Float64Array(2*n).fill(1);this.capacity=new Float64Array(n);this.discharged=new Int32Array(2*n);this.serviceIntegral=new Float64Array(2*n);
    this.ready=new Float64Array(sim.agents.length).fill(Infinity);this.entered=new Float64Array(sim.agents.length);this.waitSeconds=new Float64Array(sim.agents.length);
    this.groupPace=Float64Array.from(sim.agents.map(a=>a.group<0?a.v0:Math.min(...sim.groups[a.group].map(id=>sim.agents[id].v0))));
    for(const L of this.g.links){
      let v=L.isRow?sim.cfg.movement.rowSpeed:sim.cfg.population.speedMean;
      if(L.isStair)v*=sim.cfg.population.stairRatio;
      v*=sim.envSpeed;
      this.capacity[L.idx]=L.lanes*v/(2*sim.cfg.population.radiusMean+v*sim.cfg.movement.timeHeadway);
      // Row bodies occupy a single seatway, irrespective of the area-density cap.
      if(L.isRow)this.occCap[L.idx]=Math.max(1,Math.floor(L.len/(2*sim.cfg.population.radiusMean)));
    }
  }
  protected speed(a:Agent,li:number,dir:number){
    const L=this.g.links[li];let v=(a.group>=0&&!this.sim.cfg.population.groupMeetOutside?this.groupPace[a.id]:a.v0)*this.sim.envSpeed;
    if(L.isStair){v*=((L.drop>0&&dir<0)||(L.drop<0&&dir>0))?a.stairRatioUp:a.stairRatio;if(L.outdoorStair)v*=this.sim.cfg.environment.outdoorStairFactor;}
    if(L.isRow)v=Math.min(v,this.sim.cfg.movement.rowSpeed);
    return Math.max(.05,v);
  }
  protected enter(a:Agent,li:number,dir:1|-1,s:number){
    const queues=this.lanes[li][dir>0?0:1];
    const available=this.g.links[li].isRow?1:this.allowedLanes(li,dir>0?0:1);
    let lane=0;for(let k=1;k<available;k++)if(queues[k].length<queues[lane].length)lane=k;
    a.link=li;a.dir=dir;a.lane=lane;a.sDir=s;a.v=this.speed(a,li,dir);a.lastNode=-1;a.pendingNext=-1;a.waitTarget=-1;
    this.pushTail(li,dir>0?0:1,lane,a.id);this.entered[a.id]=this.sequence++;
    this.ready[a.id]=this.sim.t+(this.g.links[li].len-s)/a.v;
  }
  override placeAt(a:Agent,li:number,dir:1|-1,s:number){
    if(this.linkCount[li]>=this.occCap[li])return false;
    this.enter(a,li,dir,s);return true;
  }
  override tryEnterRow(a:Agent){
    const li=this.sim.seatLink[a.id],L=this.g.links[li],seat=this.sim.geo.seats[a.seat];
    if(this.linkCount[li]>=this.occCap[li]){this.sim.movementObserver?.block(a.id,'row-storage',this.sim.cfg.movement.dt,li);return false;}
    this.enter(a,li,a.pendingRowDir,a.pendingRowDir>0?seat.s:L.len-seat.s);
    a.state=a.meetNode>=0?ST.REUNITING:ST.MOVING;if(Number.isNaN(a.tStartMove))a.tStartMove=this.sim.t;
    const slot=this.seatSlot[a.id];if(slot>=0)this.rowSeatAgent[li][slot]=-1;this.sim.progress();return true;
  }
  override step(dt:number){
    const sim=this.sim,A=sim.agents,g=this.g;
    sim.gates.refill(dt,sim.t);sim.gates.resetQueueCounts();
    const candidates:Agent[]=[];
    for(const L of g.links){
      const li=L.idx,total=this.linkCount[li];
      const rho=total/(L.len*L.width*L.geomScale);
      if(!L.isRow&&L.kind!=='outdoor'&&L.len>=1.5&&rho>this.peakAverageDensity){this.peakAverageDensity=rho;this.peakAverageLink=li;}
      for(let d=0;d<2;d++){
        const queues=this.lanes[li][d],ids=queues.flat(),idx=li*2+d;
        const share=total>0?this.dirCount[idx]/total:0;
        // Each row end drains a different portion of the seatway. Its two ends
        // are separate resources; passages instead share their cross-section.
        const c=this.capacity[li]*(L.isRow?(ids.length?1:0):share);this.credit[idx]+=c*dt;this.serviceIntegral[idx]+=c*dt;
        // FIFO by entry for passages; seatway origins join the row-end queue by arrival.
        for(const queue of queues)queue.sort((x,y)=>L.isRow?this.ready[x]-this.ready[y]||this.entered[x]-this.entered[y]:this.entered[x]-this.entered[y]);
        for(let k=0;k<ids.length;k++){
          const a=A[ids[k]],v=this.speed(a,li,a.dir);
          a.densityHere=total/(L.len*L.width*L.geomScale);
          if(this.ready[a.id]>sim.t){a.sDir=Math.max(0,L.len-(this.ready[a.id]-sim.t)*v);a.v=v;a.vDes=v;if(a.inside)a.state=ST.MOVING;sim.progress();}
          else{a.sDir=L.len;a.v=0;a.blockedTime+=dt;if(a.inside)a.state=ST.QUEUING;this.waitSeconds[a.id]+=dt;a.waitTotal+=dt;
            // Queue display is spread within the original link; it is not a body-contact model.
            const rank=queues[a.lane].indexOf(a.id);
            a.sDir=Math.max(0,L.len-rank*Math.min(.44,L.len/Math.max(1,queues[a.lane].length)));
            candidates.push(a);
            if(rank>0&&A[queues[a.lane][0]].waitTarget>=0){const w=A[queues[a.lane][0]].waitTarget;a.waitTarget=w;if(sim.gates.isGate[w]){sim.gates.queueNow[w]++;sim.gates.impatienceSum[w]+=a.impatience;sim.gates.waitSum[w]+=dt;}}
          }
        }
      }
    }
    // Deterministic FIFO among upstream queue heads, no random priority or urgency bonus.
    candidates.sort((a,b)=>this.ready[a.id]-this.ready[b.id]||this.entered[a.id]-this.entered[b.id]||a.id-b.id);
    for(const a of candidates)if(a.link>=0&&this.lanes[a.link][a.dir>0?0:1][a.lane][0]===a.id)this.depart(a,dt);
    // Two opposing queue heads may exchange occupied slots at their common node.
    // This is simultaneous conservation, never the timed storage-capacity bypass in B.
    for(const a of candidates){
      if(a.link<0||a.pendingNext<0||this.ready[a.id]>sim.t)continue;
      const from=a.link,n=a.dir>0?g.links[from].b:g.links[from].a,e=g.adj[n][a.pendingNext];
      if(!e||this.closed[e.link]||this.lanes[from][a.dir>0?0:1][a.lane][0]!==a.id)continue;
      const bid=this.lanes[e.link][e.dir>0?1:0].map(q=>q[0]).find(id=>{
        if(id===undefined)return false;const p=A[id];return p.pendingNext>=0&&p.lastNode===n&&g.adj[n][p.pendingNext]?.link===from;
      });if(bid===undefined)continue;
      const b=A[bid];if(b.pendingNext<0||this.ready[b.id]>sim.t||b.lastNode!==n)continue;
      const back=g.adj[n][b.pendingNext];if(!back||back.link!==from||this.closed[from])continue;
      if(a.holdAtNode||b.holdAtNode||g.links[from].isRow||g.links[e.link].isRow)continue;
      if(Math.min(g.links[from].width,g.links[e.link].width)<2*(a.radius+b.radius))continue;
      const ai=2*from+(a.dir>0?0:1),bi=2*b.link+(b.dir>0?0:1);
      if(this.credit[ai]<1-1e-9||this.credit[bi]<1-1e-9)continue;
      if([from,e.link].some(li=>g.links[li].gate&&!sim.gates.canPass(li)))continue;
      this.removeFromLane(a);this.removeFromLane(b);this.credit[ai]--;this.credit[bi]--;this.discharged[ai]++;this.discharged[bi]++;
      for(const li of [from,e.link]){if(g.links[li].gate)sim.gates.consume(li,sim.t);else sim.gates.passes[li]++;}
      this.enter(a,e.link,e.dir,0);this.enter(b,from,back.dir,0);a.blockedTime=b.blockedTime=0;
      sim.recordTraversal(a,from,e.link);sim.recordTraversal(b,e.link,from);this.exchanges++;sim.progress();
    }
    // One residual person per direction; total cumulative service <= integral C + 2.
    for(let i=0;i<this.credit.length;i++)this.credit[i]=Math.min(1,this.credit[i]);
  }

  private depart(a:Agent,dt:number){
    const sim=this.sim,L=this.g.links[a.link],from=a.link,idx=2*from+(a.dir>0?0:1),n=a.dir>0?L.b:L.a,node=this.g.nodes[n];
    if(this.credit[idx]<1-1e-9){sim.movementObserver?.block(a.id,'link-service',dt,from);return;}
    if(a.lastNode!==n){a.lastNode=n;a.pendingNext=-1;sim.onArrive(a,n,from);if(a.done)return;}
    if(a.holdAtNode){sim.movementObserver?.block(a.id,'group-hold',dt,from);return;}
    if(node.kind==='safe'||node.kind==='refuge'){
      this.removeFromLane(a);this.credit[idx]--;this.discharged[idx]++;
      if(node.kind==='safe')sim.markSafe(a,n);else sim.markAwaitingAssist(a,n);return;
    }
    let k=a.pendingNext;
    for(let attempt=0;attempt<4;attempt++){
      if(k<0)k=sim.routing.nextLink(a,n,from);
      if(k<0){sim.noRoute(a,n,dt);return;}
      const e=this.g.adj[n][k];if(this.closed[e.link]){sim.discoverBlocked(a,e.link,n);k=-1;}else break;
    }
    if(k<0)return;const e=this.g.adj[n][k],next=this.g.links[e.link];a.pendingNext=k;a.noRouteTime=0;
    if(this.closed[e.link])return;
    a.waitTarget=next.gate?e.link:-1;
    if(next.gate){sim.gates.queueNow[e.link]++;sim.gates.impatienceSum[e.link]+=a.impatience;sim.gates.waitSum[e.link]+=dt;}
    if(e.link!==from&&this.linkCount[e.link]>=this.occCap[e.link]){sim.movementObserver?.block(a.id,'storage',dt,e.link);sim.reconsiderWhileWaiting(a,n);return;}
    if(next.gate&&!sim.gates.canPass(e.link)){sim.movementObserver?.block(a.id,'gate-service',dt,e.link);sim.reconsiderWhileWaiting(a,n);return;}
    this.removeFromLane(a);this.credit[idx]--;this.discharged[idx]++;
    if(next.gate)sim.gates.consume(e.link,sim.t);else sim.gates.passes[e.link]++;
    this.enter(a,e.link,e.dir,0);a.blockedTime=0;a.state=a.inside?ST.MOVING:ST.OUTSIDE;if(next.exterior)a.exitLink=e.link;
    sim.movementObserver?.transition(a.id,from,e.link,a.v,0,dt);sim.recordTraversal(a,from,e.link);sim.progress();
  }
}
