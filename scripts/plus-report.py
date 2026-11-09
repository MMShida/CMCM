"""Publish completed A-Lite+ experiments. Never infer missing results or hide failures."""
from pathlib import Path
import json,gzip,math,statistics,csv,subprocess,re,html,sys
AVAILABLE="--available" in sys.argv
R=Path('results/plus-study');D=Path('docs/research-180')
def load(name,root=R):
 p=root/(name+'.json')
 if AVAILABLE and not p.exists() and not Path(str(p)+'.gz').exists():return {'cases':[],'records':[]}
 return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def f(x):return 'Unresolved' if x is None or not math.isfinite(x) else f'{x:.2f}'
def label(s):return s.replace('-', ' ')
def table(headers,rows):
 if not rows:return 'No completed comparison in this section at finalization.'
 return '| '+' | '.join(headers)+' |\n|'+'|'.join('---' for _ in headers)+'|\n'+''.join('| '+' | '.join(map(str,row))+' |\n' for row in rows)
def tq(df):
 if df<=10:return [12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228][df-1]
 z=1.959964;return z+(z**3+z)/(4*df)+(5*z**5+16*z**3+3*z)/(96*df*df)
def ci(xs):
 m=statistics.mean(xs);h=tq(len(xs)-1)*statistics.stdev(xs)/math.sqrt(len(xs)) if len(xs)>1 else float('nan');return [m,m-h,m+h]
def wilson(k,n):
 z=1.959964;p=k/n;d=1+z*z/n;m=(p+z*z/(2*n))/d;h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [p,max(0,m-h),min(1,m+h)]
def complete(r):return r.get('allLeftBuilding') and r.get('N')==1329 and not r.get('unresolvedInside') and r.get('tEvac') is not None and math.isfinite(r['tEvac'])
def stats(c):
 runs=c['runs'];xs=[r['tEvac'] for r in runs if complete(r)];n=len(runs);failed=n-len(xs);m,lo,hi=ci(xs) if xs else [None]*3;k=sum(t<=180 for t in xs);p,pl,ph=wilson(k,n)
 usage={k:statistics.mean(r['exitGroupUsage'].get(k,0) for r in runs) for k in runs[0]['exitGroupUsage']}
 return dict(id=c['id'],cfg=c['cfg'],n=n,failed=failed,mean=None if failed else m,ciLow=None if failed else lo,ciHigh=None if failed else hi,conditionalMean=m,p95=None if failed else c['stats']['p95'],k=k,p180=p,p180Low=pl,p180High=ph,exposure=statistics.mean(r['highDensityExposure'] for r in runs),peakDensity=max(r['peakDensity'] for r in runs),usage=usage,times=[{k:r.get(k) for k in ['seed','tEvac','tSafe','tSafeAll','unresolvedInside']} for r in runs])
def show(rows):
 if not rows:return 'Not completed before the user-requested finalization cutoff; no result is claimed.'
 return table(['Policy','Runs','Mean [95% CI], s','p95, s','≤180; Wilson CI; failed'],[[label(s['id']),s['n'],(f"{f(s['mean'])} [{f(s['ciLow'])}, {f(s['ciHigh'])}]" if s['mean'] is not None else "Unresolved"),(f(s['p95']) if s['p95'] is not None else "—"),f"{s['k']}/{s['n']}; {100*s['p180Low']:.0f}–{100*s['p180High']:.0f}%; {s['failed']} failed"] for s in map(stats,rows)])
def paired(a,b):
 by={r['seed']:r for r in b['runs']};ds=[r['tEvac']-by[r['seed']]['tEvac'] for r in a['runs'] if r['seed'] in by and complete(r) and complete(by[r['seed']])]
 if len(ds)!=len(a['runs']):return 'Unresolved / unmatched'
 m,lo,hi=ci(ds);return f'{m:.2f} [{lo:.2f}, {hi:.2f}]'
names=['screen','validation','staff-validation','confirmation','ablations','devices','obstructions','questions','uncertainty','numerics','speed-sensitivity','speed-confirmation','staff-expansion-screen','staff-expansion-validation','staff-expansion-confirmation','staff-expansion-robustness','final-resolution','guidance-refinement-search','guidance-refinement-validation','guidance-refinement-confirmation','guidance-refinement-fine','guidance-refinement-robustness','resolution-diagnostic']
data={n:load(n) for n in names};protocol=load('supplement-protocol')
# This early batch records its contemporaneous source hash in the adjacent snapshot.
if not data['staff-validation'].get('sourceHash'):
 source=R/'staff-validation-source.json'
 data['staff-validation']['sourceHash']=(json.loads(source.read_text())['sourceHash'] if source.exists() else next(x['sourceHash'] for x in json.loads(Path('results/research-artifacts.json').read_text())['sourceSnapshots'] if x['oldPath']==source.as_posix()))
for suite in protocol['suites']:
 if not AVAILABLE:assert len(data[suite['name']]['cases'])==len(suite['cases']),suite['name']+' incomplete'
