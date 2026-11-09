import type { GeometryData } from '../geometry/types';
import type { GuidanceSign, SimConfig } from './Params';
import { opaquePanelIds } from './Barriers';

type Segment = { ax: number; ay: number; bx: number; by: number; floor: number };
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Includes touching an obstacle; ignores the observer/sign endpoint itself. */
export function blocksSight(x: number, y: number, sx: number, sy: number, w: Segment): boolean {
  const rx = sx - x, ry = sy - y, dx = w.bx - w.ax, dy = w.by - w.ay;
  const den = cross(rx, ry, dx, dy), qx = w.ax - x, qy = w.ay - y;
  if (Math.abs(den) < 1e-9) {
    if (Math.abs(cross(qx, qy, rx, ry)) > 1e-8) return false;
    const len2 = rx * rx + ry * ry;
    if (len2 < 1e-12) return false;
    const t0 = (qx * rx + qy * ry) / len2, t1 = ((w.bx - x) * rx + (w.by - y) * ry) / len2;
    return Math.max(t0, t1) > 1e-6 && Math.min(t0, t1) < 1 - 1e-6;
  }
  const t = cross(qx, qy, dx, dy) / den, u = cross(qx, qy, rx, ry) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u >= -1e-8 && u <= 1 + 1e-8;
}

/** Two-dimensional sign catchment approximation (Filippidis et al., 2021).
 * Walls/columns and opaque panels occlude; low ropes/rails do not. No height/crowd optics.
 * Each sign carries one fixed message, never an origin-dependent personalized instruction.
 */
