"""Check completed study provenance, sample sizes and fixed-scope configurations."""
from pathlib import Path
import gzip,hashlib,json,math,subprocess,sys
AVAILABLE="--available" in sys.argv
missing=[]
R=Path('results/plus-study')
def load(name):
 p=R/(name+'.json')
 if AVAILABLE and not p.exists() and not Path(str(p)+'.gz').exists():
  missing.append(name);return {'cases':[],'records':[]}
 return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def normalized_population(p):
 p=dict(p)
 if p.get('speedDistribution')=='normal':p.pop('speedDistribution')
 return p
freeze=load('calibration-freeze')['physical']
expected={'screen':4,'validation':16,'staff-validation':16,'confirmation':100,
 'ablations':16,'devices':20,'obstructions':20,'questions':20,'uncertainty':12,
 'numerics':20,'speed-sensitivity':20,'speed-confirmation':100,
 'staff-expansion-screen':8,'staff-expansion-validation':16,
 'staff-expansion-confirmation':100,'staff-expansion-robustness':20,'final-resolution':100,
 'guidance-refinement-search':8,'guidance-refinement-validation':20,
 'guidance-refinement-confirmation':100,'guidance-refinement-fine':100,'guidance-refinement-robustness':12,'resolution-diagnostic':20}
cases=0;runs=0;failures={};missing_staff_telemetry=set()
for phase,n in expected.items():
 data=load(phase)
 for c in data['cases']:
  assert len(c['runs'])==n,(phase,c['id'],'incomplete')
  assert len({r['seed'] for r in c['runs']})==n,(phase,c['id'],'duplicate seed')
  for r in c['runs']:
   assert r['N']==1329,(phase,c['id'],'audience changed')
   if 'staffCount' in r['plus']:assert r['plus']['staffCount']==c['cfg']['crowdManagers']['count'],(phase,c['id'],'staff mismatch')
   else:missing_staff_telemetry.add(phase+':'+c['id'])
   done=r['allLeftBuilding'] and r['unresolvedInside']==0
   assert done==(r['tEvac'] is not None and math.isfinite(r['tEvac'])),(phase,c['id'],'completion endpoint mismatch')
   if not done:failures[phase+':'+c['id']]=failures.get(phase+':'+c['id'],0)+1
  if phase in ['screen','validation','staff-validation','confirmation']:
   for key in ['population','movement','premovement']:assert c['cfg'][key]==freeze[key],(phase,c['id'],key,'physical freeze changed')
  if phase.startswith('staff-expansion') or phase=='speed-confirmation':
   pop=normalized_population(c['cfg']['population']);pop['speedMean']=freeze['population']['speedMean']
   assert pop==freeze['population'],(phase,c['id'],'audience calibration changed beyond declared speed')
   assert c['cfg']['premovement']==freeze['premovement']
  cases+=1;runs+=n
for suite in load('supplement-protocol')['suites']:
 actual={c['id'] for c in load(suite['name'])['cases']};declared={c['id'] for c in suite['cases']}
 assert actual<=declared if AVAILABLE else actual==declared
for phase in ['screen','validation','confirmation','staff-expansion-screen']:
 protocol=load('staff-expansion-protocol' if phase=='staff-expansion-screen' else phase+'-protocol')
 assert {c['id'] for c in load(phase)['cases']}=={c['id'] for c in protocol['cases']}
for c in load('final-resolution')['cases']:
 parent=load('speed-alternative-config' if c['id'].startswith('six') else 'staff-expanded-config')
 cfg=json.loads(json.dumps(c['cfg']));cfg['movement']['dt']=parent['movement']['dt'];cfg['label']=parent['label']
 assert cfg==parent,(c['id'],'refinement changed the policy')
 assert c['cfg']['movement']['dt']==.0125
 assert [r['seed'] for r in c['runs']]==c['seeds']
refinement_base=load('staff-expanded-config')
def without_messages(c):
 c=json.loads(json.dumps(c));c['crowdManagers'].pop('plan');c['preassign'].pop('plan');return c
for phase in ['guidance-refinement-search','guidance-refinement-validation','guidance-refinement-confirmation']:
 for c in load(phase)['cases']:assert without_messages(c['cfg'])==without_messages(refinement_base),(phase,c['id'],'changed beyond guidance')
refined_fine=load('guidance-refinement-fine')['cases'][0]['cfg']
assert refined_fine['movement']['dt']==.0125
refined_fine['movement']['dt']=load('guidance-refined-config')['movement']['dt']
assert refined_fine==load('guidance-refined-config'),'Final guidance step changed more than dt'
assert len(load('guidance-refinement-validation')['cases'])==3
assert AVAILABLE or len(load('guidance-refinement-robustness')['cases'])==6
for role in load('resolution-diagnostic-protocol')['roles']:
 c=next((c for c in load('resolution-diagnostic')['cases'] if c['id']==role['id']),None)
 if c is None and AVAILABLE:continue
 assert c is not None
 reference=next(c for c in load(role['file'])['cases'] if c['id']==role['reference'])
 assert c['cfg']['movement']['dt']==.00625
 cfg=json.loads(json.dumps(c['cfg']));cfg['movement']['dt']=reference['cfg']['movement']['dt']
 assert cfg==reference['cfg'],'Numerical diagnostic changed the policy'
 assert [r['seed'] for r in c['runs']]==[r['seed'] for r in reference['runs'][:20]]
geo=Path('src/data/geometry/bailey-hall.json').read_bytes()
original=subprocess.check_output(['git','show','3e4bcf0:src/data/geometry/bailey-hall.json'])
assert geo==original,'Base geometry changed'
for phase in ['physical-audit','staff-physical-audit','guidance-refinement-audit']:
 records=load(phase)['records']
 if not records and AVAILABLE:continue
 assert records and all(r['violations']==0 and r['N']==1329 and r['wheelchairs']==3 for r in records)
assert not load('seed-independence')['overlaps']
result={'scope':'Completed cases only; closed early at user request' if AVAILABLE else 'Complete declared study','unrunArtifacts':sorted(set(missing)),'cases':cases,'replicationsExcludingOptimizationAndAudits':runs,
 'earlierCasesWithoutRuntimeStaffTelemetry':sorted(missing_staff_telemetry),'unresolvedByCase':failures,'geometrySHA256':hashlib.sha256(geo).hexdigest(),
 'geometryIdenticalTo':'3e4bcf0','audience':1329,
 'checks':'Every published case has its declared sample size; unique audience seeds per case; all 1329 retained; recorded runtime staff counts checked when present (earlier missing telemetry listed); consistent completion endpoint; primary physical freeze; declared speed changes only; finest-step policy unchanged; zero forbidden transitions; no cross-phase seed overlap.'}
(R/'study-integrity.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
