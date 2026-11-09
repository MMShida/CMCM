import type {SimConfig} from '../simulation/Params';
import {plusDefaults} from './Config';
export function resources(c:SimConfig){const p=c.plus??plusDefaults(),signs=p.signs.filter(s=>s.enabled&&c.led.enabled);const metres=signs.reduce((sum,s)=>sum+(s.strip?s.strip.points.slice(1).reduce((n,v,i)=>n+Math.hypot(v[0]-s.strip!.points[i][0],v[1]-s.strip!.points[i][1]),0):0),0),wall=signs.filter(s=>!s.strip).length,barriers=p.barriers.filter(b=>b.enabled).length,dynamic=signs.some(s=>s.mode==='dynamic'),staff=c.crowdManagers.count<0?6:c.crowdManagers.count;
 return {staff,signs:wall,stripMetres:metres,barriers,dynamic,capital:wall*p.costs.sign+metres*p.costs.stripPerMetre+barriers*p.costs.barrier+(dynamic?p.costs.controller:0),staffPerEvent:staff*p.costs.managerPerEvent};
}
