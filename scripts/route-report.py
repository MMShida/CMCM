"""Publish the prespecified six-manager route study, including unsuccessful results."""
from pathlib import Path
import json,gzip,math,statistics,re,csv,subprocess
R=Path('results/route-study');D=Path('docs/research-180')
def load(name):
 p=R/(name+'.json');return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def f(x):return 'Unresolved' if x is None or not math.isfinite(x) else f'{x:.1f}'
def table(h,rows):return '| '+' | '.join(h)+' |\n|'+'|'.join('---' for _ in h)+'|\n'+''.join('| '+' | '.join(map(str,r))+' |\n' for r in rows)
def paired(a,b):
 q={r['seed']:r for r in b['runs']};ds=[r['tEvac']-q[r['seed']]['tEvac'] for r in a['runs'] if r['allLeftBuilding'] and q[r['seed']]['allLeftBuilding']]
 if len(ds)!=len(a['runs']):return 'Unresolved'
 n=len(ds);z=1.959964;t=z+(z**3+z)/(4*(n-1))+(5*z**5+16*z**3+3*z)/(96*(n-1)**2);m=statistics.mean(ds);h=t*statistics.stdev(ds)/math.sqrt(n)
 return f'{m:.2f} [{m-h:.2f}, {m+h:.2f}]'
def rows_table(rows):
 return table(['Configuration','Model','Runs','Mean [95% CI], s','At or below 180','Unresolved'],[[r['id'],r['model'],r['stats']['n'],f"{f(r['stats']['mean'])} [{f(r['stats']['ciLow'])}, {f(r['stats']['ciHigh'])}]",f"{round(r['stats']['n']*r['stats']['p180']['p'])}/{r['stats']['n']}",r['stats']['failures']] for r in rows])
opt=load('opt-Lite');screen=load('screen');valid=load('validation');conf=load('confirmation');rob=load('robustness');questions=load('questions');sel=load('selection');overall=load('overall-confirmation');osel=load('overall-selection')
resolution=load('resolution');assert len(resolution['results'])==5,'Resolution study not complete'
assert len(screen['results'])==84 and len(conf['results'])==4 and len(rob['results'])==9 and len(questions['results'])==2 and len(overall['results'])==3,'Study not complete'
get=lambda model:next(r for r in conf['results'] if r['id']=='selected' and r['model']==model)
lite=get('Lite');a=get('A');b=get('B');cfg=lite['cfg'];s=lite['stats'];ref=next(r for r in conf['results'] if r['id']=='previous-combined')
met=s['mean'] is not None and s['ciHigh']<180
outcome='The confirmed interval is below 180 s under this model.' if met else 'A defensible below-180 mean has not been demonstrated.'
primary=next(r for r in overall['results'] if r['model']=='Lite');ps=primary['stats'];pc=primary['cfg']
primary_outcome='Its confirmed interval is below 180 s under A-Lite.' if ps['mean'] is not None and ps['ciHigh']<180 else 'A defensible below-180 mean has not been demonstrated for it.'
fine=next(r for r in resolution['results'] if r['id']=='overall-dt0.0125');fine_combined=next(r for r in resolution['results'] if r['id']=='combined-dt0.0125');fs=fine['stats']
fine_outcome='The finest-step conditional mean interval is below 180 s.' if fs['mean'] is not None and fs['ciHigh']<180 else 'The finest-step study does not demonstrate a mean interval below 180 s.'
conclusion=f"At the original 0.1 s step, A-Lite gives {f(ps['mean'])} s overall and {f(s['mean'])} s with both devices. At the prespecified finest step (0.0125 s), the same plans give {f(fs['mean'])} s [{f(fs['ciLow'])}, {f(fs['ciHigh'])}] and {f(fine_combined['stats']['mean'])} s respectively, on the same 60 fresh audiences. {fine_outcome} These are model predictions, not Bailey drill calibration."
for name,r in [('refined-overall-config',fine),('refined-combined-config',fine_combined)]:
 (R/(name+'.json')).write_text(json.dumps(r['cfg'],indent=1))
