import { useEffect, useState } from 'react';
import type { SimConfig } from '../simulation/Params';

interface Row {
  id:string; model:'A'|'B'; label:string; cfg:SimConfig;
  stats:{n:number;mean:number|null;ciLow:number|null;ciHigh:number|null;failures:number;inside180:number;exposure:number;p180:{p:number;lo:number;hi:number}};
}
interface Report {date:string;baseCommit:string;replications:number;conclusion:string;rows:Row[]}
const f=(x:number|null,d=1)=>x===null||!Number.isFinite(x)?'Unresolved':x.toFixed(d);

export function ResearchStudyView({apply}:{apply:(c:SimConfig,model:'A'|'B')=>void}) {
  const [report,setReport]=useState<Report|null>(null),[error,setError]=useState('');
  useEffect(()=>{let alive=true;fetch('/results/research-180-summary.json').then(r=>{if(!r.ok)throw new Error('Completed study results are not available yet.');return r.json();}).then(r=>{if(alive)setReport(r);}).catch(e=>{if(alive)setError(String(e.message));});return()=>{alive=false;};},[]);
  return <div className="panel">
    <h2>180-second research study</h2>
    <p>Full house: 1,329 people, including three wheelchair users. Each result is the mean time for the last person to leave the building across independent audiences.</p>
    <p><a href="/docs/research-180/MODEL_GUIDE.pdf" target="_blank" rel="noreferrer">Model, mathematics and research (PDF)</a> · <a href="/docs/research-180/RESULTS_AND_CHANGES.pdf" target="_blank" rel="noreferrer">Results and changes from 04:20 (PDF)</a></p>
    <p><a href="/docs/research-180/SIMPLIFICATION_AUDIT.pdf" target="_blank" rel="noreferrer">A-Lite specification, audit and comparisons (PDF)</a> · <a href="/docs/research-180/BAILEY_LATEX_SOURCES.zip">LaTeX source bundle</a></p>
    <div className="card"><p><strong>New A-Lite comparison: 191.4 s [188.3, 194.6] on 40 independent full-house audiences.</strong> The same no-barrier policy gives 259.0 s in A and 166.4 s in B. A-Lite uses 18 staff, preassignment and spatial FIFO queues with simpler group motion. It has not reached the mean 180-second target.</p><p className="muted small">The table below preserves the earlier guidance/barrier study. Historical hard-panel cases are research comparisons, not installation recommendations. The A-Lite audit reports the later numerical corrections, failures and finer-step check (188.7 s at 0.025 s).</p></div>
    {error&&<p role="status">{error}</p>}
    {report&&<>
      <div className="card"><p><strong>{report.conclusion}</strong></p><p className="muted small">Matched to Mateus's 04:20 commit {report.baseCommit.slice(0,7)}. Independent confirmation: {report.replications} audiences per configuration. A resolves spatial movement; B uses network queues. A result in one model does not establish the result in the other.</p></div>
      <table className="data"><thead><tr><th>Configuration</th><th>Model</th><th>Mean seconds [95% CI]</th><th>Runs ≤180</th><th>Unresolved runs</th><th>Inside at 180</th><th>Try configuration</th></tr></thead><tbody>
        {report.rows.map(r=><tr key={`${r.model}-${r.id}`}><td>{r.label}</td><td>{r.model}</td><td>{f(r.stats.mean)} [{f(r.stats.ciLow)}, {f(r.stats.ciHigh)}]</td><td>{f(100*r.stats.p180.p,0)}%</td><td>{r.stats.failures}/{r.stats.n}</td><td>{f(r.stats.inside180)}</td><td><button className="btn small" onClick={()=>apply(r.cfg,r.model)}>Load in model {r.model}</button></td></tr>)}
      </tbody></table>
      <p className="muted small">Confidence intervals describe seed-to-seed variability under this model, not uncertainty about the real building. The report also compares density, exposure, sign visibility, staff coverage and barrier types. Building departure and completed assisted travel to street level are separate measures.</p>
    </>}
  </div>;
}
