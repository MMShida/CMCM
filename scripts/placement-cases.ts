/** Exact-six-manager, full-house placement catalogue. Coordinates use the unchanged reconstruction. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {BAILEY_HALL,slotId} from '../src/geometry/BaileyHall';
import {graphFor} from '../src/simulation/SimulationEngine';
import {computeField} from '../src/geometry/NavigationGraph';
import {EXIT_GROUPS,type ExitGroupId} from '../src/geometry/types';
import {defaultConfig,type GuidanceSign,type SimConfig} from '../src/simulation/Params';
import {expandPlan} from '../src/simulation/Plan';
import {assertScope} from './research-study';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const layouts:Record<string,[string,ExitGroupId,number][]>={
 early:[['FX_1','STAGE_W',.5],['FX_4','STAGE_E',.5],['WK_1','PORTICO_W',.3],['WK_10','PORTICO_E',.7],['WK_3','PORTICO_W',.3],['WK_8','PORTICO_E',.7],['WK_5','FOYER',.5],['WK_6','FOYER',.5],['BWK_1','BAL_NW',.25],['BWK_8','BAL_NE',.75],['BWK_4','FOYER',.5],['BWK_5','FOYER',.5]],
 decision:[['FX_2','STAGE_W',.5],['FX_3','STAGE_E',.5],['WK_2','PORTICO_W',.5],['WK_9','PORTICO_E',.5],['WK_4','PORTICO_W',.3],['WK_7','PORTICO_E',.7],['WK_5','FOYER',.25],['WK_6','FOYER',.75],['BWK_1','BAL_NW',.8],['BWK_8','BAL_NE',.2],['BWK_2','FOYER',.8],['BWK_7','FOYER',.2]],
 corridor:[['CO_1','PORTICO_W',.5],['CO_26','PORTICO_E',.5],['CO_5','PORTICO_W',.5],['CO_22','PORTICO_E',.5],['CO_11','FOYER',.5],['CO_16','FOYER',.5],['CO_13','FOYER',.5],['CO_14','FOYER',.5],['BWK_1','BAL_NW',.1],['BWK_8','BAL_NE',.9],['BWK_2','FOYER',.85],['BWK_7','FOYER',.15]],
};
/** Clip 2 metres of an existing link; direction follows a shortest open route to its public exit. */
export function stripLayout(name:string,c:SimConfig):GuidanceSign[]{
 const g=graphFor(BAILEY_HALL),closed=new Set(c.barriers.filter(id=>c.barrierTypes?.[id]!=='soft-rope'));
 return layouts[name].map(([id,exit,fraction],j)=>{
  const L=g.links[g.linkByIdOrThrow(id)],raw=BAILEY_HALL.links.find(l=>l.id===id)!;
  const seg=raw.pts.slice(1).map((p,i)=>Math.hypot(p[0]-raw.pts[i][0],p[1]-raw.pts[i][1]));
  const length=seg.reduce((a,b)=>a+b,0);if(length<2)throw Error('Strip exceeds link '+id);
  const start=Math.max(0,Math.min(length-2,length*fraction-1)),end=start+2;
  const point=(s:number):[number,number]=>{let n=0;for(let k=0;k<seg.length;k++){if(s<=n+seg[k]+1e-9){const u=(s-n)/seg[k];return [raw.pts[k][0]+u*(raw.pts[k+1][0]-raw.pts[k][0]),raw.pts[k][1]+u*(raw.pts[k+1][1]-raw.pts[k][1])];}n+=seg[k];}return raw.pts.at(-1)!;};
  const points:[number,number][]=[point(start)];let d=0;seg.forEach((v,i)=>{d+=v;if(d>start+1e-8&&d<end-1e-8)points.push(raw.pts[i+1]);});points.push(point(end));
  const field=computeField(g,g.safeByGroup[EXIT_GROUPS.indexOf(exit)],li=>g.links[li].isRow||g.links[li].prohibited||closed.has(g.links[li].id));
  if(!Number.isFinite(Math.min(field.dist[L.a],field.dist[L.b])))throw Error('Unreachable sign destination');
  if(field.dist[L.a]<field.dist[L.b])points.reverse();
  const [x,y]=point((start+end)/2);return {id:`L${j+1}`,x,y,floor:raw.floor,facingDegrees:0,exit,strip:{linkId:id,points}};
 });
}
export function assertSix(c:SimConfig){
 assertScope(c);
 if(c.crowdManagers.count!==6||c.crowdManagers.unavailable.length)throw Error('Exactly six available crowd managers required');
 if(c.crowdManagers.posts.length||!['existing','coverage','decision'].includes(c.crowdManagers.placement??'existing'))throw Error('Unreviewed manager layout');
 for(const id of c.barriers)if(!BAILEY_HALL.links.some(l=>l.id===id&&l.barrierSlot&&l.kind==='corridor'&&!l.exterior))throw Error('Only existing corridor barrier slots allowed');
 if(c.led.enabled&&(!c.led.spatial?.occlusion||c.led.spatial.signs.some(s=>!s.strip)))throw Error('Physical strips with occlusion required');
}
export function placementCases(){
 const base=defaultConfig();base.numerics={conserveService:true};base.adaptive.managers=true;base.adaptive.staticPlan=true;
 base.crowdManagers.plan=expandPlan(base.crowdManagers.plan,BAILEY_HALL);
 for(const key of Object.keys(base.crowdManagers.plan))if(key.startsWith('ORCH_C')){const [,side,band]=key.split(':');base.crowdManagers.plan[key]=band==='F'?`PORTICO_${side}` as ExitGroupId:'FOYER';}
 base.preassign.enabled=true;base.preassign.plan={...base.crowdManagers.plan};base.led.plan={...base.crowdManagers.plan};
 const cases:any[]=[];
 for(const placement of ['existing','coverage','decision'] as const)for(const led of ['none',...Object.keys(layouts)])for(const barrier of ['none','hard0','hard1','hard2','rope1','hard02','hard20']){
  const c=structuredClone(base);c.crowdManagers.placement=placement;
  if(barrier!=='none'){
   const v=barrier.replace(/hard|rope/,'');c.barriers=[slotId(BAILEY_HALL,'W'+v[0]),slotId(BAILEY_HALL,'E'+(v[1]??v[0]))];
   if(barrier.startsWith('rope')){c.barrierTypes=Object.fromEntries(c.barriers.map(id=>[id,'soft-rope']));c.ropePenalty=15;}
  }
  c.led.enabled=led!=='none';if(c.led.enabled)c.led.spatial={range:12,halfAngleDegrees:180,occlusion:true,signs:stripLayout(led,c)};
  c.label=`Six managers: ${placement}; LEDs ${led}; barriers ${barrier}`;
  assertSix(c);cases.push({id:`${placement}-${led}-${barrier}`,scope:'intervention',models:['Lite'],cfg:c,placement,led,barrier});
 }
 return cases;
}
if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){mkdirSync('results/placement-study',{recursive:true});const cases=placementCases();writeFileSync('results/placement-study/screen-cases.json',JSON.stringify(cases,null,1));console.log(cases.length,'six-manager configurations; each LED installation = 12 × 2 m');}
