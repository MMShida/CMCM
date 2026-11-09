import type {GeometryData} from '../geometry/types';
import type {SimConfig} from '../simulation/Params';
import type {Agent} from '../simulation/Agent';
import {LiteSimulation} from '../lite/LiteSimulation';
import {SignVisibility} from '../simulation/SignVisibility';
import {plusConfig} from './Config';
import {installationOverlay} from './Installations';
import {PlusMovement} from './PlusMovement';
import {PlusRouting} from './PlusRouting';
import {PlusGuidance} from './PlusGuidance';
import {event,stateFor} from './State';
const queueMemo=new WeakMap<object,{t:number;queues:Map<number,number>}>();
const sight=new WeakMap<object,SignVisibility>();
const visibilityMemo=new WeakMap<object,WeakMap<object,{x:number;y:number;floor:number;values:Map<string,boolean>}>>();
export class PlusSimulation extends LiteSimulation {
  declare readonly movement:PlusMovement;
  declare readonly routing:PlusRouting;
  declare readonly guidance:PlusGuidance;
  readonly installationWarnings:string[];
  constructor(geo:GeometryData,cfg:SimConfig,seed?:number){
    const overlay=installationOverlay(geo,plusConfig(cfg));
    super(overlay.geo,overlay.cfg,seed,{movement:s=>new PlusMovement(s),routing:s=>new PlusRouting(s),guidance:s=>new PlusGuidance(s)});
    this.installationWarnings=overlay.warnings;
  }
  override prepareQueueObservations(a:Agent){
    let memo=queueMemo.get(a);const t=Math.floor(this.t);if(!memo||memo.t!==t){memo={t,queues:new Map()};queueMemo.set(a,memo);}
    const eligible=new Set<number>();
    for(const l of this.graph.links){if(!l.gate||memo.queues.has(l.idx))continue;const n=this.graph.nodes[l.a];if(this.canObserve(a,n.x,n.y,this.nodeFloorDisp[l.a]))eligible.add(l.idx);}
    if(!eligible.size)return;
    const counts=new Map<number,number>();
    // One scan for this simultaneous observation, preserving any earlier per-gate sample.
    this.forEachNear(a.x,a.y,a.floor,this.visibilityRange,b=>{if(eligible.has(b.waitTarget)&&this.canObserve(a,b.x,b.y,b.floor,false))counts.set(b.waitTarget,(counts.get(b.waitTarget)??0)+1);});
    for(const li of eligible)memo.queues.set(li,counts.get(li)??0);
  }
  override perceivedGateQueue(a:Agent,li:number){
    const l=this.graph.links[li],n=this.graph.nodes[l.a];if(!this.canObserve(a,n.x,n.y,this.nodeFloorDisp[l.a]))return 0;
    let memo=queueMemo.get(a);const t=Math.floor(this.t);if(!memo||memo.t!==t){memo={t,queues:new Map()};queueMemo.set(a,memo);}
    const old=memo.queues.get(li);if(old!==undefined)return old;let q=0;
    this.forEachNear(a.x,a.y,a.floor,this.visibilityRange,b=>{if(b.waitTarget===li&&this.canObserve(a,b.x,b.y,b.floor,false))q++;});
    memo.queues.set(li,q);return q;
  }
  override perceivedGateCapacity(a:Agent,li:number){return stateFor(this).people[a.id].samples[li]?.rate??this.gates.cap[li];}
  override physicalSignsOnly(){return true;}
  override canObserve(a:{x:number;y:number;floor:number},x:number,y:number,floor:number,cacheResult=true){
    if(a.floor!==floor||Math.hypot(a.x-x,a.y-y)>this.visibilityRange)return false;
    let v=sight.get(this);if(!v){v=new SignVisibility(this.geo,{range:this.visibilityRange,halfAngleDegrees:180,occlusion:true,signs:[]},this.cfg);sight.set(this,v);}
    if(!cacheResult)return v.visible(a.x,a.y,a.floor,x,y,floor);
    let observers=visibilityMemo.get(this);if(!observers){observers=new WeakMap();visibilityMemo.set(this,observers);}
    let cache=observers.get(a);if(!cache||cache.x!==a.x||cache.y!==a.y||cache.floor!==a.floor){cache={x:a.x,y:a.y,floor:a.floor,values:new Map()};observers.set(a,cache);}
    const key=`${x},${y},${floor}`,known=cache.values.get(key);if(known!==undefined)return known;
    const visible=v.visible(a.x,a.y,a.floor,x,y,floor);cache.values.set(key,visible);return visible;
  }
  override managerAcceptance(a:Agent){return this.cfg.plus?.fixedAcceptance?this.cfg.crowdManagers.complianceProb:super.managerAcceptance(a);}
  override managerMessage(a:Agent,gi:number,accepted:boolean,manager:number){
    event(this,{agent:a.id,kind:'manager-heard',source:`CM${manager+1}`,exit:gi,accepted,reason:accepted?'Heard and accepted manager instruction':'Heard but declined manager instruction'});
    if(accepted&&this.cfg.plus?.executeInstructions)this.routing.commit(a,gi,`CM${manager+1}`);
  }
  protected override perceive(){
    super.perceive();if(this.cfg.plus?.localObservation)for(const a of this.agents)this.routing.observe(a);
  }
  override onArrive(a:Agent,n:number,cur:number){const inside=a.inside;super.onArrive(a,n,cur);if(inside&&!a.inside)stateFor(this).people[a.id].buildingWait=a.waitTotal;}
  override recordTraversal(a:Agent,from:number,to:number){
    super.recordTraversal(a,from,to);const p=stateFor(this).people[a.id];if(p.pending){p.pending=false;event(this,{agent:a.id,kind:'turn-executed',source:p.source,exit:a.targetGroup,reason:`Connected transition ${this.graph.links[from].id} → ${this.graph.links[to].id}`});}
  }
  diagnostics(){const s=stateFor(this);return {staffCount:this.guidance.cms.length,managerMotion:this.guidance.mobile.summary(),counts:s.counts,peopleNoticingLED:s.firstNotices.length,meanNoticeTime:s.firstNotices.length?s.firstNotices.reduce((a,b)=>a+b,0)/s.firstNotices.length:null,events:s.events,tail:this.agents.filter(a=>Number.isFinite(a.tLeftBuilding)).sort((a,b)=>b.tLeftBuilding-a.tLeftBuilding).slice(0,50).map(a=>({id:a.id,exit:a.targetGroup,time:a.tLeftBuilding,start:a.tStartMove,wait:stateFor(this).people[a.id].buildingWait??a.waitTotal,seat:a.seat,group:a.group,wheelchair:a.wheelchair})),warnings:this.installationWarnings};}
}
