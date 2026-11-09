import {GuidanceSystem} from '../simulation/Guidance';
import type {SimulationEngine} from '../simulation/SimulationEngine';
import type {Agent} from '../simulation/Agent';
import {ST} from '../simulation/Agent';
import {SignVisibility} from '../simulation/SignVisibility';
import {MinHeap,computeField} from '../geometry/NavigationGraph';
import {EXIT_GROUPS} from '../geometry/types';
import type {PhysicalSign} from './Config';
import {PlusRouting} from './PlusRouting';
import {stateFor,event} from './State';
import {MobileManagers} from './MobileManagers';
function draw(seed:number,id:number,key:string){let h=(seed^Math.imul(id+1,2654435761))>>>0;for(const c of key){h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return (h>>>0)/4294967296;}
export class PlusGuidance extends GuidanceSystem {
  readonly mobile:MobileManagers;
  private mobileRefresh=-1;
  readonly installations:{sign:PhysicalSign;version:number;lastChange:number;visibility:SignVisibility}[]=[];
  private lastSample=-1;
  private controllerInbox:{available:number;manager:number;closed:boolean;known:Map<number,{w:number;t:number}>}[]=[];
  private delivered=new Map<number,{closed:boolean;known:Map<number,{w:number;t:number}>}>();
  constructor(private host:SimulationEngine){
    super(host);
    for(const cm of this.cms)cm.post=structuredClone(cm.post);
    this.mobile=new MobileManagers(host,this.cms);
    const signs:PhysicalSign[]=(host.cfg.plus?.signs??[]).filter(s=>s.enabled).map(s=>structuredClone(s));
    // Baseline signs at actual exterior/escape door nodes, facing the approaching corridor.
    for(const l of host.graph.links){if(!(l.exterior||/^(SD[WE]|BND[WE])$/.test(l.id)))continue;
      const n=host.graph.nodes[l.a],b=host.graph.nodes[l.b],gi=l.exitGroup>=0?l.exitGroup:l.id==='SDW'?3:l.id==='SDE'?4:l.id==='BNDW'?5:6;
      signs.push({id:`EXIT-${l.id}`,x:n.x,y:n.y,floor:host.nodeFloorDisp[l.a],facingDegrees:Math.atan2(n.y-b.y,n.x-b.x)*180/Math.PI,exit:EXIT_GROUPS[gi],enabled:true,mode:'static',activation:0,range:host.visibilityRange,halfAngle:90,detection:.38,acceptance:0});
    }
    for(const sign of signs)this.installations.push({sign,version:0,lastChange:-Infinity,visibility:new SignVisibility(host.geo,{range:sign.range,halfAngleDegrees:sign.halfAngle,occlusion:true,signs:[sign]},host.cfg)});
    // Refine manager observation sets with actual sight segments, retaining their finite delays/radio.
    for(const cm of this.cms)cm.obsGates=cm.obsGates.filter(li=>{const l=host.graph.links[li],n=host.graph.nodes[l.a];return host.canObserve({x:cm.post.x,y:cm.post.y,floor:cm.post.floor},n.x,n.y,host.nodeFloorDisp[l.a]);});
  }
  override step(dt:number){
    this.mobile.step(dt);const t=Math.floor(this.host.t+1e-8);
    if(this.mobile.routes.length&&t!==this.mobileRefresh){this.mobileRefresh=t;this.refreshManagerPositions(this.mobile.anchors());for(const cm of this.cms)cm.obsGates=cm.obsGates.filter(li=>{const l=this.host.graph.links[li],n=this.host.graph.nodes[l.a];return this.host.canObserve(cm.post,n.x,n.y,this.host.nodeFloorDisp[l.a]);});}
    super.step(dt);if(t===this.lastSample)return;this.lastSample=t;
    this.updateMessages();for(const a of this.host.agents)if(!a.done&&a.inside&&a.state!==ST.UNAWARE)this.ledPerceive(a);
  }
  private updateMessages(){const sim=this.host,p=sim.cfg.plus!,g=sim.graph;
    for(const cm of this.cms)if(sim.t>=cm.tActive)this.controllerInbox.push({available:sim.t+p.controllerDelay,manager:cm.idx,closed:cm.knowsBlocked,known:new Map(cm.known)});
    const pending:typeof this.controllerInbox=[];
    for(const msg of this.controllerInbox){if(msg.available<=sim.t+1e-9)this.delivered.set(msg.manager,msg);else pending.push(msg);}
    this.controllerInbox=pending;
    for(const item of this.installations){const s=item.sign;if(s.mode!=='dynamic'||!sim.cfg.led.enabled||sim.t<s.activation||sim.t-item.lastChange<p.controllerHold)continue;
      const cm=this.cms.filter(m=>m.post.floor===s.floor&&sim.t>=m.tActive).sort((a,b)=>Math.hypot(a.post.x-s.x,a.post.y-s.y)-Math.hypot(b.post.x-s.x,b.post.y-s.y))[0];if(!cm)continue;
      let ni=0,d=Infinity;for(let n=0;n<g.nodes.length;n++){if(sim.nodeFloorDisp[n]!==s.floor)continue;const q=Math.hypot(g.nodes[n].x-s.x,g.nodes[n].y-s.y);if(q<d){ni=n;d=q;}}
      const received=this.delivered.get(cm.idx);if(!received)continue;const knownClosed=received.closed;
      const costs=new Array(EXIT_GROUPS.length).fill(Infinity),dist=new Float64Array(g.nodes.length).fill(Infinity),heap=new MinHeap();dist[ni]=0;heap.push(0,ni);
      while(heap.size){const [du,u]=heap.pop();if(du>dist[u])continue;
        for(const e of g.adj[u]){const l=g.links[e.link];if(l.isRow||l.prohibited||g.climbs(e.link,e.dir)||(e.dir<0&&/^(D\d|FC\d|OST_[A-Z]+)$/.test(l.id))||sim.barrierLinks.includes(e.link)||(knownClosed&&sim.blockedLinks.includes(e.link)))continue;
          const info=received.known.get(e.link),wait=info?info.w:0,nd=du+g.nominalCost(e.link,e.dir,false)+wait;
          if(l.exterior&&l.exitGroup>=0){costs[l.exitGroup]=Math.min(costs[l.exitGroup],nd);continue;}
          if(nd<dist[e.other]){dist[e.other]=nd;heap.push(nd,e.other);}
        }
      }
      const current=EXIT_GROUPS.indexOf(s.exit);let best=current;for(let i=0;i<costs.length;i++)if(costs[i]<costs[best])best=i;
      if(best!==current&&Number.isFinite(costs[best])&&costs[current]-costs[best]>p.controllerMargin){s.exit=EXIT_GROUPS[best];
        if(s.strip){const li=g.linkByIdOrThrow(s.strip.linkId),l=g.links[li],f=computeField(g,g.safeByGroup[best],i=>g.links[i].isRow||g.links[i].prohibited||sim.barrierLinks.includes(i)||(knownClosed&&sim.blockedLinks.includes(i)));
          const target=g.nodes[f.dist[l.a]<f.dist[l.b]?l.a:l.b],pts=s.strip.points,first=pts[0],last=pts[pts.length-1];
          if(Math.hypot(first[0]-target.x,first[1]-target.y)<Math.hypot(last[0]-target.x,last[1]-target.y))pts.reverse();
        }
        item.version++;item.lastChange=sim.t;event(sim,{agent:-1,kind:'sign-update',source:s.id,exit:best,reason:'Delayed local/radio manager information; hold and improvement threshold'});}
    }
  }
  override ledPerceive(a:Agent){
    if(!this.installations)return;const sim=this.host,p=stateFor(sim).people[a.id];
    for(const item of this.installations){const s=item.sign,baseline=s.id.startsWith('EXIT-');
      if((!baseline&&!sim.cfg.led.enabled)||sim.t<s.activation||p.seen[s.id]===item.version)continue;
      if(!item.visibility.nearest(a.x,a.y,a.floor))continue;
      p.seen[s.id]=item.version;
      const detection=s.detection*(sim.cfg.environment.darkness?.6:1)*(1-.5*Math.min(1,sim.cfg.environment.smoke));
      if(draw(sim.seed,a.id,s.id+'-notice')>=detection)continue;
      const gi=EXIT_GROUPS.indexOf(s.exit);a.knownExits|=1<<gi;
      const accepted=!baseline&&draw(sim.seed,a.id,s.id+'-accept')<s.acceptance;
      event(sim,{agent:a.id,kind:baseline?'static-sign':'led-noticed',source:s.id,exit:gi,accepted,reason:baseline?'Visible existing exit sign':'Physical sign/strip noticed in visibility catchment'});
      if(!baseline){a.ledSeen=true;if(p.firstLedAt===undefined){p.firstLedAt=sim.t;stateFor(sim).firstNotices.push(sim.t);}}
      if(accepted){a.ledGroup=gi;const activeCM=p.command>=0&&p.source.startsWith('CM');
        if(activeCM&&p.command!==gi){event(sim,{agent:a.id,kind:'message-conflict',source:s.id,exit:gi,reason:'Existing accepted manager destination retained'});continue;}
        if(sim.cfg.plus?.executeInstructions)(sim.routing as PlusRouting).commit(a,gi,s.id);else sim.routing.chooseExit(a,'guidance');
      }
    }
  }
}
