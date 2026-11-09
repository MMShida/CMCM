import {LiteMovement} from '../lite/LiteMovement';
import type {Agent} from '../simulation/Agent';
/** Same service/storage equations. Local group pacing and actual distance-integrated travel. */
export class PlusMovement extends LiteMovement {
  protected override speed(a:Agent,li:number,dir:number){
    if(this.sim.cfg.plus?.groupPace==='permanent')return super.speed(a,li,dir);
    let pace=a.v0;
    if(a.group>=0&&!this.sim.groupBroken[a.group]&&!this.sim.cfg.population.groupMeetOutside){
      // Existing 4 m cohesion scale; only nearby visible group members on this passage.
      // A queued member contributes their FREE pace, not zero, avoiding a synthetic deadlock.
      for(const id of this.sim.groups[a.group]){const b=this.sim.agents[id];
        if(b.link===li&&b.dir===dir&&!b.done&&Math.abs(b.sDir-a.sDir)<=this.sim.cfg.movement.groupCohesionDist)pace=Math.min(pace,b.v0);
      }
    }
    const old=this.groupPace[a.id];this.groupPace[a.id]=pace;
    const v=super.speed(a,li,dir);this.groupPace[a.id]=old;return v;
  }
  override step(dt:number){
    const t0=this.sim.t-dt;
    for(const a of this.sim.agents){if(a.link<0||this.ready[a.id]<=t0)continue;
      const v=this.speed(a,a.link,a.dir),remaining=Math.max(0,this.ready[a.id]-t0)*Math.max(.05,a.v);
      this.ready[a.id]=t0+remaining/v;
    }
    if(this.sim.cfg.plus?.passing)for(const l of this.g.links){
      if(l.isRow||l.gate||l.width<1.8||l.lanes<2)continue;
      for(let d=0;d<2;d++){const count=this.allowedLanes(l.idx,d),qs=this.lanes[l.idx][d];
        // Moving followers can use a genuinely empty, same-direction parallel lane.
        // Never rearrange a saturated door queue or move across a link boundary.
        for(let k=0;k<count;k++)if(qs[k].length===0){const donor=qs.slice(0,count).find(q=>q.length>1&&this.ready[q[1]]<this.ready[q[0]]&&this.ready[q[1]]>this.sim.t);if(!donor)continue;
          const id=donor.splice(1,1)[0];qs[k].push(id);this.sim.agents[id].lane=k;
        }
      }
    }
    super.step(dt);
  }
}