export class SignVisibility {
  private segments: Segment[] = [];
  private sightCells:Map<string,Segment[]>|null=null;
  private indexedSigns=false;
  constructor(geo: GeometryData, private spatial: SimConfig['led']['spatial'], cfg: SimConfig) {
    this.indexedSigns=!!cfg.plus;
    if (!spatial?.occlusion) return;
    for (const wall of geo.walls) if (wall.kind === 'wall' || wall.kind === 'column') {
      for (let i = 1; i < wall.pts.length; i++) this.segments.push({ ax: wall.pts[i - 1][0], ay: wall.pts[i - 1][1], bx: wall.pts[i][0], by: wall.pts[i][1], floor: wall.floor });
    }
    for (const id of opaquePanelIds(cfg).filter(id=>!cfg.plus?.barriers.some(b=>b.enabled&&b.slot===id))) {
      const link = geo.links.find((l) => l.id === id);
      if (!link) continue;
      const a = link.pts[0], b = link.pts[link.pts.length - 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      const nx = -(b[1] - a[1]) / length * link.width / 2, ny = (b[0] - a[0]) / length * link.width / 2;
      this.segments.push({ ax: x - nx, ay: y - ny, bx: x + nx, by: y + ny, floor: link.floor });
    }
    for(const device of cfg.plus?.barriers??[]){if(!device.enabled||device.type!=='opaque-panel')continue;
      const l=geo.links.find(l=>l.id===device.slot);if(!l)continue;
      const p=l.pts[0],q=l.pts[l.pts.length-1],axis=Math.atan2(q[1]-p[1],q[0]-p[0]),angle=axis+device.angle*Math.PI/180;
      // GeometryData may contain the reduced bypass width. Recover original width from span + gap.
      const span=Math.abs(device.length*Math.sin(device.angle*Math.PI/180)),closed=cfg.barriers.includes(device.slot),gap=closed?0:l.width;
      const x=(p[0]+q[0])/2+Math.sin(axis)*gap/2,y=(p[1]+q[1])/2-Math.cos(axis)*gap/2;
      this.segments.push({ax:x-Math.cos(angle)*device.length/2,ay:y-Math.sin(angle)*device.length/2,bx:x+Math.cos(angle)*device.length/2,by:y+Math.sin(angle)*device.length/2,floor:l.floor});
    }
  }

  visible(x:number,y:number,floor:number,sx:number,sy:number,targetFloor:number):boolean {
    if(floor!==targetFloor)return false;
    // Exact uniform-grid ray traversal; the legacy nearest-sign implementation is unchanged.
    const cell=3;
    if(!this.sightCells){this.sightCells=new Map();for(const w of this.segments){
      for(let i=Math.floor(Math.min(w.ax,w.bx)/cell);i<=Math.floor(Math.max(w.ax,w.bx)/cell);i++)for(let j=Math.floor(Math.min(w.ay,w.by)/cell);j<=Math.floor(Math.max(w.ay,w.by)/cell);j++){
        const k=`${w.floor}:${i}:${j}`,list=this.sightCells.get(k)??[];list.push(w);this.sightCells.set(k,list);
      }
    }}
    let ix=Math.floor(x/cell),iy=Math.floor(y/cell);const ex=Math.floor(sx/cell),ey=Math.floor(sy/cell),dx=sx-x,dy=sy-y,stepX=Math.sign(dx),stepY=Math.sign(dy),deltaX=dx?cell/Math.abs(dx):Infinity,deltaY=dy?cell/Math.abs(dy):Infinity;
    let tx=dx?((ix+(dx>0?1:0))*cell-x)/dx:Infinity,ty=dy?((iy+(dy>0?1:0))*cell-y)/dy:Infinity;
    const visited=new Set<Segment>();
    // Preserve exact boundary-touch semantics without allocating three closures per ray.
    const onX=Math.abs(x/cell-Math.round(x/cell))<1e-10&&dx===0;
    const onY=Math.abs(y/cell-Math.round(y/cell))<1e-10&&dy===0;
    for(let guard=0;guard<10000;guard++){
      if(this.checkCell(x,y,sx,sy,floor,ix,iy,onX,onY,visited))return false;if(ix===ex&&iy===ey)return true;
      if(Math.abs(tx-ty)<1e-12){if(this.checkCell(x,y,sx,sy,floor,ix+stepX,iy,onX,onY,visited)||this.checkCell(x,y,sx,sy,floor,ix,iy+stepY,onX,onY,visited))return false;ix+=stepX;iy+=stepY;tx+=deltaX;ty+=deltaY;}
      else if(tx<ty){ix+=stepX;tx+=deltaX;}else{iy+=stepY;ty+=deltaY;}
    }
    throw Error('Visibility traversal did not terminate');
  }

  private blockedCell(x:number,y:number,sx:number,sy:number,floor:number,i:number,j:number,visited:Set<Segment>){
    const walls=this.sightCells!.get(`${floor}:${i}:${j}`);if(!walls)return false;
    for(const w of walls){if(visited.has(w))continue;visited.add(w);if(blocksSight(x,y,sx,sy,w))return true;}return false;
  }
  private checkCell(x:number,y:number,sx:number,sy:number,floor:number,i:number,j:number,onX:boolean,onY:boolean,visited:Set<Segment>){
    return this.blockedCell(x,y,sx,sy,floor,i,j,visited)||(onX&&this.blockedCell(x,y,sx,sy,floor,i-1,j,visited))||(onY&&this.blockedCell(x,y,sx,sy,floor,i,j-1,visited));
  }

  nearest(x: number, y: number, floor: number): GuidanceSign | undefined {
    const s = this.spatial;
    if (!s) return;
    let best: GuidanceSign | undefined, distance = Infinity;
    for (const sign of s.signs) {
      if (sign.strip) {
        if (floor !== sign.floor) continue;
        const points = sign.strip.points;
        for (let i = 1; i < points.length; i++) {
          const [ax,ay]=points[i-1], [bx,by]=points[i], dx=bx-ax, dy=by-ay;
          const length2=dx*dx+dy*dy;
          const nearest=length2?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length2)):0;
          // Project onto each segment and sample at <=0.5 m intervals for partly occluded strips.
          const n=Math.max(1,Math.ceil(Math.sqrt(length2)/0.5));
          for(let j=-1;j<=n;j++) {
            const u=j<0?nearest:j/n;
            const sx=ax+u*dx,sy=ay+u*dy,d=Math.hypot(x-sx,y-sy);
            if(d>s.range||d>=distance)continue;
            if(s.occlusion&&(this.indexedSigns?!this.visible(x,y,floor,sx,sy,floor):this.segments.some(w=>w.floor===floor&&blocksSight(x,y,sx,sy,w))))continue;
            best=sign;distance=d;
          }
        }
        continue;
      }
      const dx = x - sign.x, dy = y - sign.y, d = Math.hypot(dx, dy);
      if (floor !== sign.floor || d > s.range || d >= distance) continue;
      const radians = sign.facingDegrees * Math.PI / 180;
      if (d > 1e-9 && (dx * Math.cos(radians) + dy * Math.sin(radians)) / d < Math.cos(s.halfAngleDegrees * Math.PI / 180) - 1e-9) continue;
      if (s.occlusion && (this.indexedSigns?!this.visible(x,y,floor,sign.x,sign.y,floor):this.segments.some((w) => w.floor === floor && blocksSight(x, y, sign.x, sign.y, w)))) continue;
      best = sign; distance = d;
    }
    return best;
  }
}