assert len(data['screen']['cases'])==len(load('screen-protocol')['cases'])
assert all(len(c['runs'])==100 for c in data['confirmation']['cases'])
speed_case=data['speed-confirmation']['cases'][0];assert len(speed_case['runs'])==100;speed=stats(speed_case)
fine_original=data['final-resolution']['cases'];assert (AVAILABLE or len(fine_original)==2) and all(len(c['runs'])==100 for c in fine_original)
refined=data['guidance-refinement-confirmation']['cases'][0];assert len(refined['runs'])==100
refined_fine=data['guidance-refinement-fine']['cases'][0];assert len(refined_fine['runs'])==100
refined_fine['seedBase']=73503
fine=fine_original+[refined_fine]
expanded_cases=data['staff-expansion-confirmation']['cases'];expanded=next(c for c in expanded_cases if c['id']=='expanded-staff-1.4');es=stats(expanded)
assert len(data['staff-expansion-screen']['cases'])==len(load('staff-expansion-protocol')['cases'])
assert all(len(c['runs'])==100 for c in expanded_cases)
assert AVAILABLE or len(data['staff-expansion-robustness']['cases'])==11
conf=data['confirmation']['cases'];selected=next(c for c in conf if c['id']=='selected');baseline=next(c for c in conf if c['id']=='baseline6');s=stats(selected)
combined=next((c for c in conf if c['id']=='combined6'),selected);cs=stats(combined)
selection=load('selection');opt=load('opt-Plus');physical=load('physical-audit');physical_staff=load('staff-physical-audit');flow=load('flow-benchmark')
subprocess.run(['node','--import','tsx','scripts/plus-export.ts'],check=True);subprocess.run(['python3','scripts/plus-figures.py'],check=True)
layouts=load('layouts');layout={x['id']:x for x in layouts};cfg=selected['cfg']
total=sum(len(c['runs']) for d in data.values() for c in d['cases'])+opt['evaluations']*opt['K']
passes=s['mean'] is not None and s['ciHigh']<180
verdict='The independent mean interval is below 180 seconds under this model.' if passes else 'The original six-manager calibration does not demonstrate a mean below 180 seconds.'
conclusion=f"A-Lite+ with six managers gives {f(s['mean'])} s (95% CI {f(s['ciLow'])}–{f(s['ciHigh'])}) on 100 fresh audiences; {s['k']}/100 clear by 180 s and {s['failed']} are unresolved. {verdict} These are research-grounded model predictions, not empirical Bailey validation."
speed_verdict=('Its mean interval is below 180 s.' if speed['mean'] is not None and speed['ciHigh']<180 else 'Its mean interval does not demonstrate the sub-180 target.')
speed_conclusion=f"The separately declared 1.4 m/s clipped-normal alternative gives {f(speed['mean'])} s (95% CI {f(speed['ciLow'])}–{f(speed['ciHigh'])}); {speed['k']}/100 clear by 180 s. {speed_verdict}"
conclusion+=' '+speed_conclusion
expanded_verdict=('Its independent mean interval is below 180 seconds.' if es['mean'] is not None and es['ciHigh']<180 else 'Its independent mean interval does not demonstrate the sub-180 target.')
expanded_conclusion=f"The expanded {expanded['cfg']['crowdManagers']['count']}-manager policy at 1.4 m/s averages {f(es['mean'])} s (95% CI {f(es['ciLow'])}–{f(es['ciHigh'])}); {es['k']}/100 clear by 180. {expanded_verdict}"
conclusion+=' '+expanded_conclusion
fine_conclusion='At the prespecified 100-run 0.0125 s step: '+ '; '.join(f"{label(c['id'])} ({c['cfg']['crowdManagers']['count']} managers), {f(stats(c)['mean'])} s [95% CI {f(stats(c)['ciLow'])}–{f(stats(c)['ciHigh'])}], {stats(c)['k']}/100 at or below 180" for c in fine)+'.'
fine_passes=[c for c in fine if stats(c)['mean'] is not None and stats(c)['ciHigh']<180]
fine_verdict=('The 100-run 0.0125 s confirmation supports a mean below 180 s under the stated model for '+', '.join(label(c['id']) for c in fine_passes)+'.' if fine_passes else 'The 100-run 0.0125 s confirmation does not establish a mean below 180 s with a 95% interval wholly below the target.')
fine_conclusion+=' '+fine_verdict
cutoff='Finalized at the user’s request using completed cases only. Supplemental ablations, device-isolation comparisons, Q1/Q3 scenario batches, parameter uncertainty, two planned 100-run numerical replays, and the smaller-step diagnostic were not completed. Closure tests are partial. ' if AVAILABLE else ''
conclusion=cutoff+fine_conclusion+' '+conclusion
rows=[{**stats(c),'seedBase':73101} for c in conf]+[{**speed,'seedBase':73101}]+[{**stats(c),'seedBase':73403} for c in expanded_cases]+[{**stats(refined),'seedBase':73503}]+[{**stats(c),'seedBase':c['seedBase']} for c in fine]
public={'status':'finalized' if AVAILABLE else 'complete','cutoff':cutoff,'conclusion':conclusion,'selection':selection['id'],'rows':rows,'questions':[stats(c) for c in data['questions']['cases']],'sourceHash':data['confirmation']['sourceHash'],'sources':{n:d.get('sourceHash') for n,d in data.items()}}
Path('public/results/plus-study.json').write_text(json.dumps(public,separators=(',',':'))+'\n')
# A standalone vector comparison: the 180 s line is a target, never a fitted datum.
chart_cases=[baseline,selected,*fine]
chart_stats=[stats(c) for c in chart_cases]
low=20*math.floor((min(s['ciLow'] for s in chart_stats if s['mean'] is not None)-10)/20)
high=20*math.ceil((max(s['ciHigh'] for s in chart_stats if s['mean'] is not None)+10)/20)
low=min(low,160);high=max(high,200)
cx=lambda value:350+500*(value-low)/(high-low)
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="350" viewBox="0 0 1000 350"><rect width="100%" height="100%" fill="white"/>']
def ct(x,y,t,size=18,color='#203548'):
 return f'<text x="{x:.2f}" y="{y:.2f}" font-family="Arial" font-size="{size}" fill="{color}">{html.escape(str(t))}</text>'
svg.append(ct(20,27,'Full-house clearance: mean and 95% audience interval',20))
svg.append(ct(20,48,'100 audiences per policy; retuned policy at 0.0125 s, original policies at 0.1 s',16))
for tick in range(int(low),int(high)+1,20):
 x=cx(tick);svg.append(f'<path d="M{x},65 V295" stroke="#e1e6eb"/>');svg.append(ct(x-12,315,tick,16))
x=cx(180);svg.append(f'<path d="M{x},65 V295" stroke="#b34a32" stroke-width="2" stroke-dasharray="5 4"/>')
names_chart=['Six-manager baseline · 1.2 m/s','Six-manager optimized · 1.2 m/s']+[('Retuned 12-manager · 1.4 m/s' if c['id'].startswith('refined') else label(c['id'])) for c in fine]
for i,(name,st) in enumerate(zip(names_chart,chart_stats)):
 y=87+43*i;svg.append(ct(20,y+5,name))
 if st['mean'] is None:svg.append(ct(365,y+5,'Unresolved audience; no unconditional mean'));continue
 color='#18775b' if st['ciHigh']<180 else '#245a79'
 a,b,m=map(cx,[st['ciLow'],st['ciHigh'],st['mean']]);svg.append(f'<path d="M{a},{y} H{b} M{a},{y-5} V{y+5} M{b},{y-5} V{y+5}" stroke="{color}" stroke-width="2"/><circle cx="{m}" cy="{y}" r="4" fill="{color}"/>')
 svg.append(ct(870,y+5,f"{st['mean']:.2f} s",18,color))
