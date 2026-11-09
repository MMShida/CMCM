import type {GuidanceSign,SimConfig} from '../simulation/Params';
import type {CrowdManagerPost} from '../geometry/types';
export interface ManagerPatrol {manager:number;startNode:string;links:string[];start:number;speed:number;dwell:number;}
export interface PhysicalSign extends GuidanceSign {
  enabled:boolean; mode:'static'|'dynamic'; activation:number; range:number; halfAngle:number;
  detection:number; acceptance:number;
}
export interface PhysicalBarrier {
  slot:string; enabled:boolean; type:'belt'|'open-rail'|'opaque-panel';
  /** Length along the barrier, angle relative to the corridor axis. */
  length:number; angle:number;
}
export interface PlusConfig {
  version:1; signs:PhysicalSign[]; barriers:PhysicalBarrier[];
  groupPace:'local'|'permanent'; passing:boolean; localObservation:boolean;
  fixedAcceptance:boolean; executeInstructions:boolean;
  controllerDelay:number; controllerHold:number; controllerMargin:number;
  /** Optional explicit posts and conservative patrols. Absent preserves fixed staff. */
  managerPosts?:CrowdManagerPost[]; managerPatrols?:ManagerPatrol[];
  costs:{managerPerEvent:number;sign:number;stripPerMetre:number;barrier:number;controller:number};
}
export function plusDefaults():PlusConfig{return {version:1,signs:[],barriers:[],groupPace:'local',passing:true,localObservation:true,fixedAcceptance:true,executeInstructions:true,controllerDelay:3,controllerHold:20,controllerMargin:20,costs:{managerPerEvent:120,sign:250,stripPerMetre:40,barrier:150,controller:800}};}
export function plusConfig(c:SimConfig):SimConfig {
  const n=structuredClone(c);n.plus={...plusDefaults(),...n.plus};
  // A six-post layout cannot instantiate ten people. Extend the coverage layout
  // explicitly when its requested count exceeds six; preserve all six-post runs.
  if(n.crowdManagers.placement==='coverage'&&n.crowdManagers.count>6){
    const count=n.crowdManagers.count;
    if(count>18)throw Error('Coverage supports at most 18 explicit manager posts.');
    n.crowdManagers.placement=count<=10?'coverage10':count<=12?'coverage12':'coverage18';
  }
  n.crowdManagers.vacatedRowGuidance=false;
  // A-Lite+ uses the existing delayed local/radio controller, never partial global prediction.
  n.adaptive.managers=true;n.adaptive.redirectMode='zone';
  n.adaptive.congestionInfo='local';
  n.led.spatial={range:8,halfAngleDegrees:70,occlusion:true,signs:n.plus.signs};
  return n;
}
