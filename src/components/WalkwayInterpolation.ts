import type {NavGraph} from '../geometry/NavigationGraph';

/** Rendering only: interpolate distance along the actual walkway, never its chord. */
export function walkwayPoint(g:NavGraph,from:number,to:number,s0:number,s1:number,lat0:number,lat1:number,alpha:number,out:Float64Array):boolean{
 if(from<0||to<0)return false;
 if(from===to){g.pointAt(to,s0+(s1-s0)*alpha,lat0+(lat1-lat0)*alpha,out);return true;}
 const A=g.links[from],B=g.links[to];
 const node=[A.a,A.b].find(n=>n===B.a||n===B.b);
 if(node===undefined)return false;
 const end=node===A.a?0:A.len,start=node===B.a?0:B.len;
 const d0=Math.abs(end-s0),d1=Math.abs(s1-start),d=alpha*(d0+d1);
 if(d<=d0&&d0>1e-9)g.pointAt(from,s0+(end-s0)*d/d0,lat0*(1-d/d0),out);
 else{const u=d1>1e-9?(d-d0)/d1:1;g.pointAt(to,start+(s1-start)*u,lat1*u,out);}
 return true;
}