svg.append(ct(350,340,'Last person outside (seconds); dashed line: 180 s',16));svg.append('</svg>')
(D/'figures/plus-confirmation.svg').write_text(''.join(svg))
catalog=load('screen-protocol')['cases'];by={c['id']:c for c in catalog}
export=[{'id':'selected-six','cfg':cfg},{'id':'speed-alternative-1.4','cfg':speed_case['cfg']},*load('selection-roles')['cases']]
for key in ['coverage-none-none','coverage-signs-none','coverage-strips-none','coverage-none-partial','coverage-strips-partial','coverage-adaptive']:
 if key in by:export.append(by[key])
export.extend({'id':c['id'],'cfg':c['cfg']} for c in load('staff-expansion-protocol')['cases'])
export.extend({'id':c['id'],'cfg':c['cfg']} for c in expanded_cases)
export.extend({'id':c['id'],'cfg':c['cfg']} for c in fine+[refined]+data['resolution-diagnostic']['cases'])
export.extend({'id':c['id'],'cfg':c['cfg']} for c in data['questions']['cases'])
export.extend({'id':c['id'],'cfg':c['cfg']} for c in data['obstructions']['cases'] if c['id'].startswith('selected'))
Path('public/results/plus-catalog.json').write_text(json.dumps(export,separators=(',',':'))+'\n')
parts=['# A-Lite+ results and changes from Mateus’s 04:20 model','## Primary result and interpretation',conclusion,
'![Independent confirmation. Parameter and staffing alternatives are labeled explicitly; interval width describes sampled audiences, not unknown venue calibration.](figures/plus-confirmation.svg)',
f"The validation-selected policy is `{selection['id']}`. It uses six {cfg['crowdManagers']['placement']} posts, {layout['selected']['resources']['signs']} wall signs, {layout['selected']['resources']['stripMetres']:.1f} m of floor strips and {layout['selected']['resources']['barriers']} physical barriers. Original geometry and 1,329 audience members, including three wheelchair users, remain. The primary physical calibration was frozen before operational search. The endpoint is the last exterior building crossing; assisted travel to street level is separate.",
'''A-Lite+ is recommended as the single comparative planning model because it retains the detailed walkway graph, heterogeneous response and decisions, finite storage, accessible routing and physical device locations while making service conservation explicit. Its simplified queue positions do not resolve body contact or every group interaction. A, B and original Lite remain structural comparisons; Model C is an ideal network-flow benchmark. Choosing the shortest prediction across engines is not calibration.''',
'## What changed, and what stayed fixed',
table(['Component','Change from original Lite / Mateus','Reason and limit'],[
 ['Transport','Original uncontracted links; conservative service and finite storage retained. Local group pace replaces permanent remote slowest-member pacing; limited passing into empty wide-corridor lanes.','Bode group experiments [R23] motivate separating approach coordination from gate service. The 4 m neighborhood and 1.8 m passing threshold remain assumptions.'],
 ['Individual decisions','Nearby line-of-sight queues and observed discharge; moving people may revise intent before a junction; actual turns require connected nodes.','Travel plus visible wait, persistent preferences, cooldown and hysteresis. No instantaneous remote queue knowledge.'],
 ['Manager instructions','Persistent fixed 0.8 acceptance, independent of trust. Accepted feasible directions commit a destination. Hearing, acceptance and execution logged separately.','Requested behavioral change; 0.8 is assumed, tested at 0.6/0.9. Accessibility takes precedence. Six managers in the primary concert.'],
 ['LEDs','Explicit wall points / floor polylines, visibility, persistent notice and acceptance. Public static/dynamic messages; delayed local/radio controller.','Experimental detection [R24] transfer is uncertain in a dense theatre. No personalized message from a public sign.'],
 ['Barriers','Low belt / open rail / historical opaque panel; explicit span, bypass, width/lane reduction and detour. No arbitrary rope penalty.','Obstacle experiments [R11,R12,R17] do not establish a universal benefit. Reject inaccessible/narrow/exit-blocking placements. Transparent devices preserve sightlines. Hardware footprints and venue approval remain necessary.'],
 ['Numerics and UI','Independent Plus engine factories; original engines retained. Polyline animation, placement editor, inspector, event log, matched comparison, costs and evidence ledger.','Exact source snapshots, seeded configurations and browser parity checks. Performance indexing does not change simulated outcomes.']]),
'''The original placement study holds headway, body size, capacities, audience, speed distribution, response and building layout fixed. The later user-requested speed study declares a separate 1.4 m/s alternative before inspecting its outcomes and preserves the original study. The literature review bounded existing assumptions and changed only the stated group/perception/instruction mechanisms before freezing them. Sensitivity values are not ranked to choose a physical calibration; the declared alternative and the original result remain separate. No seat-back crossing or use of another row as a shortcut is permitted.''',
'## Search protocol and independent confirmation',
f"The screen compared {len(data['screen']['cases'])} physically specified staff/device policies on four common audiences (seed base 73001). The fastest complete training policy supplied the starting layout. The 16 seat blocks most represented among its last 50 evacuees were selected before further optimization. Coordinate descent evaluated {opt['evaluations']} distinct plans on six training audiences (73003), for up to two sweeps with a 1 s acceptance threshold. It changed block instructions and pre-announcement, not physical parameters or public sign messages.",
f"A shortlist of {len(data['validation']['cases'])} policies was evaluated on 16 separate validation audiences (73002). The lowest complete mean among six-manager policies was frozen before the 100 confirmation audiences (73101). A combined-device role was also frozen; if the same policy wins both roles, its result is counted once. Ten- and twelve-manager variants used 16 training audiences (73004); the selected additional-staff option has its own 100-run holdout. All roles were fixed before opening confirmation results. This is a bounded search, not proof of global optimality.",
show(conf),f"Selected minus baseline on the same 100 audiences: **{paired(selected,baseline)} s** (paired 95% interval). Negative means faster. The success fraction requires all 1,329 outside by 180; failures are never removed from a claimed unconditional mean. Confidence intervals describe audience sampling conditional on the model, not unknown Bailey calibration.",
'## 100-run numerical confirmation of the declared speed and staffing policies',fine_conclusion,show(fine),
'''Two additional 100-audience numerical refinements were declared before either speed/staff confirmation was opened; they were not completed before the finalization cutoff. Their declarations remain archived. The study never chooses the fastest time step. Audience sampling remains independent of operational selection; the same audiences permit paired numerical comparison. Treat a threshold crossed only at one resolution cautiously. The later guidance retuning has its own declared 100-audience 0.0125 s confirmation on new seed base 73503. Every completed 100-run confirmation is available in the UI with its exact configuration and seeds.''',
table(['0.0125 s minus original 0.1 s result','Paired difference [95% CI], s'],[[label(c['id']),paired(c,speed_case if c['id'].startswith('six') else refined if c['id'].startswith('refined') else expanded)] for c in fine]),
'## Smaller-step numerical diagnostic',
'''The 20-audience expanded-policy comparison changed by 2.32 s between 0.025 and 0.0125 s. Before opening any 100-run fine-step result, an additional diagnostic was declared at 0.00625 s on the first twenty matching confirmation audiences of each frozen policy. Only the time step changes. The 100-run 0.0125 s result remains the declared confirmation; no fastest-step substitution is made. The smaller-step diagnostic was declared but not run before finalization. No result from it is claimed.''',
show(data['resolution-diagnostic']['cases']),
table(['0.00625 s minus matched 0.0125 s, 20 audiences','Paired difference [95% CI], s'],[[label(c['id']),paired(c,next(x for x in fine if x['id']==c['reference']))] for c in data['resolution-diagnostic']['cases']]),
'''A small difference is a numerical check, not proof of a continuous-time limit; a material change limits the precision of a threshold claim. Changed steps can alter later routing and hearing histories even with identical audiences. Complete policies, seeds and the diagnostic declaration are archived.''',
'## Placements and implementation',
'![Selected main-floor policy: actual posts, initial public messages and barrier bypasses.](figures/plus-selected-main.svg)',
'![Selected balcony policy. Arrows show initial messages; dynamic changes are logged.](figures/plus-selected-balcony.svg)',
table(['Manager','Position (x, y), m','Floor'],[[m['id'],f"({m['x']:.2f}, {m['y']:.2f})",m['floor']] for m in layout['selected']['posts']]),
table(['Device','Geometry / setting','Operational interpretation'],[[b['slot'],f"{b['type']}; length {b['length']:.2f} m; angle {b['angle']:.0f}°; bypass {b['gap']:.2f} m",'Reduced usable width and explicit bypass; no flow bonus'] for b in layout['selected']['barriers']] or [['None','No physical barriers','No barrier benefit assumed']]),
table(['LED / floor','Position; initial exit','Type / mode'],[[f"{x['id']} / {x['floor']}",f"({x['x']:.2f}, {x['y']:.2f}); {x['exit']}",('floor strip' if x.get('strip') else 'wall sign')+' / '+x['mode']] for x in cfg['plus']['signs'] if x['enabled'] and cfg['led']['enabled']] or [['None','No additional LED','Existing static exit signs remain']]),
'''The complete JSON contains every polyline point, orientation, activation, visibility and behavioral parameter. The map uses the actual geometry and posts instantiated by the engine. Dynamic arrows show initial messages; later changes are recorded per run. Coordinates are reconstruction coordinates, not installation survey accuracy. A full open rail is a route closure with transparent sightlines; a partial belt leaves one shared, bidirectional bypass. Hardware supports must fit the assessed envelope. Actual installations require University Fire Marshal review.''',
'## Q4: device comparisons and mechanisms','The 48 whole-policy screening cases include alternative staff, LED and barrier placements. Their raw results and configurations are archived; the separate paired device-isolation batch below was not run before finalization.',show(data['devices']['cases']),
'''These are paired ablations of the same combined policy. Public messages, staff count, physical calibration and audience seeds remain fixed while devices change. They distinguish a device effect from the effect of choosing a different staff plan. “Static” means a fixed illuminated instruction; it is not the low-notice unlit baseline sign. Floor strips have no wall-facing cone. Dynamic updates use delivered manager snapshots, not perfect global state.''',
table(['Device comparison vs same combined plan','Paired difference [95% CI], s'],[[label(c['id']),paired(c,data['devices']['cases'][0])] for c in data['devices']['cases'][1:]]),
'## Controlled model ablations',show(data['ablations']['cases']),
table(['Ablation minus selected model','Paired difference [95% CI], s'],[[label(c['id']),paired(c,data['ablations']['cases'][0])] for c in data['ablations']['cases'][1:]]),
'''Each ablation changes one mechanism. Utility-only instruction disables commitment for both manager and LED instructions. No-moving-observation disables the extra moving review, while inherited junction decisions remain. Turning off adaptive individuals leaves the local observation hook active but changes the inherited choice/memory engine. These comparisons are not alternative calibrations selected for speed.''',
'## Expanded staffing and moving-post comparison',expanded_conclusion,
f"The user-authorized expansion compares {len(data['staff-expansion-screen']['cases'])} explicit placement/patrol policies at the separately declared 1.4 m/s calibration. Counts 6, 8, 10, 12 and 18 use actual posts, rather than a requested number exceeding the available positions. Eight screening audiences (73401) precede sixteen validation audiences (73402) for four finalists. The winner `{load('staff-expansion-selection')['id']}` is frozen before 100 new audiences (73403). Its identical 1.2 m/s counterpart and the six-manager 1.4 control are also confirmed on those audiences.",
show(data['staff-expansion-screen']['cases']),show(data['staff-expansion-validation']['cases']),show(expanded_cases),
table(['Patrol candidate','Total managers','Managers with feasible patrols'],[[c['id'],c['cfg']['crowdManagers']['count'],len(c['cfg']['plus'].get('managerPatrols',[]))] for c in load('staff-expansion-protocol')['cases'] if c['id'].endswith(('patrol20','patrol45'))]),
'''Only posts within 4 m of an eligible wide-corridor node receive a patrol. The six coverage posts have no qualifying route, so their patrol-labeled cases are stationary fallbacks, not evidence about moving guides. The 12- and 18-post layouts each contain three eligible patrols; all remaining managers stay at their posts. Full-run motion audits and the browser replay use the actual 12-manager patrol case.''',
'''The six-post explicit stationary representation has identical post coordinates and activation draws to the coverage template, but consumes six rather than the geometry's ten potential-post activation draws from the inherited guidance stream. Subsequent hearing draws therefore differ. This does not change the sampled audience or marginal hearing law, but it prevents attributing a seed-by-seed difference between those two representations to placement. Patrol effects are compared with their own explicit, stationary-post controls. Any unresolved audience excludes that candidate, regardless of its completion-conditioned mean.''',
'''The rejected six-post explicit candidate illustrates a counterflow failure. In seed 31553826, opposing ready queues fill the existing 0.9 m passages SPW_2 and SPW_3. The two queue heads have combined modeled body diameters of 0.935 m, so the conservative side-by-side exchange rule cannot release them. Twelve people remain inside at the 900 s horizon. No body radius, passage width or storage limit was relaxed to clear that run. The model lacks body rotation and negotiated retreat, so this is a failure under its spatial-queue assumptions, not proof that Bailey would physically trap those people. `rejected-run-diagnostic.json` preserves the queue states and the calculation.''',
f"Expanded staffing minus six-manager control, both at 1.4 m/s on the same 100 audiences: **{paired(expanded,next(c for c in expanded_cases if c['id']=='six-manager-1.4-control'))} s**. The different-speed counterpart is reported separately, so a speed effect is not attributed to staffing.",
'![Expanded staffing, main floor: actual starting posts, devices and any patrol paths.](figures/plus-expanded-staff-main.svg)',
'![Expanded staffing, balcony.](figures/plus-expanded-staff-balcony.svg)',
'''Moving managers follow explicit wide, level, non-gate walkway sequences. They start at 20 or 45 s, move at 1.0 m/s only while their link is empty of audience members, and dwell 10 s at each end. Static controls use identical starting posts. Existing hearing, persistent acceptance, observation and radio delays remain. The controlled guidance study by Liu et al. [R28] motivates distinguishing guidance modes and locations; its platform performance and attraction coefficients are not imported. Staff bodies are absent from queue storage and the audience endpoint, so patrol results remain a limited coverage sensitivity, not validated staff–crowd mechanics.''',
show(data['staff-expansion-robustness']['cases']),
table(['Expanded policy check minus same-seed reference','Paired difference [95% CI], s'],[[label(c['id']),paired(c,data['staff-expansion-robustness']['cases'][0])] for c in data['staff-expansion-robustness']['cases'][1:]]),
f"Additional passive audits cover {len(physical_staff['records'])} expanded, twelve-manager patrol and blocked runs; {sum(r['violations'] for r in physical_staff['records'])} forbidden transitions. Every step checks finite staff travel and the occupied-link waiting rule, alongside audience service, storage and conservation.",
'## Final operational retuning of the selected additional-staff layout',
f"The prior instructions were optimized for six managers. Queue-sensitive route allocation motivates a further operational comparison [R7, R10]. A final bounded search keeps the selected {refined['cfg']['crowdManagers']['count']} posts, the declared 1.4 m/s distribution, devices and every physical/behavioral parameter fixed. It changes only manager and pre-announcement seat-block destinations. Eight new training audiences (73501) compare the inherited plan and four coherent west/east side-zone patterns; the eight most frequent non-side tail blocks then receive one coordinate-descent sweep, accepting gains above 1 s. This evaluates {len(data['guidance-refinement-search']['cases'])} plans. The inherited, best-pattern and refined candidates use twenty separate validation audiences (73502). The selected role `{load('guidance-refinement-selection')['validationId']}` is frozen before 100 new audiences (73503), then always rerun at 0.0125 s. This last search stops regardless of the target; no physical parameter is tuned to its outcomes.",
show(data['guidance-refinement-validation']['cases']),show([refined,refined_fine]),
'Devices and staff locations are identical to the expanded-staff maps above. Public LEDs keep their spatial messages; only the following accepted staff/pre-announcement destinations differ.',
table(['Seat block','Inherited destination','Final destination'],[[k,expanded['cfg']['crowdManagers']['plan'].get(k,'—'),v] for k,v in refined['cfg']['crowdManagers']['plan'].items() if expanded['cfg']['crowdManagers']['plan'].get(k)!=v] or [['None','Inherited plan retained','No validation improvement selected']]),
show(data['guidance-refinement-robustness']['cases']),
'The final policy’s additional passive audits were not run before finalization. The earlier ten full-run physical audits remain available. Its confirmation audiences differ from the earlier staffing study; cross-study mean differences are not paired causal estimates.',
'## Q2: unexpected obstruction and communication',show(data['obstructions']['cases']),
'''F3 is an exterior foyer door, FC2 a foyer connection and D3 a side connection. In discovery cases, closures are physically present from the start but unknown until visible or communicated. The announced FC2 case introduces staff knowledge after 45 s. No exit is widened and no closure is inferred to improve physical capacity merely because it changes route choices. Compare the same device plan with and without barriers under the same closure before recommending a barrier. A substantial adverse paired effect or unresolved audience is a reason to withhold that installation, even if its open-building mean is faster.''',
'## Q1 and Q3: different uses of the same model',show(data['questions']['cases']),
'''Q1 uses the inherited ordinary-departure distribution: longer belongings preparation, habitual foyer use, urgency zero and mean desired speed 1.1 m/s. Six staff are represented at their posts, but emergency redirection is inactive; the second case is an operational sensitivity with active directions. This separates staff presence from an emergency instruction. Ordinary-preparation coefficients remain assumptions, not measured concert behavior.

Q3 keeps the full 1,329 audience and three wheelchair users, removes managers, and makes emergency-exit knowledge complete as the problem explicitly states. The inherited student scenario has no elderly share, mean desired speed 1.35 m/s, fewer groups, more belongings and response median 22 s. The 14 s response case tests that uncertain assumption. The device case uses fixed messages because no manager/radio controller is available. Student familiarity is knowledge, not perfect compliance. These changes answer a different competition scenario; they do not substitute a younger audience into Q2.''',
'## Transferred-calibration uncertainty',show(data['uncertainty']['cases']),
'''All changes in this table are one-at-a-time sensitivity hypotheses, never operational winners. LED sensitivities use the combined-device reference; other rows use the six-manager selection. They bound dependence on free speed, rows, headway, stair pace, gate rates, response, storage and instruction uptake. Changing headway changes implied lane throughput. A faster row cap is motivated as an alternative by lecture-room research but is not measured Bailey calibration. These intervals still cover audience variability only; the spread between parameter cases illustrates additional model uncertainty.''',
'## User-requested free-speed and right-skew follow-up',speed_conclusion,
'''The concert originally uses a 1.20 m/s mean before age adjustment; 1.35 belongs to the inherited lecture scenario. The alternative 1.40 was declared before speed outcomes, informed by controlled corridor measurements in Ren et al. [R26]. This is an external experimental transfer, not a Bailey measurement. The original 25% older share, .78 speed factor, .25 m/s pre-age SD, wheelchair speed, row cap, headway, gate rates and operational layout remain fixed. Davidich and Köster [R27], show why context-specific field calibration can differ from standard laboratory values. The model guide gives the exact sampling equations and research limitations.''',
show(data['speed-sensitivity']['cases']),
table(['Speed family / input mean','Sampled ambulant mean / SD','Younger / older mean'],[[c['id'],f"{c['sampledSpeed']['all']['mean']:.3f} / {c['sampledSpeed']['all']['sd']:.3f} m/s",f"{c['sampledSpeed']['younger']['mean']:.3f} / {c['sampledSpeed']['older']['mean']:.3f} m/s"] for c in data['speed-sensitivity']['cases']]),
'''Normal and lognormal families use the same person-specific random draw and match their pre-clipping mean and standard deviation. They are both clipped to the inherited 0.5–2.0 m/s bounds after age adjustment. Right skew is not an overall speed increase: it changes the median and tails, and the last-person endpoint can be sensitive to slower walkers. The study reports sampled moments rather than assuming clipping has no effect. The 1.5 sensitivity is not promoted just because it might be faster. Mean-speed changes also affect representative walkway service through J=v/(0.44+0.70v), while door/stair gate capacities remain unchanged.''',
show([selected,speed_case]),f"Declared 1.4 alternative minus original on the same 100 audiences: **{paired(speed_case,selected)} s**. The policy was frozen without using these confirmation audiences. A lower mean is a conditional prediction under a different free-speed assumption, not an operational device benefit.",
'## Time-step sensitivity and conservation',show(data['numerics']['cases']),
table(['Resolution change','Paired difference [95% CI], s'],[[label(c['id'])+' minus 0.1 s',paired(c,data['numerics']['cases'][0])] for c in data['numerics']['cases'][1:]]),
'''The selected physical policy is unchanged across steps. Finer integration reduces arrival/admission rounding but can also alter later hearing and route histories; individual runs need not change monotonically. The original six-manager 1.2 m/s confirmation uses its frozen 0.1 s step. The original-policy twenty-audience refinement was not completed. The expanded-staff study did complete twenty-audience comparisons at 0.1, 0.025 and 0.0125 s, and the retuned policy completed 100 audiences at both 0.1 and 0.0125 s. The other two 100-run fine-step replays were not completed. No fastest-step substitution is made. Passing component tests does not establish exact continuous-time convergence.''',
f"Passive full-run audits cover {len(physical['records'])} selected/combined/blocked runs, {sum(r['transitions'] for r in physical['records']):,} graph transitions and {sum(r['positionChecks'] for r in physical['records']):,} occupied-position checks. They found **{sum(r['violations'] for r in physical['records'])} forbidden transitions**, and checked every link's storage, population conservation and cumulative directional/gate service every step. Queue-display relocation within a link is recorded separately; it is not a physical walking trajectory or a shortcut over seats.",
'## Model C benchmark and the late tail',
table(['Flow benchmark','Result','Interpretation'],[['Static max flow',f"{flow['static']['maxFlow']:.2f} people/s",'Capacity benchmark; 7.383 people/s is the full-house whole-run requirement']]+[[x['mode'],f"{f(x['tStar'])} s / {x['N']} people",'Representative speed, optimal routing; wheelchair users excluded'] for x in flow['flows']]),
'''A-Lite+ is an individual, network-based queue simulation. It does not solve a max-flow problem to force optimal human decisions. C alone optimizes network flow. Its representative-speed ambulant benchmark omits wheelchair travel, heterogeneous decisions and operational information limits, so it is neither an attainable full-house prediction nor a universal lower bound on every heterogeneous run.''',
'## Q5: costs and practical feasibility',
f"Expanded staffing uses {layout['expanded-staff']['resources']['staff']} managers, with illustrative capital ${layout['expanded-staff']['resources']['capital']:.0f} and staffing ${layout['expanded-staff']['resources']['staffPerEvent']:.0f} per event. The incremental staff cost versus six is ${(layout['expanded-staff']['resources']['staff']-6)*120:.0f} per event. This resource increase is explicit, not a six-manager result.",
table(['Confirmed policy','Staff / signs / strip metres / barriers','Capital / staff per event'],[[label(c['id']),f"{layout[c['id']]['resources']['staff']} / {layout[c['id']]['resources']['signs']} / {layout[c['id']]['resources']['stripMetres']:.1f} / {layout[c['id']]['resources']['barriers']}",f"${layout[c['id']]['resources']['capital']:.0f} / ${layout[c['id']]['resources']['staffPerEvent']:.0f}"] for c in conf]),
'''Costs are editable illustrative USD assumptions: $120 per manager-event, $250 per wall sign, $40 per metre of strip, $150 per barrier and $800 for a dynamic controller. They exclude installation labor, power, maintenance, storage, removals, replacement and venue approval. No retrieved quote establishes a suitable Bailey dynamic LED system. As external price anchors checked 8 November 2026, [Uline H-3736](https://www.uline.com/BL_8917/Retractable-Crowd-Control?keywords=PL-S) lists $119 per carton of two belt posts, and [Crowd Manager Training](https://crowdmanagers.com/purchase/) lists $24.95 per person for a two-hour course with a two-year certificate. These are product/training prices, not an installed design or staff wage quote. Post bases must be included in a real clear-width assessment.

For E events, compare capital + E × staffing + installation + maintenance + training. Dividing device capital by the additional staffing cost per event shown above gives a budget break-even only if recurring device costs are omitted. It does not establish equivalent evacuation performance. Keep the six-manager primary result separate from extra-staff results, and do not remove required staff to fund devices. Device usability, power, accessible bypass, message consistency and obstruction robustness all affect implementation complexity.''',
'## Reproducibility, tests and remaining limits',
f"Verification completed {load('verification')['tests']['passed']} tests across {load('verification')['tests']['files']} files with no failures, and the production build passed. The suite includes legacy regression, conservation, service, accessibility, physical sign/barrier semantics, moving-post restrictions and seeded speed-family checks. Browser interaction and final replay records are stored alongside the study; their exact checks and timestamps remain separately inspectable.",
f"This final Plus study contains **{total:,} experiment replications**, excluding passive audits, component tests and browser replays. Raw cases, seeds, configurations, source snapshots and all optimization trials are archived losslessly. Training, validation, holdout and supplementary seed bases are distinct. The source and geometry hashes in the freeze and batch files identify the exact implementation. Performance-only visibility changes reproduced 12 baseline/device runs exactly before screening resumed.",
'''Open the A-Lite+ tab at `http://127.0.0.1:5180/?tab=plus`. Load `selected-six` (original 1.2 m/s) or `speed-alternative-1.4`, reset, choose a listed confirmation seed and start. For the mean, use Prepare 100-run reproduction, then Run matched comparison; this restores base 73101 and the exact saved policy. The independent-results table exposes exact configurations; the matched comparison uses common audiences. A study mean is not a single seed, and the live clock can continue after building clearance for outdoor travel/assistance. The editor and runtime share the same installation overlay. Invalid bypasses are rejected; configuration export/import preserves layouts.

The professional model guide derives the mathematics and supplies the full evidence ledger. The original A-Lite simplification audit documents its transport foundation. Remaining limits include reconstructed dimensions, inferred sign mounting, no head occlusion or photometry, approximate acoustic reach, whole-link occupancy at visible walkway junctions, full queue counts and configured rates at visible staff-observed gates, persistent stale gate reports, simulated zone-demand counts in adaptive staff forecasts, a shared staff closure flag for multi-closure configurations, queue-position approximation, unmeasured group behavior/compliance, staff bodies absent from flow, and no fire tenability or injury mechanics. Computational verification cannot supply missing Bailey observations. The defensible next calibration work is to measure response, row/aisle flow, exit counts, sign legibility and staff audibility, then fit and validate on separate events. The target itself is never a calibration datum.''']
if combined['id']!=selected['id']:
 parts.insert(parts.index('## Q4: device comparisons and mechanisms')+1,'![Separate combined-device policy, main floor.](figures/plus-combined6-main.svg)\n\n![Separate combined-device policy, balcony.](figures/plus-combined6-balcony.svg)')
