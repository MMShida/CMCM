import type {Agent} from '../simulation/Agent';
import {REASON} from '../simulation/Agent';
import {RouteSystem} from '../simulation/Routing';
import {stateFor,event} from './State';
type Cause='start'|'node'|'info'|'stuck'|'event'|'guidance';
export class PlusRouting extends RouteSystem {
  /** Accepted instructions change intent now; the computed path starts at the forward node. */
  commit(a:Agent,gi:number,source:string){
    const p=stateFor(this.sim).people[a.id];p.command=gi;p.source=source;p.received=this.sim.t;
    a.knownExits|=1<<gi;a.pendingNext=-1;
    this.chooseExit(a,'guidance');
  }
  override chooseExit(a:Agent,cause:Cause,atNode:number|null=null):boolean{
    const sim=this.sim,p=stateFor(sim).people[a.id],old=a.targetGroup;
    if(p.command>=0&&!a.wheelchair&&a.inside&&a.meetNode<0){
      // A commitment retains an already valid path until relevant new safety information.
      // This also avoids rebuilding the same route for duplicate agreeing broadcasts.
      if(a.targetGroup===p.command&&a.pathGroup===p.command&&a.pathValid&&cause!=='info'&&cause!=='start')return false;
      const r=this.search(a,atNode),gi=p.command;
      if(r.target[gi]>=0&&Number.isFinite(r.cost[gi])){
        a.targetGroup=gi;a.pathGroup=gi;this.setPath(a,this.extractPath(r.target[gi]));a.reason=p.source.startsWith('CM')?REASON.CM:REASON.LED;
        a.groupCosts=Array.from(r.cost);p.costs=Array.from(r.cost,x=>Number.isFinite(x)?x:null);
        if(old!==gi){a.lastSwitchT=sim.t;a.exitSwitches+=old>=0?1:0;a.reroutes+=old>=0?1:0;a.rerouteFlash=3;
          p.pending=a.link>=0&&a.lastNode<0;event(sim,{agent:a.id,kind:'destination',source:p.source,exit:gi,from:old,reason:p.pending?'Accepted instruction; turn at next connected node':'Accepted instruction; valid route adopted'});
        }return old>=0&&old!==gi;
      }
      event(sim,{agent:a.id,kind:'command-released',source:p.source,exit:gi,reason:'Known obstruction makes instructed destination unreachable'});p.command=-1;p.pending=false;
    }
    const changed=super.chooseExit(a,cause,atNode);
    p.costs=a.groupCosts.map(x=>Number.isFinite(x)?x:null);
    if(changed){p.pending=a.link>=0&&a.lastNode<0;event(sim,{agent:a.id,kind:'destination',source:cause,exit:a.targetGroup,from:old,reason:`${cause}: travel, visible waits and persistent preferences`});}
    return changed;
  }
  observe(a:Agent){
    const sim=this.sim,p=stateFor(sim).people[a.id];
    if(a.link<0||!a.inside||a.done)return;
    sim.prepareQueueObservations(a);
    let learned=false;p.observed=[];
    for(const l of sim.graph.links){if(l.isRow||(!l.gate&&!l.exterior&&!sim.movement.closed[l.idx]))continue;const n=sim.graph.nodes[l.a];
      if(!sim.canObserve(a,n.x,n.y,sim.nodeFloorDisp[l.a]))continue;
      if(sim.movement.closed[l.idx])learned=this.learnBlocked(a,l.idx)||learned;
      if(l.exterior&&l.exitGroup>=0)a.knownExits|=1<<l.exitGroup;
      if(l.gate){let previous=p.samples[l.idx];if(previous&&sim.t-previous.lastSeen>1.5)previous=undefined as any;const passes=sim.gates.passes[l.idx],q=sim.perceivedGateQueue(a,l.idx);
        let rate=previous?.rate??sim.gates.cap[l.idx];
        if(previous&&sim.t-previous.t>=5){
          if(previous.queued&&q>0)rate=Math.max(.2,Math.min(sim.gates.cap[l.idx],(passes-previous.passes)/(sim.t-previous.t)));
          p.samples[l.idx]={passes,t:sim.t,lastSeen:sim.t,rate,queued:q>0};
        }else if(!previous)p.samples[l.idx]={passes,t:sim.t,lastSeen:sim.t,rate,queued:q>0};
        if(p.samples[l.idx])p.samples[l.idx].lastSeen=sim.t;
        p.observed.push({link:l.id,queue:q,rate,wait:q/Math.max(.2,rate),t:sim.t});}
    }
    if(learned){a.pendingNext=-1;this.chooseExit(a,'info');return;}
    if(p.command>=0||sim.t-a.lastDecisionT<sim.cfg.adaptive.eventCooldown||sim.graph.links[a.link].isRow)return;
    const r=this.search(a,null),cur=a.targetGroup; a.lastDecisionT=sim.t;let best=cur;
    for(let gi=0;gi<r.cost.length;gi++)if((a.knownExits&(1<<gi))&&(best<0||r.cost[gi]<r.cost[best]))best=gi;
    p.costs=Array.from(r.cost,x=>Number.isFinite(x)?x:null);
    if(cur>=0&&best>=0&&r.cost[cur]-r.cost[best]>Math.max(8,.15*r.cost[cur])){
      // Reconsider immediately, retaining the inherited stochastic preferences/hysteresis.
      a.pendingNext=-1;this.chooseExit(a,'event');
    }
  }
}
