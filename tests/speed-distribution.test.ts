import {expect,it} from 'vitest';
import {createPopulation} from '../src/simulation/Population';
import {defaultConfig} from '../src/simulation/Params';
import {BAILEY_HALL as geo} from '../src/geometry/BaileyHall';
it('optional speed shape preserves all other audience draws and wheelchair speed',()=>{
 const c=defaultConfig(),normal=createPopulation(geo,c,73101);c.population.speedDistribution='normal';const explicit=createPopulation(geo,c,73101);
 expect(explicit.agents.map(a=>a.v0)).toEqual(normal.agents.map(a=>a.v0));
 c.population.speedDistribution='lognormal';const skew=createPopulation(geo,c,73101);
 const traits=(p:typeof normal)=>p.agents.map(a=>[a.seat,a.elderly,a.radius,a.group,a.type,a.uCM,a.uLED,a.uLEDsee,a.tRecognition,a.tResponse,a.tPrepare,a.knownExits]);
 expect(traits(skew)).toEqual(traits(normal));expect(skew.groups).toEqual(normal.groups);
 expect(skew.agents.filter(a=>a.wheelchair).map(a=>a.v0)).toEqual([.8,.8,.8]);
 expect(skew.agents.every(a=>a.v0>=c.population.speedMin&&a.v0<=c.population.speedMax)).toBe(true);
});
it('lognormal shape matches the requested pre-clipping arithmetic mean and SD',()=>{
 const c=defaultConfig();Object.assign(c.population,{speedDistribution:'lognormal',speedMean:1.4,speedSd:.25,elderlyFraction:0,speedMin:.01,speedMax:10});
 const values=Array.from({length:12},(_,i)=>createPopulation(geo,c,10000+i).agents.filter(a=>!a.wheelchair).map(a=>a.v0)).flat();
 const mean=values.reduce((s,x)=>s+x,0)/values.length,sd=Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/(values.length-1)),skew=values.reduce((s,x)=>s+((x-mean)/sd)**3,0)/values.length;
 expect(Math.abs(mean-1.4)).toBeLessThan(.01);expect(Math.abs(sd-.25)).toBeLessThan(.01);expect(skew).toBeGreaterThan(.3);
});
