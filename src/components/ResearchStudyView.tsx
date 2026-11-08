import { useEffect, useState } from 'react';
import type { SimConfig } from '../simulation/Params';
import type { StudyReplay } from './MonteCarloPanel';
import {download} from './util';

type Model='A'|'B'|'Lite';
interface Row {
 id:string;model:Model;label:string;cfg:SimConfig;seeds?:number[];times?:{seed:number;tEvac:number|null;tSafe?:number|null}[];
 stats:{n:number;mean:number|null;ciLow:number|null;ciHigh:number|null;failures:number;inside180?:number;p180:{p:number;lo:number;hi:number}};
}
interface Report {conclusion:string;rows:Row[];status?:string}
const f=(x:number|null|undefined,d=1)=>x==null||!Number.isFinite(x)?'Unresolved':x.toFixed(d);
export function ResearchStudyView({apply,replay}:{apply:(c:SimConfig,model:Model)=>void;replay:(r:StudyReplay)=>void}) {
 const [report,setReport]=useState<Report|null>(null),[placements,setPlacements]=useState<Report|null>(null),[error,setError]=useState('');
 useEffect(()=>{let alive=true;Promise.all(['/results/research-180-summary.json','/results/placement-study.json'].map(p=>fetch(p).then(r=>{if(!r.ok)throw Error('Study data unavailable');return r.json();}))).then(([r,p])=>{if(alive){setReport(r);setPlacements(p);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 const table=(rows:Row[])=><table className="data"><thead><tr><th>Configuration</th><th>Model / staff</th><th>Mean seconds [95% CI]</th><th>Runs ≤180</th><th>Unresolved</th><th>Reproduce</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.model}-${r.id}`} data-study-id={r.id} data-model={r.model}>
  <td>{r.label}<br/><small>{r.cfg.barriers.length} barriers · {r.cfg.led.enabled?(r.cfg.led.spatial?'spatial LEDs':'abstract LEDs'):'LEDs off'}</small></td><td>{r.model} / {r.cfg.crowdManagers.count}</td><td>{f(r.stats.mean)} [{f(r.stats.ciLow)}, {f(r.stats.ciHigh)}]</td><td>{Math.round(r.stats.n*r.stats.p180.p)}/{r.stats.n}</td><td>{r.stats.failures}/{r.stats.n}</td><td>
  <button className="btn small" onClick={()=>apply(r.cfg,r.model)}>Load in model {r.model} (seed {r.cfg.seed})</button>
  {r.times?.length&&<><button className="btn small" onClick={()=>apply({...r.cfg,seed:r.times![0].seed},r.model)}>Replay first audience: {f(r.times[0].tEvac)} s</button><button className="btn small" onClick={()=>replay({cfg:r.cfg,model:r.model,seeds:r.times!.map(x=>x.seed),label:r.label,expectedMean:r.stats.mean})}>Reproduce {r.stats.n}-run mean</button></>}
  <button className="btn small" onClick={()=>download(`${r.model}-${r.id}.json`,JSON.stringify(r.cfg,null,2),'application/json')}>Configuration JSON</button>
 </td></tr>)}</tbody></table>;
 return <div className="panel">
  <h2>Six-manager placement study and reproducibility</h2>
  <p>Full house: 1,329 people, including three wheelchair users. Clearance runs from emergency declaration to the last person crossing an exterior building boundary. Travel and assistance to street level continue afterward.</p>
  <p><a href="/docs/research-180/MODEL_GUIDE.pdf" target="_blank" rel="noreferrer">Technical model (PDF)</a> · <a href="/docs/research-180/RESULTS_AND_CHANGES.pdf" target="_blank" rel="noreferrer">Results and changes (PDF)</a> · <a href="/docs/research-180/SIMPLIFICATION_AUDIT.pdf" target="_blank" rel="noreferrer">A-Lite audit (PDF)</a> · <a href="/docs/research-180/BAILEY_LATEX_SOURCES.zip">LaTeX sources</a></p>
  <p className="card"><strong>Why a single Model A run differs from 230 seconds:</strong> the roughly 231-second result is a 40-audience mean for the refined six-manager, W1/E1-panel, pre-announcement and abstract-LED configuration below. It is not the default concert baseline (268.645 s). Use “Replay first audience” for a known seed, or “Reproduce 40-run mean” for the exact batch. The large simulation clock includes subsequent outdoor travel. This app is the 04:20 research checkout; use port 5180 locally if the older checkouts are also running.</p>
  {error&&<p role="status">{error}</p>}
  {placements&&<><h3>Exactly six managers: physical LED strips and corridor barriers</h3><p>{placements.conclusion}</p>{placements.rows.length>0&&<><p><a href="/docs/research-180/figures/placement-layouts.svg" target="_blank" rel="noreferrer">View all LED and barrier locations</a> · <a href="/docs/research-180/figures/placement-selected.svg" target="_blank" rel="noreferrer">View selected six-manager plan</a></p>{table(placements.rows)}</>}</>}
  <details><summary>Historical A/B intervention study and exact replay controls</summary>{report&&<><p>{report.conclusion}</p>{table(report.rows)}</>}</details>
  <details><summary>Earlier staffing sensitivity (18 managers)</summary><p>The earlier A-Lite result, 191.4 s [188.3, 194.6], used 18 managers and preassignment, without LEDs or barriers. The same policy gave 259.0 s in A and 166.4 s in B. It is outside the current six-manager comparison and did not meet 180 seconds in A-Lite.</p></details>
  <p className="muted small">Intervals quantify audience sampling under these assumptions. Engine reproduction is not validation against a Bailey evacuation drill. Incomplete runs remain failures.</p>
 </div>;
}
