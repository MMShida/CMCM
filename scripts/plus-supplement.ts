/** Predeclared checks of the frozen operational selection. No result feeds policy selection. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import type {SimConfig} from '../src/simulation/Params';
import {concertDeparture,lecture} from '../src/simulation/Scenarios';
import {plusConfig} from '../src/plus/Config';
import {SimPool} from './pool';
import {snapshotSource,hashTree} from './research-study';
const root='results/plus-study',read=(n:string)=>JSON.parse(readFileSync(`${root}/${n}.json`,'utf8'));
while(!existsSync(`${root}/selection-roles.json`))await new Promise(r=>setTimeout(r,1000));
const selected:SimConfig=read('selected-config'),roles=read('selection-roles');
const combined:SimConfig=roles.cases.find((c:any)=>c.id==='combined6')?.cfg??selected;
type Case={id:string;cfg:SimConfig;note?:string};
const suites:{name:string;base:number;n:number;cases:Case[]}[]=[];
function suite(name:string,base:number,n:number){const s={name,base,n,cases:[] as Case[]};suites.push(s);return (id:string,fn:(c:SimConfig)=>void=()=>{},origin=selected,note?:string)=>{const cfg=structuredClone(origin);fn(cfg);s.cases.push({id,cfg,note});};}
let add=suite('ablations',73201,16);add('selected');
add('permanent-group-pace',c=>{c.plus!.groupPace='permanent';});
add('no-passing',c=>{c.plus!.passing=false;});
add('no-moving-observation',c=>{c.plus!.localObservation=false;});
add('utility-only-manager',c=>{c.plus!.executeInstructions=false;});
add('trust-dependent-acceptance',c=>{c.plus!.fixedAcceptance=false;});
add('no-adaptive-individuals',c=>{c.adaptive.agents=false;});
add('adaptive-managers',c=>{c.adaptive.staticPlan=false;});
add=suite('devices',73202,20);add('combined',()=>{},combined);
add('same-plan-no-led',c=>{c.led.enabled=false;},combined);
add('same-plan-no-barriers',c=>{c.plus!.barriers=[];},combined);
add('same-plan-neither',c=>{c.led.enabled=false;c.plus!.barriers=[];},combined);
add('same-layout-static-strips',c=>{for(const s of c.plus!.signs)s.mode='static';},combined);
add('same-layout-dynamic-strips',c=>{for(const s of c.plus!.signs)s.mode='dynamic';},combined);
add('same-layout-wall-signs',c=>{for(const s of c.plus!.signs){s.strip=undefined;s.mode='static';}},combined);
add=suite('obstructions',73203,20);
for(const link of ['F3','FC2','D3'])for(const [id,origin] of [['selected',selected],['combined',combined],['without-barriers',combined]] as const){
 if(id==='combined'&&JSON.stringify(selected)===JSON.stringify(combined))continue;
 add(`${id}-${link}`,c=>{c.blocked.links=[link];c.blocked.knowledge='discovery';if(id==='without-barriers')c.plus!.barriers=[];},origin);
}
add('selected-FC2-announced45',c=>{c.blocked.links=['FC2'];c.blocked.knowledge='announced';c.blocked.announceDelay=45;});
add=suite('questions',73204,20);
const ordinary=plusConfig(concertDeparture());ordinary.crowdManagers.count=6;ordinary.adaptive.agents=true;ordinary.adaptive.staticPlan=true;
// Staff are present in the model; no emergency redirection is issued in ordinary departure.
ordinary.crowdManagers.activationMedian=1e9;ordinary.label='Q1 ordinary departure: six staff present, no emergency instruction';
add('Q1-ordinary',()=>{},ordinary,'Ordinary preset assumptions; six staff present but emergency instruction inactive.');
add('Q1-exit-guidance',c=>{c.crowdManagers.activationMedian=10;c.crowdManagers.plan=selected.crowdManagers.plan;c.crowdManagers.placement=selected.crowdManagers.placement;},ordinary,'Operational sensitivity: ordinary departure with active exit directions.');
const students=plusConfig(lecture());students.adaptive.agents=true;students.crowdManagers.count=0;students.population.familiarityProb=1;
for(const key of Object.keys(students.population.exitKnowledge))students.population.exitKnowledge[key as keyof typeof students.population.exitKnowledge]=1;
add('Q3-students',()=>{},students,'Competition specifies students know emergency exits. Remaining lecture demographics and response are inherited assumptions.');
add('Q3-students-static-devices',c=>{c.led.enabled=combined.led.enabled;c.plus!.signs=structuredClone(combined.plus!.signs);for(const s of c.plus!.signs)s.mode='static';c.plus!.barriers=structuredClone(combined.plus!.barriers);},students,'No managers: static public signs, same physical installations; no fictitious radio controller.');
add('Q3-response-concert',c=>{c.premovement.responseMedian=14;},students,'Response uncertainty, not an operational improvement.');
add=suite('uncertainty',73205,12);add('selected');
for(const v of [1.1,1.3])add(`speed-${v}`,c=>{c.population.speedMean=v;});
for(const v of [.5,.6,1.06])add(`headway-${v}`,c=>{c.movement.timeHeadway=v;});
add('row-0.6',c=>{c.movement.rowSpeed=.6;});add('density-3.5',c=>{c.movement.maxDensity=3.5;});
for(const v of [.85,1.15])add(`stair-factor-${v}`,c=>{c.population.stairRatio*=v;c.population.stairRatioUp*=v;});
for(const v of [.9,1.1])add(`gate-flow-factor-${v}`,c=>{c.movement.doorFlow*=v;c.movement.stairFlow*=v;});
for(const v of [.8,1.2])add(`response-factor-${v}`,c=>{c.premovement.responseMedian*=v;});
for(const v of [.6,.9])add(`manager-acceptance-${v}`,c=>{c.crowdManagers.complianceProb=v;});
for(const v of [.5,.9])add(`led-detection-${v}`,c=>{for(const s of c.plus!.signs)s.detection=v;},combined);
for(const v of [.6,.9])add(`led-acceptance-${v}`,c=>{for(const s of c.plus!.signs)s.acceptance=v;},combined);
for(const v of [4,12])add(`led-range-${v}`,c=>{for(const s of c.plus!.signs)s.range=v;},combined);
add('combined-reference',()=>{},combined);
add=suite('numerics',73206,20);for(const dt of [.1,.05,.025,.0125])add(`dt-${dt}`,c=>{c.movement.dt=dt;});
if(process.argv.includes('--check-protocol')){
 if(JSON.stringify(read('supplement-protocol').suites)!==JSON.stringify(suites))throw Error('Supplement differs from its frozen protocol');
 console.log('Frozen supplemental cases, configurations and seed bases match.');process.exit(0);
}
const sourceHash=hashTree('src');
if(existsSync(`${root}/supplement-source.json`)&&!existsSync(`${root}/supplement-protocol-source.json`))writeFileSync(`${root}/supplement-protocol-source.json`,readFileSync(`${root}/supplement-source.json`));
snapshotSource(`${root}/supplement-source.json`);
const protocolPath=`${root}/supplement-protocol.json`;
if(existsSync(protocolPath)){
 const declared=read('supplement-protocol');
 if(JSON.stringify(declared.suites)!==JSON.stringify(suites))throw Error('Supplement differs from its frozen protocol');
}else writeFileSync(protocolPath,JSON.stringify({frozenAt:new Date().toISOString(),sourceHash,note:'No supplementary result changes the independently selected policy. Physical changes are labeled uncertainty only. Withhold barrier installation recommendation if any tested closure yields an unresolved run or paired mean deterioration above 5 s against the same plan without barriers; this is a research material-harm screen, not a safety limit.',suites},null,1));
// Checkpoints retain every completed case. Worker allocation changes scheduling only.
const workers=()=>{
 let finished=false;try{finished=read('final-resolution').cases.length===2;}catch{}
 return Math.max(1,Number(finished?process.env.PLUS_WORKERS_AFTER_RESOLUTION??4:process.env.PLUS_WORKERS??4));
};
let pool=new SimPool(workers());
try{for(const s of suites){const seeds=batchSeeds(s.base,s.n),existing=existsSync(`${root}/${s.name}.json`)?read(s.name):undefined,cases:any[]=existing?.cases??[];
 if(existing&&(existing.sourceHash!==sourceHash||JSON.stringify(existing.seeds)!==JSON.stringify(seeds)))throw Error('Supplement checkpoint has different source or seeds');
 for(const done of cases){const declared=s.cases.find(c=>c.id===done.id);if(!declared||JSON.stringify(done.cfg)!==JSON.stringify(declared.cfg)||done.runs.length!==s.n)throw Error('Invalid supplement checkpoint '+done.id);}
 for(const c of s.cases){if(cases.some(done=>done.id===c.id))continue;
  const wanted=workers();if(wanted!==pool.size){await pool.close();pool=new SimPool(wanted);console.log('Supplement worker allocation',wanted);}
  const runs=await pool.run(c.cfg,seeds,'Plus');cases.push({...c,runs,stats:summarize(runs.map(r=>r.tEvac))});writeFileSync(`${root}/${s.name}.json`,JSON.stringify({sourceHash,seeds,cases},null,1));console.log(s.name,c.id,summarize(runs.map(r=>r.tEvac)).mean,runs.filter(r=>r.unresolvedInside>0).length);}
}}finally{await pool.close();}
