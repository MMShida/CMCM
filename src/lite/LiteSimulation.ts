import type {GeometryData} from '../geometry/types';
import type {SimConfig} from '../simulation/Params';
import {type EngineExtensions, SimulationEngine} from '../simulation/SimulationEngine';
import {LiteMovement} from './LiteMovement';
/** Separate model; original A remains the default SimulationEngine. */
export class LiteSimulation extends SimulationEngine {
  declare readonly movement:LiteMovement;
  constructor(geo:GeometryData,cfg:SimConfig,seed?:number,extensions:EngineExtensions={}){
    if(cfg.stress.falls||cfg.stress.separatedGroups>0)throw new Error('A-Lite does not represent falls or spatial group reunification');
    super(geo,{...cfg,numerics:{...cfg.numerics,conserveService:true,replanMissingPath:true}},seed,sim=>new LiteMovement(sim),extensions);
  }
  override densityResult(){
    const r=super.densityResult();r.exposure.local='Occupancy / area of the original link; excludes rows and links shorter than 1.5 m';return r;
  }
  override result(opts:{agents?:boolean;heat?:boolean}={}){
    const r=super.result(opts);r.peakDensity=Math.round(this.movement.peakAverageDensity*100)/100;
    r.peakDensityWhere=this.movement.peakAverageLink<0?'-':this.graph.links[this.movement.peakAverageLink].label;return r;
  }
}
