/** User-authorized staff count, placement and conservative moving-post follow-up. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import {placementPosts} from '../src/simulation/Placements';
import type {SimConfig,PlacementId} from '../src/simulation/Params';
import {PlusSimulation} from '../src/plus/PlusSimulation';
import {plusConfig} from '../src/plus/Config';
import {NavGraph} from '../src/geometry/NavigationGraph';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {SimPool} from './pool';
import {hashTree,snapshotSource} from './research-study';
const root='results/plus-study';
const save=(name:string,x:unknown)=>writeFileSync(`${root}/${name}.json`,JSON.stringify(x,null,1));
while(!existsSync(`${root}/selection-roles.json`))await new Promise(r=>setTimeout(r,1000));
const original=JSON.parse(readFileSync(`${root}/selected-config.json`,'utf8')) as SimConfig;
const base=structuredClone(original);base.population.speedMean=1.4;base.population.speedDistribution='normal';
const extras=placementPosts(geo,'coverage18')!.slice(6),cases:{id:string;cfg:SimConfig}[]=[];
function fixed(count:number,placement:PlacementId){const c=structuredClone(base);c.crowdManagers.count=count;
  c.crowdManagers.placement=placement;
  if(count>6&&placement!=='coverage'){
    const posts=structuredClone([...(placementPosts(geo,placement)??geo.crowdManagerPosts),...extras.slice(0,count-6)]);
    // Explicit nearest-seat-centroid responsibilities, on the same floor.
    posts.forEach(p=>p.zones=[]);
    for(const z of geo.zones){const seats=geo.seats.filter(s=>s.zone===z.id);if(!seats.length)continue;const x=seats.reduce((a,b)=>a+b.x,0)/seats.length,y=seats.reduce((a,b)=>a+b.y,0)/seats.length,f=z.level==='balcony'?2:1;
      posts.filter(p=>p.floor===f).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0].zones.push(z.id);
    }c.plus!.managerPosts=posts;c.crowdManagers.placement='existing';
  }return plusConfig(c);
}
for(const count of [6,8,10,12,18])cases.push({id:`staff-${count}-coverage`,cfg:fixed(count,'coverage')});
for(const placement of ['decision','bottleneck','hybrid222','robust'] as const)cases.push({id:`staff-6-${placement}`,cfg:fixed(6,placement)});
for(const count of [12,18])for(const placement of ['decision','hybrid222'] as const)cases.push({id:`staff-${count}-${placement}`,cfg:fixed(count,placement)});
for(const count of [6,12,18]){const c=fixed(count,'coverage');c.adaptive.staticPlan=false;cases.push({id:`staff-${count}-adaptive`,cfg:c});}
function patrol(count:number,start:number){const c=fixed(count,'coverage'),s=new PlusSimulation(geo,c),g=new NavGraph(s.geo,c.movement.laneWidth);
  c.plus!.managerPosts=s.guidance.cms.map(m=>structuredClone(m.post));c.crowdManagers.placement='existing';c.plus!.managerPatrols=[];
  const eligible=(li:number)=>{const l=g.links[li];return !l.isRow&&!l.gate&&!l.prohibited&&!l.exterior&&l.kind!=='stair'&&l.width>=1.8&&!s.barrierLinks.includes(li)&&g.nodes[l.a].floor===g.nodes[l.b].floor;};
  const usedStarts=new Set<number>();
  for(let manager=0;manager<c.plus!.managerPosts.length;manager++){
    const p=c.plus!.managerPosts[manager];
    const nodes=g.nodes.map((n,i)=>({n,i,d:Math.hypot(n.x-p.x,n.y-p.y)})).filter(x=>x.n.floor===p.floor&&x.d<=4&&!usedStarts.has(x.i)&&g.adj[x.i].some(e=>eligible(e.link))).sort((a,b)=>a.d-b.d);
    if(!nodes.length)continue;const startNode=nodes[0].i;usedStarts.add(startNode);let u=startNode,length=0;const links:string[]=[],visited=new Set([u]);
    while(length<12){const choices=g.adj[u].filter(e=>eligible(e.link)&&!visited.has(e.other)).sort((a,b)=>g.links[b.link].len-g.links[a.link].len);if(!choices.length)break;const e=choices[0];links.push(g.links[e.link].id);length+=g.links[e.link].len;u=e.other;visited.add(u);}
    if(!links.length)continue;p.x=g.nodes[startNode].x;p.y=g.nodes[startNode].y;
    c.plus!.managerPatrols.push({manager,startNode:g.nodes[startNode].id,links,start,speed:1,dwell:10});
  }return c;
}
for(const count of [6,12,18]){
  const moving=patrol(count,20),stationary=structuredClone(moving);stationary.plus!.managerPatrols=[];
  cases.push({id:`staff-${count}-patrol-posts-static`,cfg:stationary},{id:`staff-${count}-patrol20`,cfg:moving});
  const later=structuredClone(moving);later.plus!.managerPatrols!.forEach(r=>r.start=45);cases.push({id:`staff-${count}-patrol45`,cfg:later});
}
// Validate actual counts and motion paths before opening any experimental audience.
for(const c of cases){const s=new PlusSimulation(geo,c.cfg,1);if(s.guidance.cms.length!==c.cfg.crowdManagers.count)throw Error('Staff count mismatch: '+c.id);c.cfg=s.cfg;c.cfg.label=c.id;}
save('staff-expansion-protocol',{frozenAt:new Date().toISOString(),cases,screen:{base:73401,runs:8},validation:{base:73402,runs:16,top:4},confirmation:{base:73403,runs:100},robustness:{base:73404,runs:20,cases:11,barrierHarmSeconds:5},note:'Operational selection at the separately declared 1.4 m/s calibration; confirm winner and its unchanged-policy 1.2 counterpart. Six-manager same-speed control also confirmed. No holdout-driven winner selection. Patrols move only along empty wide level links; staff bodies are not resolved, so motion remains a limited coverage sensitivity.',references:['https://doi.org/10.1016/j.tust.2026.107458']});
snapshotSource(`${root}/staff-expansion-source.json`);const sourceHash=hashTree('src'),pool=new SimPool(3);
async function batch(name:string,items:typeof cases,seed:number,n:number){const out:any[]=[],seeds=batchSeeds(seed,n);for(const c of items){const runs=await pool.run(c.cfg,seeds,'Plus');if(runs.some((r:any)=>r.plus.staffCount!==c.cfg.crowdManagers.count))throw Error('Runtime staff mismatch');out.push({...c,runs,stats:summarize(runs.map(r=>r.tEvac))});save(name,{sourceHash,seeds,cases:out});console.log(name,c.id,out.at(-1).stats.mean);}return out;}
function rank(xs:any[]){return xs.filter(c=>c.runs.every((r:any)=>r.allLeftBuilding&&!r.unresolvedInside&&Number.isFinite(r.tEvac))).sort((a,b)=>a.stats.mean-b.stats.mean);}
try{
 const screen=await batch('staff-expansion-screen',cases,73401,8),shortlist=rank(screen).slice(0,4).map(({id,cfg})=>({id,cfg}));
 const validation=await batch('staff-expansion-validation',shortlist,73402,16),winner=rank(validation)[0];if(!winner)throw Error('No completed staff policy');
 const selected=structuredClone(winner.cfg),slow=structuredClone(selected);slow.population.speedMean=1.2;
 const control=structuredClone(base);
 save('staff-expansion-selection',{frozenAt:new Date().toISOString(),id:winner.id,cfg:selected,criterion:'Lowest complete validation mean; all three confirmation roles frozen before holdout'});
 save('staff-expanded-config',selected);
 await batch('staff-expansion-confirmation',[{id:'expanded-staff-1.4',cfg:selected},{id:'same-staff-1.2',cfg:slow},{id:'six-manager-1.4-control',cfg:control}],73403,100);
 const checks:typeof cases=[];
 for(const dt of [.025,.0125]){const c=structuredClone(selected);c.movement.dt=dt;checks.push({id:`expanded-dt${dt}`,cfg:c});}
 for(const link of ['F3','FC2','D3']){const c=structuredClone(selected);c.blocked.links=[link];c.blocked.knowledge='discovery';checks.push({id:`expanded-${link}`,cfg:c});const open=structuredClone(c);open.plus!.barriers=[];checks.push({id:`expanded-${link}-without-barriers`,cfg:open});}
 const noBarriers=structuredClone(selected);noBarriers.plus!.barriers=[];checks.push({id:'expanded-without-barriers',cfg:noBarriers});
 const stationary=structuredClone(selected);stationary.plus!.managerPatrols=[];checks.push({id:'expanded-stationary',cfg:stationary});
 await batch('staff-expansion-robustness',[{id:'expanded-reference',cfg:selected},...checks],73404,20);
}finally{await pool.close();}
