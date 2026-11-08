/** Reproducible guidance/barrier study from 3e4bcf0. No population/geometry optimisation.
 * node --import tsx scripts/research-study.ts --mode screen --runs 6 --workers 3
 * node --import tsx scripts/research-study.ts --mode evaluate --cases configs.json --runs 40 --seed 20261108
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAILEY_HALL, slotId } from '../src/geometry/BaileyHall';
import type { ExitGroupId } from '../src/geometry/types';
import type { SimConfig } from '../src/simulation/Params';
import { defaultConfig } from '../src/simulation/Params';
import { OPTIMISED_PLAN, scenarioById } from '../src/simulation/Scenarios';
import { expandPlan } from '../src/simulation/Plan';
import { batchSeeds, summarize, wilson } from '../src/simulation/MonteCarlo';
import type { RunSummary } from '../src/simulation/MonteCarlo';
import { SimPool } from './pool';

const arg = (k: string, d: string) => process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d;
const mode = arg('mode', 'screen'), out = arg('out', `results/research-180/${mode}.json`);
const seeds = batchSeeds(Number(arg('seed', '9001')), Number(arg('runs', '6')));
const models = arg('models', 'A,B').split(',') as ('A'|'B')[];
export interface Case { id: string; cfg: SimConfig; scope?: string; models?: ('A'|'B')[] }

export function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p); else { h.update(p); h.update(readFileSync(p)); }
    }
  };
  walk(dir); return h.digest('hex');
}

/** Store the exact sources with confirmation batches, including newly added files. */
export function snapshotSource(out: string) {
  const files:Record<string,string>={};
  const visit=(d:string)=>{for(const f of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(d,f.name);if(f.isDirectory())visit(p);else files[p]=readFileSync(p,'utf8');}};
  visit('src');writeFileSync(out,JSON.stringify({sourceHash:hashTree('src'),files}));
}

/** This guard rejects the tempting shortcuts to 180, including perfect compliance. */
export function assertScope(c: SimConfig) {
  const b = defaultConfig();
  if (c.crowdManagers.vacatedRowGuidance) throw new Error('Vacated-row routing is a separate Model A assumption sensitivity');
  for (const k of ['occupancy','population','premovement','movement','environment','alarm','assist','stress','blocked','routing','tMax'] as const)
    if (JSON.stringify(c[k]) !== JSON.stringify(b[k])) throw new Error(`Outside guidance/barrier scope: ${k}`);
  for (const k of ['activationMedian','activationSigma','radius','hearRate','complianceProb'] as const)
    if (c.crowdManagers[k] !== b.crowdManagers[k]) throw new Error(`Uncalibrated staff parameter change: ${k}`);
  if (c.preassign.reachProb !== b.preassign.reachProb || c.preassign.complianceProb !== b.preassign.complianceProb) throw new Error('Preassignment calibration changed');
  if (c.led.perceiveProb !== b.led.perceiveProb || c.led.complianceProb !== b.led.complianceProb) throw new Error('Sign compliance changed');
}

export function describe(r: RunSummary[]) {
  const failures = r.filter(x => !x.allLeftBuilding || x.N !== 1329 || x.unresolvedInside || !Number.isFinite(x.tEvac));
  const t = summarize(r.map(x=>x.tEvac));
  const avg = (f: (r:RunSummary)=>number)=>r.reduce((s,x)=>s+f(x),0)/r.length;
  return { n:r.length, failures: failures.length, mean: failures.length ? null : t.mean,
    ciLow: failures.length ? null:t.ciLow, ciHigh:failures.length?null:t.ciHigh,
    conditionalCompletionMean:t.mean, sd:t.sd, p95:t.p95, max:t.max,
    p180:wilson(r.filter(x=>x.allLeftBuilding && x.N===1329 && x.tEvac<=180).length,r.length),
    inside180:avg(x=>x.insideAt180??NaN), exposure:avg(x=>x.highDensityExposure),
    usage:Object.fromEntries(Object.keys(r[0].exitGroupUsage).map(k=>[k,avg(x=>x.exitGroupUsage[k]??0)])),
    lastZones: r.reduce((a,x)=>{ for (const [z,n] of Object.entries(x.lastOut?.zones??{})) a[z]=(a[z]??0)+n;return a;},{} as Record<string,number>) };
}