# Concise tail diagnostics and discharge mechanisms from raw confirmation runs.
tails=[a for r in selected['runs'] for a in r['plus']['tail']];geo=json.loads(Path('src/data/geometry/bailey-hall.json').read_text());zones={}
for a in tails:
 z=geo['seats'][a['seat']]['zone'];zones[z]=zones.get(z,0)+1
tailtext=table(['Late-tail diagnostic','Selected policy, 100 audiences'],[['Mean start of last 50',f(statistics.mean(a['start'] for a in tails))+' s'],['Mean accumulated waiting before building crossing',f(statistics.mean(a['wait'] for a in tails))+' s'],['Most represented seat zones',', '.join(f'{k}: {v}' for k,v in sorted(zones.items(),key=lambda x:-x[1])[:6])]])
ix=parts.index('## Q5: costs and practical feasibility');parts.insert(ix,tailtext)
parts.insert(ix+1,table(['Confirmed policy','LED noticed / first notice (s)','Destination switches by cause','Density exposure / peak'],[[label(c['id']),f"{statistics.mean(r['plus']['peopleNoticingLED'] for r in c['runs']):.0f} / {f(statistics.mean([r['plus']['meanNoticeTime'] for r in c['runs'] if r['plus']['meanNoticeTime'] is not None])) if any(r['plus']['meanNoticeTime'] is not None for r in c['runs']) else '—'}",'; '.join(f"{k}: {statistics.mean(r['plus']['counts'].get(k,0) for r in c['runs']):.1f}" for k in ['switch-manager','switch-observation','switch-sign']),f"{stats(c)['exposure']:.0f} / {stats(c)['peakDensity']:.2f}"] for c in conf]))
parts.insert(parts.index('## Controlled model ablations'),table(['Confirmed policy','Mean exit-group use (people/run)'],[[label(c['id']),'; '.join(k+': '+f(v) for k,v in stats(c)['usage'].items())] for c in conf]))
parts.insert(parts.index('## Q2: unexpected obstruction and communication'),table(['Staffing / refined policy','Exposure / peak density','Mean exit-group use'],[[label(c['id']),f"{stats(c)['exposure']:.0f} / {stats(c)['peakDensity']:.2f}",'; '.join(k+': '+f(v) for k,v in stats(c)['usage'].items())] for c in expanded_cases+fine]))
# Report only completed obstruction pairs; absent tests never count as passing.
barrier_assessment=[]
for phase,prefix in [('obstructions','selected'),('staff-expansion-robustness','expanded'),('guidance-refinement-robustness','refined')]:
 for link in ['F3','FC2','D3']:
  rows_b=data[phase]['cases'];a=next((c for c in rows_b if c['id']==prefix+'-'+link),None)
  bid=('without-barriers-'+link) if phase=='obstructions' else prefix+'-'+link+'-without-barriers'
  b=next((c for c in rows_b if c['id']==bid),None)
  status='Not completed'
  if a is not None and b is not None:
   sa,sb=stats(a),stats(b)
   status='Unresolved audience: no unconditional mean' if sa['failed'] or sb['failed'] else ('Material deterioration' if sa['mean']-sb['mean']>5 else 'No deterioration above the declared 5 s screen')
  barrier_assessment.append({'phase':phase,'closure':link,'status':status,'paired':paired(a,b) if a is not None and b is not None else 'Unrun'})
