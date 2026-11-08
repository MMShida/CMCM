"""Select on training audiences only, then freeze paired confirmation and robustness cases."""
from pathlib import Path
import json,copy,subprocess,time,gzip
D=Path('results/placement-study')
def run(name,cases,n,seed):
 p=D/(name+'-cases.json');p.write_text(json.dumps(cases,indent=1))
 subprocess.run(['node','--import','tsx','scripts/lite-study.ts','--cases',str(p),'--out',str(D/(name+'.json')),'--runs',str(n),'--seed',str(seed),'--workers','4'],check=True)
def read(name):
 p=D/(name+'.json');return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
# The initial screening process was started separately. Never consume partial rankings.
while True:
 try:
  screen=read('screen')
  if len(screen['results'])==84:break
 except (FileNotFoundError,json.JSONDecodeError):pass
 time.sleep(5)
original={r['id']:r for r in read('screen-cases')}
rank=sorted(screen['results'],key=lambda r:r['stats']['mean'] or 1e9)
selected={r['id'] for r in rank[:6]}
for key,vals in [('led',['early','decision','corridor','none']),('placement',['existing','coverage','decision']),('barrier',['none','hard0','hard1','hard2','rope1','hard02','hard20'])]:
 for value in vals:
  selected.add(next(r['id'] for r in rank if r[key]==value))
short=[original[r['id']] for r in rank if r['id'] in selected]
# Operational controller sensitivity: same early/decision/corridor devices, allow zone redirects.
for led in ['none','early','decision','corridor']:
 c=copy.deepcopy(original['existing-'+led+'-hard1']);c['cfg']['adaptive']['staticPlan']=False;c['id']='zone-'+led+'-hard1';c['cfg']['label']=c['id'];short.append(c)
run('shortlist',short,12,61007)
rows=sorted(read('shortlist')['results'],key=lambda r:r['stats']['mean'] or 1e9)
configs={r['id']:r for r in short}
best=copy.deepcopy(configs[rows[0]['id']])
combined=copy.deepcopy(configs[next(r['id'] for r in rows if r['led']!='none' and r['barrier']!='none')])
final=[]
for id,c in [('best-six',best),('combined-six',combined)]:
 c=copy.deepcopy(c);c['selectedFrom']=c['id'];c['id']=id;c['models']=['A','B','Lite'];final.append(c)
for id,led,barrier in [('combined-no-led',False,True),('combined-no-barrier',True,False),('matched-guidance-only',False,False)]:
 c=copy.deepcopy(combined);c['id']=id;c['models']=['Lite'] if id!='matched-guidance-only' else ['A','B','Lite'];
 if not led:c['cfg']['led']['enabled']=False
 if not barrier:c['cfg']['barriers']=[];c['cfg'].pop('barrierTypes',None)
 c['cfg']['label']=id;final.append(c)
baseline=copy.deepcopy(original['existing-none-none']);baseline['id']='six-original-posts-guidance';baseline['models']=['Lite'];final.append(baseline)
# Freeze choices before examining new seeds. No confirmation-driven retuning.
(D/'selection.json').write_text(json.dumps({'trainingSeeds':read('shortlist')['seeds'],'best':best['id'],'combined':combined['id'],'frozenCases':final},indent=1))
run('confirmation',final,40,61106)
stress=[]
for c in final[:2]:
 for blocked in [False,True]:
  v=copy.deepcopy(c);v['id']+=('-blocked-F3' if blocked else '-open');v['models']=['A','B','Lite'];v['scope']='blocked-exit sensitivity'
  if blocked:v['cfg']['blocked']['links']=['F3']
  stress.append(v)
run('blocked',stress,12,61206)
sens=[]
for id,change in [('range6',lambda c:c['led']['spatial'].update(range=6)),('notice60',lambda c:c['led'].update(perceiveProb=.6))]:
 c=copy.deepcopy(final[1]);c['id']=id;c['scope']='visibility sensitivity';c['models']=['Lite'];change(c['cfg']);sens.append(c)
# An unchanged control on the same sensitivity seeds is required for a paired comparison.
c=copy.deepcopy(final[1]);c['id']='visibility-control';c['models']=['Lite'];sens.append(c)
run('visibility',sens,12,61306)
(D/'complete.json').write_text(json.dumps({'complete':True,'selectionFrozen':True}))