export function screenCases(): Case[] {
  const cases: Case[]=[];
  const push=(id:string,cfg:SimConfig,scope='primary')=>cases.push({id,cfg,scope});
  const fixed=defaultConfig(); push('mateus-fixed',fixed);
  const both=structuredClone(fixed); both.adaptive.agents=both.adaptive.managers=true;push('mateus-both',both);
  const part=structuredClone(both);part.adaptive.redirectMode='partial';part.adaptive.redirectMargin=15;push('mateus-partial15',part);
  for (const [id,c] of [['fixed',fixed],['both',both],['partial15',part]] as const) {
    const n=structuredClone(c); n.numerics={conserveService:true};push(`service-${id}`,n);
  }
  for (const a of ['fixed','both'] as const) for (const count of [6,10]) {
    const c=structuredClone(a==='both'?both:fixed);c.numerics={conserveService:true};c.crowdManagers.count=count;
    c.crowdManagers.plan={...OPTIMISED_PLAN};c.preassign.enabled=true;c.preassign.plan={...OPTIMISED_PLAN};c.led.enabled=true;c.led.plan={...OPTIMISED_PLAN};
    push(`opt-${a}-${count}`,c);
    for (const pair of [0,1,2]) {const b=structuredClone(c);b.barriers=['W'+pair,'E'+pair].map(s=>slotId(BAILEY_HALL,s));push(`opt-${a}-${count}-panel${pair}`,b);}
  }
  // Geometrically paired plans, avoiding the asymmetric choices in the inherited optimiser output.
  for (const pattern of ['split','portico','foyer','frontstage','balanced'] as const) for (const a of ['fixed','both'] as const) {
    const c=structuredClone(a==='both'?both:fixed);c.numerics={conserveService:true};c.crowdManagers.count=10;
    const plan=expandPlan(fixed.crowdManagers.plan,BAILEY_HALL);
    for (const key of Object.keys(plan)) {
      const [z,side,band]=key.split(':');
      if (z.startsWith('ORCH_C')) {
        const front=pattern==='balanced'?band==='F':z==='ORCH_C_FRONT';
        plan[key]=(pattern==='portico'?'PORTICO_'+side:pattern==='foyer'?'FOYER':pattern==='frontstage'&&front?'STAGE_'+side:front?'PORTICO_'+side:'FOYER') as ExitGroupId;
      }
    }
    c.crowdManagers.plan={...plan};c.preassign.enabled=true;c.preassign.plan={...plan};c.led.enabled=true;c.led.plan={...plan};
    push(`${pattern}-${a}`,c);
    const p=structuredClone(c);p.barriers=['W1','E1'].map(s=>slotId(BAILEY_HALL,s));push(`${pattern}-${a}-panel1`,p);
    if(pattern==='split'||pattern==='portico')for(const penalty of [5,15,30]) {
      const r=structuredClone(c);r.barriers=['W1','E1'].map(s=>slotId(BAILEY_HALL,s));r.barrierTypes=Object.fromEntries(r.barriers.map(id=>[id,'soft-rope']));r.ropePenalty=penalty;push(`${pattern}-${a}-rope${penalty}`,r);
    }
  }
  // Reproduce Mateus's larger package, explicitly excluded from the strict search.
  push('mateus-package',scenarioById('package-180'),'inherited package: voice alarm + all groups meet outside');
  return cases;
}

async function main() {
  mkdirSync(dirname(out),{recursive:true});
  const cases: Case[]=mode==='screen'?screenCases():JSON.parse(readFileSync(arg('cases',''),'utf8'));
  const only=arg('only','').split(',').filter(Boolean);
  const selected=only.length?cases.filter(c=>only.includes(c.id)):cases;
  const meta={baseCommit:'3e4bcf08e258e5db41b0035e307415bf129bc011',sourceHash:hashTree('src'),geometryHash:createHash('sha256').update(readFileSync('src/data/geometry/bailey-hall.json')).digest('hex'),date:new Date().toISOString(),seeds,models};
  snapshotSource(out.replace(/\.json$/,'')+'-source.json');
  const rows:unknown[]=[];
  const pool=new SimPool(Number(arg('workers','3')));
  try {
    for(const c of selected){
      if(!c.scope||c.scope==='primary')assertScope(c.cfg);
      for(const m of models){
        if(c.models&&!c.models.includes(m))continue;
        if(m==='B'&&c.cfg.adaptive.redirectMode==='partial')continue; // no fake Model B partial policy
        if(m==='B'&&c.cfg.crowdManagers.vacatedRowGuidance)continue;
        const runs=await pool.run(c.cfg,seeds,m);const stats=describe(runs);
        const row={id:c.id,model:m,scope:c.scope??'primary',cfg:c.cfg,stats,runs};rows.push(row);
        writeFileSync(out,JSON.stringify({...meta,results:rows},null,1));
        console.log(`${m} ${c.id}: ${stats.mean?.toFixed(2)??'UNRESOLVED'} [${stats.ciLow?.toFixed(1)},${stats.ciHigh?.toFixed(1)}] failures=${stats.failures} P180=${stats.p180.p.toFixed(2)} inside180=${stats.inside180.toFixed(1)}`);
      }
    }
  } finally {await pool.close();}
}
if (resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e);process.exitCode=1;});
