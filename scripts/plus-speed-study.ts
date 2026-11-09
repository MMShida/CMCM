/** User-requested speed/shape follow-up, prespecified independently of target outcomes. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createPopulation} from '../src/simulation/Population';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import {batchSeeds,summarize} from '../src/simulation/MonteCarlo';
import {SimPool} from './pool';
import {snapshotSource,hashTree} from './research-study';
const root='results/plus-study';
const conditions=[{mean:1.2,family:'normal'},{mean:1.35,family:'normal'},{mean:1.4,family:'normal'},{mean:1.5,family:'normal'},{mean:1.2,family:'lognormal'},{mean:1.4,family:'lognormal'}] as const;
const protocol={frozenAt:new Date().toISOString(),conditions,confirmation:{mean:1.4,family:'normal',runs:100,base:73101},pilot:{runs:20,base:73301},note:'The 1.4 m/s clipped-normal alternative is declared before any speed-study outcome, motivated by controlled free corridor measurements. It is not chosen as the fastest sensitivity. Original age fraction/factor, SD .25, wheelchair speed, rows, headway, gates, response and geometry remain. This is an externally bounded alternative calibration, not empirical Bailey validation. The original 1.2 primary freeze and all results remain. Same frozen operational policy; no policy search on confirmation audiences.',references:['https://arxiv.org/abs/1811.10883','https://pmc.ncbi.nlm.nih.gov/articles/PMC3873946/']};
if(!existsSync(`${root}/speed-protocol.json`))writeFileSync(`${root}/speed-protocol.json`,JSON.stringify(protocol,null,2));
while(!existsSync(`${root}/selection-roles.json`))await new Promise(r=>setTimeout(r,1000));
const base=JSON.parse(readFileSync(`${root}/selected-config.json`,'utf8')),sourceHash=hashTree('src');snapshotSource(`${root}/speed-source.json`);
const pool=new SimPool(4),cases:any[]=[];
try{
 for(const condition of conditions){const cfg=structuredClone(base);cfg.population.speedMean=condition.mean;cfg.population.speedDistribution=condition.family;const seeds=batchSeeds(73301,20),runs=await pool.run(cfg,seeds,'Plus');
  const people=seeds.flatMap(seed=>createPopulation(geo,cfg,seed).agents.filter(a=>!a.wheelchair).map(a=>({v:a.v0,elderly:a.elderly})));const observed={all:summarize(people.map(a=>a.v)),younger:summarize(people.filter(a=>!a.elderly).map(a=>a.v)),older:summarize(people.filter(a=>a.elderly).map(a=>a.v))};
  const c={id:`${condition.family}-${condition.mean}`,cfg,runs,stats:summarize(runs.map(r=>r.tEvac)),sampledSpeed:observed};cases.push(c);writeFileSync(`${root}/speed-sensitivity.json`,JSON.stringify({sourceHash,seeds,cases},null,1));console.log(c.id,c.stats.mean,observed.all.mean);
 }
 const cfg=structuredClone(base);cfg.population.speedMean=1.4;cfg.population.speedDistribution='normal';cfg.label='A-Lite+ 1.4 m/s research-bounded alternative; same six-manager policy';
 writeFileSync(`${root}/speed-alternative-config.json`,JSON.stringify(cfg,null,1));
 const seeds=batchSeeds(73101,100),runs=await pool.run(cfg,seeds,'Plus');writeFileSync(`${root}/speed-confirmation.json`,JSON.stringify({sourceHash,seeds,cases:[{id:'speed-alternative-1.4',cfg,runs,stats:summarize(runs.map(r=>r.tEvac))}]},null,1));console.log('speed alternative confirmation',summarize(runs.map(r=>r.tEvac)));
}finally{await pool.close();}