public=[]
for r in [fine,fine_combined]+overall['results']+conf['results']:
 public.append({k:r[k] for k in ['id','model','cfg','stats']}|{'label':{'overall-dt0.0125':'Overall plan at 0.0125 s resolution','combined-dt0.0125':'Combined-device plan at 0.0125 s resolution','overall-selected':'Training-selected overall plan at original step','selected':'Training-selected combined-device plan at original step','previous-combined':'Previous six-manager combined plan on the same fresh audiences'}[r['id']],'times':[{k:q.get(k) for k in ['seed','tEvac','tSafe','tSafeAll']} for q in r['runs']]})
Path('public/results/route-study.json').write_text(json.dumps({'status':'complete','conclusion':conclusion,'rows':public},separators=(',',':'))+'\n')
subprocess.run(['python3','scripts/placement-figures.py','--config',str(R/'selected-config.json')],check=True)
subprocess.run(['python3','scripts/placement-figures.py','--config',str(R/'overall-config.json'),'--overall'],check=True)
old=json.load(open('results/placement-study/combined-config.json'))
changes=[[k,old['crowdManagers']['plan'].get(k,'-'),v] for k,v in cfg['crowdManagers']['plan'].items() if v!=old['crowdManagers']['plan'].get(k)]
total=opt['evaluations']*opt['K']+sum(r['stats']['n'] for d in [screen,valid,conf,rob,questions,overall,resolution] for r in d['results'])
parts=['<!-- ROUTE_STUDY_START -->','## Latest result and recommended primary model',
conclusion+' **A-Lite is recommended for comparative planning** because it retains the original walkway graph, individual behavior, finite storage and physical guidance locations. B remains a coarser comparison, A a spatial-mechanism check and C a flow benchmark. The choice of primary model precedes the new holdout; a faster B result does not establish the A-Lite target.',
'## What changed in this continuation',
'''Actual full-run audits now check that people use their own initial seatway, then only connected non-row walkways, open links and accessible routes. They include hard panels, ropes and unexpected closure. No seat-back crossing or new walkway was added. A-Lite's internal queue positions remain approximate and may relocate backward on the same link; they are not collision-resolved trajectories. Live animation now follows the walkway polyline through bends and junctions, fixing the straight-chord drawing artifact without changing simulation results.

A-Lite is named in the app header, has a dedicated tab and shows walkway lines by default. The study tab exposes exact single-audience and whole-batch replay controls. Use port 5180 for this checkout. The model guide adds a single-model recommendation, question-by-question scope, decision-engine explanation and an explicit calibration evidence ledger with a proposed fitting objective. None of the models is claimed empirically calibrated to Bailey.

The additional search changes only permitted instructions and placements. Population, widths, headway, speeds, response, group waiting, capacity and compliance remain unchanged within each model. Spatial LED messages remain fixed public messages; changing the seat-block plan does not give a strip personalized knowledge. Staff remain exactly six. The documented conservative service correction remains enabled. No congestion coefficient was reduced to make the target pass.''',
'## Search, selection and independent confirmation',
f"Coordinate descent evaluated **{opt['evaluations']} distinct 44-block plans** on eight common training audiences (base 62006), accepting improvements above 0.75 s for up to three sweeps. Its final training mean was **{f(opt['summary']['meanTEvac'])} s**. The resulting instructions were screened with all 84 existing staff/LED/barrier arrangements on those same training audiences. A prespecified shortlist of {len(valid['results'])} configurations, including the previous combined plan, was compared on 24 additional training audiences (62007). The complete configuration with both devices and the lowest mean was frozen before 60 fresh confirmation audiences (62106).",
f"The frozen choice is `{sel['selectedId']}`, with validation mean {f(sel['validationMean'])} s. The follow-up includes 20 paired audiences (62206) for ablations and closure/visibility diagnostics, and 20 per separate ordinary/lecture scenario (62406). In total **{total:,} new experiment replications** were run, excluding passive-audit and browser verification replays. Search results are not independent evidence of success; the confirmation table is.",
f"A second role was prespecified before confirmation: select the lowest complete validation mean irrespective of device presence. This chose `{osel['selectedId']}` at {f(osel['validationMean'])} s on validation, with LEDs {'on' if pc['led']['enabled'] else 'off'} and {len(pc['barriers'])} barrier links. The model must represent LEDs, but a beneficial LED effect is not imposed as a premise. Both policies are reported; neither was selected by its holdout score. If the two roles choose the same configuration, their repeat replays are not additional independent audiences.",
rows_table(overall['results']+conf['results']),
f"The paired A-Lite difference, selected minus previous combined policy, is **{paired(lite,ref)} s**. Negative values mean faster. Both use the same 60 audiences. Full-house failures invalidate an unconditional finite mean; nobody is silently dropped. The success fraction concerns the last person's building crossing, not mean individual travel time.",
'## Numerical resolution: the time step is not a physical congestion coefficient',
'''A six-audience pilot found substantial individual-run changes when the step was reduced. Its broad paired interval did not establish a systematic gain. We therefore froze a resolution protocol before the larger test: retain both operational plans and the same 60 confirmation audiences; report every resolution; use the finest tested 0.0125 s for the refined prediction, irrespective of whether it is faster. No physical speed, headway, capacity, response distribution or compliance changed. The original 0.1 s results above remain visible.

Smaller steps reduce rounding of link arrivals, admissions and state updates. In this nonlinear stochastic simulation they can also change later route and hearing histories. Individual trajectories need not converge monotonically. Mean confidence intervals quantify audience sampling at each resolution; they do not cover discretization or structural uncertainty. A fine-step mean below 180, if obtained, is still not an empirically calibrated Bailey guarantee.''',
rows_table(resolution['results']),
table(['Paired resolution change, same policy and audience','Difference [95% CI], s'],[
 ['Overall: 0.05 minus 0.1',paired(next(r for r in resolution['results'] if r['id']=='overall-dt0.05'),primary)],
 ['Overall: 0.025 minus 0.1',paired(next(r for r in resolution['results'] if r['id']=='overall-dt0.025'),primary)],
 ['Overall: 0.0125 minus 0.025',paired(fine,next(r for r in resolution['results'] if r['id']=='overall-dt0.025'))],
 ['Combined: 0.0125 minus 0.025',paired(fine_combined,next(r for r in resolution['results'] if r['id']=='combined-dt0.025'))]]),
'''The refined configurations are separate files (`refined-overall-config.json` and `refined-combined-config.json`). The selected policies and all original-step records are retained. Resolution comparison does not establish a universal convergence bound. Blockage and device ablations below use the original 0.1 s step and must not be subtracted from a fine-step time to claim a device benefit.''',
'## Actual devices and instructions',
f"Selected staff placement: **{cfg['crowdManagers']['placement']}**, six posts. Barrier links: **{', '.join(cfg['barriers'])}**, types: **{', '.join(cfg.get('barrierTypes',{}).get(x,'hard-panel') for x in cfg['barriers'])}**. LEDs: twelve 2 m strips, **24 m total**, with finite range and occlusion. Ropes add the unchanged assumed 15 perceived seconds to crossing cost; panels close their slot. Neither increases capacity. A rope is deliberately crossable and is not equivalent to a hard restriction. Unknown exit closures are learned through the existing mechanism, not revealed by the optimizer at run time.",
'![Frozen manager posts, barrier slots and public LED messages.](figures/route-selected.svg)',
'![The separate validation-selected overall policy; device absence is explicit.](figures/route-overall.svg)',
table(['Changed seat block','Previous instruction','Selected instruction'],changes) if changes else 'The previous block instructions survived validation; new optimized instructions were not selected.',
'''The plan is published as `results/route-study/selected-config.json`. Block names identify the existing section, side and front/back band. Unchanged blocks retain their original instruction. Instructions are heard and accepted imperfectly; the optimizer cannot assign actual exit usage directly. The plotted arrangement is a reconstruction, not a construction drawing.''',
'## Ablations, blocked exits and visibility',rows_table(rob['results'])]
rr={r['id']:r for r in rob['results']};parts += [table(['Paired change (A-Lite)','Mean difference [95% CI], s'],[
 ['Add LEDs, with selected barriers',paired(rr['selected'],rr['no-led'])],['Add barriers, with selected LEDs',paired(rr['selected'],rr['no-barriers'])],['Add both devices',paired(rr['selected'],rr['neither'])],['F3 unavailable vs open',paired(rr['blocked-F3'],rr['selected'])],['FC2 unavailable vs open',paired(rr['blocked-FC2'],rr['selected'])],['D3 unavailable vs open',paired(rr['blocked-D3'],rr['selected'])]]),
'''These are diagnostics of the frozen plan, not another selection round. A closure can change route choice enough to reduce this model's clearance time; it does not add capacity or justify closing an exit. Low-level signs keep fixed messages and do not magically detect the closure. Group-consistent messages change only advice, not group movement or readiness. Results remain conditional on incomplete calibration of hearing, visibility and preferences.''',
'## Other original questions and calibration limits',rows_table(questions['results']),
'''The ordinary-departure and lecture presets use separate inherited behavioral assumptions and zero managers; this is permitted by their distinct questions. Neither result substitutes for the six-manager concert. The lecture preset has familiar students and different response/luggage inputs; these are unvalidated scenario hypotheses. Q5 requires actual installation, staffing and training costs, which are not in the repository.

Research justifies testing limited mechanisms; it does not identify Bailey's headway, response tails, group behavior or sign acceptance. Geometry, per-door cumulative exit counts, seatway/aisle trajectories, message reach and start-time observations would be needed for empirical calibration, followed by independent validation. Model Guide Sections 22–23 state the scope and data requirements. The 180-second requirement was never used as a fictitious calibration measurement.

Reproduce the study with `scripts/route-followup.ts` after `scripts/optimise-plan.ts`, using the saved configuration and seed arguments in the study README. Raw experiment records are losslessly compressed, configurations and summaries remain readable, and source snapshots record the implementation. Verification findings and exact replay results accompany the archived data.''','<!-- ROUTE_STUDY_END -->']
section='\n\n'.join(p for p in parts if not p.startswith('<!--'))+'\n'
section=section.replace('](figures/','](../../docs/research-180/figures/')
(R/'REPORT.md').write_text('# Historical A-Lite route study\n\nThis completed study predates A-Lite+. Its model recommendation and intervention semantics are historical; the current primary model and all-five-question analysis are in the [A-Lite+ report](../../docs/research-180/RESULTS_AND_CHANGES.pdf). Reproducing this archive does not overwrite the current manuscript or executive summary.\n\n'+section)
with (R/'comparisons.csv').open('w') as out:
 w=csv.writer(out,lineterminator='\n');w.writerow(['phase','id','model','n','mean','ci_low','ci_high','failures','fraction_le180','peak_density','exposure_mean'])
 for phase,d in [('screen',screen),('validation',valid),('confirmation',conf),('overall-confirmation',overall),('resolution',resolution),('robustness',rob),('questions',questions)]:
  for r in d['results']:
   s=r['stats'];w.writerow([phase,r['id'],r['model'],s['n'],s['mean'],s['ciLow'],s['ciHigh'],s['failures'],s['p180']['p'],s['peakDensityMax'],s['exposureMean']])
print(conclusion);print('New experiment replications',total)
