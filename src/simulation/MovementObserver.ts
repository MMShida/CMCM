/** Optional read-only movement diagnostics. Hooks must not alter agents or draw randomness. */
export interface MovementObserver {
  limit(agent:number,reason:string,before:number,after:number,dt:number,link:number):void;
  block(agent:number,reason:string,dt:number,link:number):void;
  transition(agent:number,from:number,to:number,velocity:number,carried:number,dt:number):void;
}