(R/'barrier-assessment.json').write_text(json.dumps({'criterionSeconds':5,'pairs':barrier_assessment,'conclusion':'Installation recommendation withheld: the full declared obstruction comparison was not completed.'},indent=2)+'\n')
parts.insert(parts.index('## Q1 and Q3: different uses of the same model'),'The complete declared obstruction screen was not finished. **No barrier installation recommendation is made.** Completed pairs are reported below; an absent test is not a pass.\n\n'+table(['Study','Closure','Paired barrier minus no-barrier difference, s','Status'],[[x['phase'],x['closure'],x['paired'],x['status']] for x in barrier_assessment]))
parts.extend(['## Historical comparisons retained',
'''The following earlier studies use different engines and instruction/barrier semantics, so they are not interchangeable with Plus. The original 04:20 commit is `3e4bcf08e258e5db41b0035e307415bf129bc011`. Legacy A and B remain available, and their configurations and source snapshots remain archived. The original six-manager placement study gave A 230.1 s, Lite 194.2 s and B 182.6 s on 40 audiences. These are means of a specific policy, not default-seed outputs.

The subsequent original-Lite route study evaluated 217 block plans and 84 placements, then froze two roles before 60 fresh audiences: the overall plan averaged 186.87 s in Lite (A 212.39, B 183.41); its combined-device role averaged 188.83 s in Lite (A 214.87, B 179.47). At the prespecified finest 0.0125 s step the same Lite policies averaged 186.84 and 190.45 s. None demonstrates the Lite target. The faster B value is a different abstraction, including optimistic storage relief; it does not establish Plus performance. Full raw tables and configurations are in `results/route-study` and the historical study UI.

Earlier rope studies used a perceived crossing penalty; Plus uses physical bypass width and detour instead. Earlier utility-based acceptance merely influenced preferences; Plus commits accepted instructions. These changes can lengthen as well as shorten time. They were adopted for interpretable mechanisms before the final search, not chosen retrospectively for a faster mean.'''])
(D/'RESULTS_AND_CHANGES.md').write_text(re.sub(r'\$(?=\d)',r'\\$','\n\n'.join(parts))+'\n')
executive=f'''# Executive summary

**To: Mr. Timothy Ryan, University Fire Marshal and Director of Fire Protection and Emergency Services**

**Subject: Bailey Hall evacuation and the 180-second objective**

A-Lite+ is the primary comparative model. It retains the 1,329-person audience, including three wheelchair users, existing walkways, heterogeneous response, accessible routes and finite queues. Research informs its mechanisms; no Bailey evacuation dataset establishes local empirical validation.

The original six-manager policy averages **{f(s['mean'])} s** over 100 audiences (95% CI {f(s['ciLow'])}–{f(s['ciHigh'])}). A separately declared 1.4 m/s free-speed alternative retains age effects, row limits, headway and gate rates. With twelve stationary managers and retuned instructions, the 100-run result at the declared 0.0125 s step is **{f(stats(refined_fine)['mean'])} s** (95% CI {f(stats(refined_fine)['ciLow'])}–{f(stats(refined_fine)['ciHigh'])}); {stats(refined_fine)['k']}/100 audiences clear by 180. **The sub-180 mean target is not demonstrated.** Clearance means the last exterior building crossing; assisted travel to street level is separate.

The selected layout has {layout['selected']['resources']['stripMetres']:.1f} m of physical LED strips and {layout['selected']['resources']['barriers']} barriers, shown with staff posts in the report and editor. Belts reduce bypass width and receive no capacity bonus. Dynamic LEDs use delayed staff information. Accepted feasible instructions commit destinations; turns occur only at connected junctions. Additional staffing and limited empty-corridor patrols are separately costed. Staff bodies are not simulated.

The study was closed at the user’s request after completed confirmations were saved. Remaining ablations, device-isolation tests, Q1/Q3 scenario batches, parameter uncertainty and planned numerical checks were not completed; obstruction comparisons are partial. The model specifies all five questions, but this final report does not claim those unrun results. Barrier installation recommendations are withheld pending the complete obstruction screen.

The code passed {load('verification')['tests']['passed']} tests. Ten completed full-run audits found no forbidden transitions; the UI supports exact policy/seed replay and matched audiences. Before installation, survey clear widths and hardware footprints and measure response, flow, sign legibility and audibility. Guidance choreography merits testing, but these predictions are not a sanguine guarantee of real evacuation performance. Fire tenability and injuries are outside scope.
'''
(D/'EXECUTIVE_SUMMARY.md').write_text(executive)
with (R/'comparisons.csv').open('w') as out:
 w=csv.writer(out,lineterminator='\n');w.writerow(['phase','id','runs','mean','ciLow','ciHigh','p95','p180','p180Low','p180High','failed','exposure','peakDensity'])
 for name,d in data.items():
  for c in d['cases']:
   st=stats(c);w.writerow([name]+[st[k] for k in ['id','n','mean','ciLow','ciHigh','p95','p180','p180Low','p180High','failed','exposure','peakDensity']])
readme=Path('README.md');readme.write_text(re.sub(r'<!-- PLUS_RESULT_START -->.*?<!-- PLUS_RESULT_END -->','<!-- PLUS_RESULT_START -->\n'+conclusion+'\n<!-- PLUS_RESULT_END -->',readme.read_text(),flags=re.S))
print(conclusion);print('Replications:',total)
