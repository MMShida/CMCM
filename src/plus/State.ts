import type {SimulationEngine} from '../simulation/SimulationEngine';
export interface DecisionEvent {t:number;agent:number;kind:string;source:string;exit:number;accepted?:boolean;from?:number;reason:string;}
export interface PersonInformation {
  buildingWait?:number; firstLedAt?:number;
  command:number; source:string; pending:boolean; received:number; lastDecision:string;
  observed:{link:string;queue:number;rate:number;wait:number;t:number}[];
  samples:Record<number,{passes:number;t:number;lastSeen:number;rate:number;queued:boolean}>;
  costs:(number|null)[]; seen:Record<string,number>; history:DecisionEvent[];
}
export interface PlusState {people:PersonInformation[];events:DecisionEvent[];counts:Record<string,number>;firstNotices:number[];}
const states=new WeakMap<SimulationEngine,PlusState>();
export function stateFor(sim:SimulationEngine):PlusState{let s=states.get(sim);if(!s){s={people:sim.agents.map(()=>({command:-1,source:'',pending:false,received:0,lastDecision:'Initial knowledge',observed:[],samples:{},costs:[],seen:{},history:[]})),events:[],counts:{},firstNotices:[]};states.set(sim,s);}return s;}
export function event(sim:SimulationEngine,e:Omit<DecisionEvent,'t'>){const s=stateFor(sim),v={t:sim.t,...e};s.counts[e.kind]=(s.counts[e.kind]??0)+1;if(e.kind==='destination'&&e.from!==undefined&&e.from>=0){const category=e.source.startsWith('CM')?'switch-manager':e.source==='event'||e.source==='node'||e.source==='info'?'switch-observation':'switch-sign';s.counts[category]=(s.counts[category]??0)+1;}if(s.events.length<20000)s.events.push(v);const p=s.people[e.agent];if(p){p.history.push(v);if(p.history.length>20)p.history.shift();p.lastDecision=e.reason;}}
