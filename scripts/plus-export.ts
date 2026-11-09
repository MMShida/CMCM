/** Export the same installation and manager geometry used by the engine, for publication. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
import {PlusSimulation} from '../src/plus/PlusSimulation';
import {barrierGeometry} from '../src/plus/Installations';
import {resources} from '../src/plus/Costs';
const root='results/plus-study',roles=JSON.parse(readFileSync(`${root}/selection-roles.json`,'utf8'));
if(existsSync(`${root}/staff-expanded-config.json`))roles.cases.push({id:'expanded-staff',cfg:JSON.parse(readFileSync(`${root}/staff-expanded-config.json`,'utf8'))});
const layouts=roles.cases.map((c:any)=>{const s=new PlusSimulation(geo,c.cfg,1);return {id:c.id,cfg:c.cfg,geo:s.geo,posts:s.guidance.cms.map(m=>({...m.post,id:m.idx+1})),barriers:c.cfg.plus.barriers.filter((b:any)=>b.enabled).map((b:any)=>({...b,...barrierGeometry(geo,b)})),resources:resources(c.cfg)};});
writeFileSync(`${root}/layouts.json`,JSON.stringify(layouts,null,1));
