"""Build failure-aware tables/plots from saved runs; requires matplotlib for standalone plots."""
from pathlib import Path
import json,math,csv,statistics,gzip
ROOT=Path(__file__).resolve().parents[1];R=ROOT/'results/lite-study';D=ROOT/'docs/research-180';F=D/'figures'
def load(name):
    p=R/name
    return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def fmt(x,n=1):return 'unresolved' if x is None or not math.isfinite(x) else f'{x:.{n}f}'
def mean(xs):return statistics.mean(xs) if xs else float('nan')
def paired(runs,ref):
    b={x['seed']:x for x in ref};v=[]
    for r in runs:
        q=b.get(r['seed']);
        if not q or not r['allLeftBuilding'] or not q['allLeftBuilding'] or r['tEvac'] is None or q['tEvac'] is None:return None
        v.append(r['tEvac']-q['tEvac'])
    n=len(v);z=1.959964;df=n-1;t=z+(z**3+z)/(4*df)+(5*z**5+16*z**3+3*z)/(96*df*df)
    half=t*statistics.stdev(v)/math.sqrt(n);m=mean(v);return dict(mean=m,lo=m-half,hi=m+half)
def table(rows,ref=None):
    s='| Configuration / model | Mean [95% CI], s | Median / p95, s | SD, s | ≤180 | Failures |\n|---|---|---|---|---|---|\n'
    for r in rows:
        x=r['stats']
        estimate='Unresolved' if x['failures'] else f"{fmt(x['mean'])} [{fmt(x['ciLow'])}, {fmt(x['ciHigh'])}]"
        quantiles='—' if x['failures'] else f"{fmt(x['median'])} / {fmt(x['p95'])}"
        sd='—' if x['failures'] else fmt(x['sd'])
        s+=f"| {r['id']} / {r['model']} | {estimate} | {quantiles} | {sd} | {round(x['p180']['p']*x['n'])}/{x['n']} | {x['failures']} |\n"
    return s

def main():
    data=load('confirmation.json');rows=data['results'];selection=load('selection.json');ref=next(r for r in rows if r['id']=='original-0420' and r['model']=='A')
    for r in rows:r['pairedAgainstOriginalA']=paired(r['runs'],ref['runs'])
    columns=['id','model','n','mean','ciLow','ciHigh','median','p95','sd','p180','failures','peakDensityMax','regionalPeakMax','exposureMean','runtimeMeanMs','pairedMean','pairedLow','pairedHigh']
    with (R/'comparisons.csv').open('w') as f:
        w=csv.DictWriter(f,fieldnames=columns,lineterminator="\n");w.writeheader()
        for r in rows:
            x=r['stats'];p=r['pairedAgainstOriginalA'];w.writerow({**{k:r[k] for k in ['id','model']},**{k:x[k] for k in columns if k in x and k!='p180'},'p180':x['p180']['p'],'pairedMean':p['mean'] if p else '', 'pairedLow':p['lo'] if p else '', 'pairedHigh':p['hi'] if p else ''})
    (R/'comparison-table.md').write_text(table(rows))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'font.size':9,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none'})
    fig,ax=plt.subplots(figsize=(7.2,2.6),layout='constrained')
    chosen=[r for r in rows if (r['id'],r['model']) in [('original-0420','A'),('best-lite','Lite'),('best-lite','A'),('best-lite','B')]]
    for r in chosen:
        n=max(len(x['inside']) for x in r['runs']);ys=[mean([x['inside'][k] if k<len(x['inside']) else 0 for x in r['runs']]) for k in range(n)]
        ax.plot(range(n),ys,label=f"{r['model']}: {r['id']}")
    ax.axvline(180,color='#b9543c',ls=':',label='180 s');ax.set(xlim=(0,330),xlabel='Time after alarm (s)',ylabel='Mean occupants inside');ax.legend(frameon=False,ncol=2,fontsize=8)
    fig.savefig(F/'lite-clearance.svg');fig.savefig(F/'lite-clearance.png',dpi=180);plt.close(fig)
    fig,ax=plt.subplots(figsize=(7.2,3),layout='constrained')
    complete=[r for r in rows if r['stats']['mean'] is not None]
    labels=[f"{r['id']} / {r['model']}" for r in complete];m=[r['stats']['mean'] for r in complete]
    ax.errorbar(m,range(len(m)),xerr=[[r['stats']['mean']-r['stats']['ciLow'] for r in complete],[r['stats']['ciHigh']-r['stats']['mean'] for r in complete]],fmt='o',color='#16816b',capsize=3)
    ax.set_yticks(range(len(m)),labels);ax.invert_yaxis();ax.axvline(180,color='#b9543c',ls=':');ax.set_xlabel('Mean last-person clearance, s; 95% confidence interval')
    fig.savefig(F/'lite-confirmation.svg');plt.close(fig)
    out={**data,'selection':selection,'results':rows};(R/'final-summary.json').write_text(json.dumps(out,indent=1))
    print(table(rows))
if __name__=='__main__':main()
