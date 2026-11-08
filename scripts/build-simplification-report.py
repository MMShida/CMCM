"""Assemble the technical audit from saved experiments, without selecting on holdout results."""
from pathlib import Path
import json,statistics as st,sys,gzip
from importlib.util import spec_from_file_location, module_from_spec
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'docs/research-180';R=ROOT/'results/lite-study';M=ROOT/'results/mechanism-audit'
module_spec=spec_from_file_location('lite_report',ROOT/'scripts/lite-report.py')
rep=module_from_spec(module_spec);module_spec.loader.exec_module(rep)
def load(p):return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def rows(n):return load(R/(n+'.json'))['results']
def f(x):return rep.fmt(x)
def tab(h,b):return '| '+' | '.join(h)+' |\n|'+ '|'.join('---' for _ in h)+'|\n'+''.join('| '+' | '.join(str(x) for x in r)+' |\n' for r in b)
conf=rows('confirmation');best={r['model']:r for r in conf if r['id']=='best-lite'};parts=[]
parts.append('''# A-Lite: model simplification and experimental audit

**Independent confirmation: A-Lite 191.4 s [188.3, 194.6]; the mean 180-second target was not achieved.** All forty A-Lite audiences cleared; six cleared by 180 s. The same guidance gives 259.0 s in A and 166.4 s in B. These are model-dependent predictions, not estimates to average together.

The reference is Mateus's 8 November 2026, 04:20:42 EST commit `3e4bcf0`. The previous source was saved before this extension. Original A remains available when optional switches are absent. Every new operational finalist has **no barriers**, retains 1,329 people and three wheelchair users, and uses unchanged geometry, gate rates, body-size/speed/response distributions and imperfect compliance. A-Lite deliberately simplifies group motion; that structural change is not an operational achievement.

The companion **MODEL_GUIDE.pdf** develops the full model ladder and shared mathematics. This report specifies A-Lite, audits mechanisms and reports verification and experiments. Historical panel-based winners remain in **RESULTS_AND_CHANGES.pdf**; they are not proposed egress installations.

''')
spec=(D/'SIMPLIFICATION_SPEC.md').read_text();parts.append(spec[spec.index('## Movement mechanisms'):])
parts.append('''## Numerical artifacts and isolated verification

A carried displacement across a link boundary but discarded the carry from stored velocity. An empty 12 m path took 10.1 s as one link and 13.7 s as 24 links. Including admitted carry restores 10.0–10.1 s without increasing free speed. At most one boundary is traversed per step, so very short links remain a discretization limitation.

A's following law used the leader's already-updated position. A paced platoon discharged at 1.0345 persons/s at a 0.1 s step, versus the intended 0.9375. Start-of-step positions restore 0.9375 at steps 0.1, 0.05 and 0.025 s. Correcting this optimistic artifact can slow a whole-building run.

An exhausted indoor route could retain zero remaining cost after an exterior crossing and prevent continuation toward street safety. Invalidating a path that lacks the current node before applying route inertia fixes this demonstrated failure. It is mandatory in Lite and optional in A; it does not alter the exterior reporting boundary.

![Empty-link segmentation and saturated following expose numerical artifacts with opposite effects.](figures/numerical-audit.svg)

Tests cover corridor FIFO, row distance, sustained door/stair service, simultaneous merges, opposing slot exchange, parallel lanes, every-step storage and population conservation, identical audience draws, wheelchair accessibility and blocked-door discovery. Each Lite direction's cumulative discharge is bounded by integrated service plus one initial person. No timed storage overflow is permitted. These are implementation checks, not Bailey calibration; aggregate queue coordinates do not prove collision-free body trajectories.

The previous conservative gate integration preserves fractional service after admission. It is isolated from these new corrections. Queue costs and predicted waits affect route preferences; they are not added again to physical travel time. Original A permits multiple admissions at a junction: gaps, lanes and service constrain admission, not a blanket one-person-per-node rule.

## Progressive ablations in original A

Four common training audiences test individual mechanisms before combining them. The control uses the refined A guidance with historical panels removed. Invalid early Lite prototypes are excluded from all final-model conclusions.

''')
a=load(M/'ablations.json')['results'];control=next(r for r in a if r['id']=='guidance-open' and r['model']=='A')['stats']['mean'];labels={'numeric-velocity':('Boundary velocity','Numerical'),'numeric-headway':('Synchronous headway','Numerical'),'numeric-both':('Both corrections','Numerical'),'A1-acceleration':('Instant acceleration','Structural'),'A2-seat-squeeze':('Remove seated squeeze','Structural'),'A3-merge':('FIFO merge priority','Structural'),'A4-group-pace':('Group pace without spatial lag','Structural'),'A5-adaptive-person':('Adaptive individual state on','Behavioral'),'A6-static-staff':('Legacy fixed staff','Guidance + hearing'),'micro-combined':('Combined structural switches','Structural')}
b=[['Open-route control','Guidance',f(control),'0.0']]
for r in a:
 if r['model']=='A' and r['id'] in labels:b.append([*labels[r['id']],f(r['stats']['mean']),f(r['stats']['mean']-control)])
parts.append(tab(['Variant','Class','Mean s','Difference s'],b))
parts.append('''Acceleration removal produced the strongest individual improvement in this screen. Removing seated squeeze or random merging did not improve mean time. Static legacy staff also changes the hearing/version model, so it does not isolate redirection. All numerical corrections together gave 238.5 s; adding instant acceleration gave 207.9 s; adding all structural switches gave 212.3 s. Interactions cannot be obtained by adding individual effects.

A new partial-controller guard forecasts opposing intended-path arrivals over 10 or 20 s, retaining the chained-FCFS predictor. Four-audience means were 248.2 and 235.8 s versus control 236.4 s. Global intended-route knowledge remains an inherited strong assumption. No clear transferable benefit justified selecting this controller.

## Guidance, visibility and operational search

The final per-lane FIFO model uses four common training audiences below. The first group shares the A-derived open-route plan. B-derived plans are separate candidates: cross-plan differences are not channel-only effects.

''')
lane=rows('lane-screen');ids=['no-guidance','existing','staff','preassign','led','staff-led','combined','static-combined','group-consistent','visible-signs','B-visible','B-static']
parts.append(tab(['Training configuration','Lite mean s','Incomplete'],[[r['id'],f(r['stats']['mean']),str(r['stats']['failures'])+'/4'] for id in ids for r in lane if r['id']==id]))
parts.append('''Abstract LEDs know each original seat block. Spatial signs carry fixed public messages and require range, facing angle and optionally clear sight through walls/columns/panels. Their notice/adoption values 0.9/0.7 are Bailey assumptions, not a decomposition of a trial's combined 66% redirection outcome [R8,R9]. More information did not consistently shorten evacuation.

`staticPlan` keeps instructions fixed under congestion but retains acoustic reach, manager-specific hearing and closure overrides. Static acoustic and adaptive zone policies both gave 201.8 s; legacy fixed staff gave 193.9 s. Removing LEDs from the acoustic policy gave 193.1 s. The selected Lite policy therefore uses staff plus preassignment, no LED, no barrier, and adaptive individual state off. Imperfect instruction acceptance and persistent route preferences remain.

Coverage with 6, 10, 12 and 18 staff gave 211.1, 204.4, 195.6 and 188.6 s on four audiences. Extra staff are an explicit resource. Staff bodies and their own evacuation are absent from the inherited audience model; placements are graph-based candidates, not surveyed installations.

Three final-formulation coordinate searches each evaluated 77 block plans on four audiences. A visible-sign plan improved 193.9 to 187.9 s; a ten-staff/no-LED plan 193.1 to 185.4 s; an eighteen-staff plan 188.6 to 186.3 s. Every trial is retained. Twelve training audiences then selected the optimized no-LED plan with eighteen coverage posts, mean 189.1 s. The 44-block plan was frozen before independent evaluation. Search does not prove a global optimum.

## Independent confirmation and transfer

Training uses base seed 9001; forty fresh confirmation audiences use 20261109. The frozen configuration and timestamp are in `selection.json`. All failures remain. An unresolved audience makes the unconditional full-house mean unresolved. Median and p95 here describe last-person times across runs, not individual exit times.

''')
parts.append(rep.table(conf))
p=rep.paired(best['Lite']['runs'],best['A']['runs']);staff=next(r for r in conf if r['id']=='ten-staff-lite');ps=rep.paired(best['Lite']['runs'],staff['runs']);pa=rep.paired(next(r for r in conf if r['id']=='guidance-open')['runs'],next(r for r in conf if r['id']=='original-0420' and r['model']=='A')['runs'])
parts.append(f'''Same-policy Lite minus A is **{f(p['mean'])} s [{f(p['lo'])}, {f(p['hi'])}]**. This includes movement/group simplification and feedback on starts and choices, not just microscopic friction. Eighteen versus ten staff in Lite gives **{f(ps['mean'])} s [{f(ps['lo'])}, {f(ps['hi'])}]**. A-specific open-route guidance versus original A gives **{f(pa['mean'])} s [{f(pa['lo'])}, {f(pa['hi'])}]**.

Lite's 6/40 completion-within-180 fraction has Wilson interval [0.071, 0.291]; B's 38/40 has [0.835, 0.986]. Every complete A variant has zero passes. The Lite policy transfers poorly to A: 259.0 s versus 239.0 s for A-specific guidance. A model-specific winner is not a robust cross-model policy.

All-corrections A fails on seed 1902007568 with 36 people inside. Its 230.9 s mean over the other 39 audiences is completion-conditioned, not a successful full-house mean. The saved failure state shows stalled east orchestra aisles/rows with opposing destinations and two people not on a link. Fixing isolated numerical artifacts does not establish freedom from spatial gridlock; defaults remain unchanged.

![Independent mean clearance and 95% intervals. The unresolved corrected-A row remains in the table, without a finite point on this chart.](figures/lite-confirmation.svg)

![Mean people remaining under original A and the same finalist policy in A, Lite and B.](figures/lite-clearance.svg)

## Last-person delays, queues and exit utilization

Read-only instrumentation records every movement step, state/link/route changes and gate series. Observer-detached replay produces identical per-person starts, exterior exits, safety times and route switches. Final-50 trajectories are gzip JSON with position, lane, velocity, group cap and blocking time. Constraint-active durations overlap and cannot be added as causal delays.

For seed 1294506412, historical refined A clears at 223.8 s. At 180 s, 241 remain: zero in seating/rows, 16 aisles, 89 corridors, 39 stairs and 97 other links; 50 are in exterior queues (a subset). The final 50 start at mean 41.7 s, experience 17.4 stop episodes each and a maximum continuous stop of 66.7 s. Following limits are active for mean 97.9 s and acceleration limits for 96.3 s. The late tail is downstream, not solely delayed seating response.

On the Lite-selected policy and that seed, A clears at 285.5 s versus Lite 192.5 s; first exits are 22.3 and 20.8 s. At 180 s A retains 280 people (zero rows, 13 aisles, 83 corridors, 77 stairs, 107 other), Lite nine. Final-50 mean starts are 39.2 and 24.3 s; membership differs, and local social feedback changes realized readiness without changing sampled response distributions. Stop episodes average 18.1 and 13.8; maxima are 65.6 and 98.2 s. Lite still has substantial queue waiting.

''')
b=[]
for model,r in best.items():
 x=r['stats'];rr=r['runs'];b.append([model,f(x['regionalPeakMax']),f(x['exposureMean']),f(st.mean(max(q['maxQueue'].values(),default=0) for q in rr)),f(st.mean(q['insideAt180'] for q in rr))])
parts.append(tab(['Model','Peak regional density','Mean exposure','Mean largest gate queue','Mean inside at 180'],b))
parts.append('''Density is persons/m². Exposure is mean integrated excess above 2 persons/m², in persons·s/m² per occupant. Peak is the maximum over regions, times and runs. Gate queues count people targeting gates, not all internal waiting. Local density differs in resolution: sub-link in A, original whole links in Lite, contracted edges in B. Shared geographic regional density is more directly comparable. No density is interpreted as an injury threshold.

''')
parts.append(tab(['Exit group','A mean people','Lite mean people','B mean people'],[[g]+[f(best[m]['stats']['usage'][g]) for m in ['A','Lite','B']] for g in best['A']['stats']['usage']]))
lr=best['Lite']['runs'];parts.append(f'''Similar exit shares despite different clearance curves show that information about unused exits alone does not explain the discrepancy. Lite accumulates mean {f(st.mean(r['lite']['totalQueueWait']/1329 for r in lr))} s of queue waiting per person; the mean maximum individual wait is {f(st.mean(r['lite']['maxQueueWait'] for r in lr))} s. These totals include outdoor continuation. Group readiness remains; additional spatial cohesion stops and distance-based breakup are removed.

Mean all-person street safety under the plan is 287.6 s in A and 235.3 s in Lite. B does not supply a finite assisted street-safety endpoint. All three include wheelchair users in building clearance.

''')
gb=[]
for model in ['A','Lite']:
 r=load(M/('final-'+model)/'best-lite-1294506412.json');g=r['gates'];ex=[k for k,x in enumerate(g) if x['exterior']];ss=r['gateSeries'];peak=max(sum(ss[k][j+1][0]-ss[k-5][j+1][0] for j in ex)/(ss[k][0]-ss[k-5][0]) for k in range(5,len(ss)));gb.append([model,f(peak),f(100*sum(g[j]['passes'] for j in ex)/sum(g[j]['capacityIntegral'] for j in ex))+'%',max(max((x[1] for x in row[1:]),default=0) for row in ss)])
parts.append(tab(['Trace model','Peak 5-s exterior admissions/s','Whole-run exterior utilization','Largest gate queue'],gb))
parts.append('''Utilization divides admissions by integrated nominal exterior capacity while anyone remains inside. Unused capacity includes periods without upstream supply and is not all avoidable waste. Peaks measure door admission, not the exterior-boundary crossing endpoint. Raw gate series retain the detailed resource-by-resource evidence.

## Blocked-door and physical sensitivities

F3 is closed from the start, using inherited discovery and manager communication. Twelve new audiences, base 20261110, are paired with an open-door case. Static staff retains closure overrides. This stress scenario is not an intervention for reaching 180.

''')
opened=rows('blocked-open');b=[]
for r in rows('blocked'):
 o=next(x for x in opened if x['model']==r['model']);p=rep.paired(r['runs'],o['runs']);b.append([r['model'],f(o['stats']['mean']),f(r['stats']['mean']),f"{f(p['mean'])} [{f(p['lo'])}, {f(p['hi'])}]",str(r['stats']['failures'])+'/12'])
parts.append(tab(['Model','Open mean s','Blocked mean s','Paired difference [95% CI] s','Incomplete'],b))
parts.append('''The required six-cell physical sensitivity grid uses twelve common training audiences and the same open-route A-derived guidance. Headway changes assumed passage capacity; row speed changes travel. These are calibration hypotheses, not operational gains [R4,R18,R19].

''')
cal=rows('calibration');parts.append(tab(['Headway / row speed case','A mean s','Lite mean s'],[[id]+[f(next(r for r in cal if r['id']==id and r['model']==m)['stats']['mean']) for m in ['A','Lite']] for id in dict.fromkeys(r['id'] for r in cal)]))
parts.append('''Under the selected Lite policy, H=0.7 s gives 189.1 s on twelve training audiences, H=0.6 gives 198.9 s and H=0.5 gives 192.1 s, with row speed unchanged. Rates alter queue information and subsequent routes, so full-building time need not improve monotonically. No tested alternative reaches 180; these results do not justify lowering congestion merely to force a pass.

## Time-step sensitivity and runtime

A three-audience check retains the frozen policy. Nominal service tests converge, while the full behavioral system can change ordering, event timing and subsequent random decisions as the step changes. Matching audience seeds therefore does not guarantee identical later choices.

''')
cv=load(R/'convergence.json')['records'];parts.append(tab(['Model','Step 0.10: mean s','Step 0.05: mean s','Step 0.025: mean s'],[[m]+[f(st.mean(r['summary']['tEvac'] for r in cv if r['model']==m and r['dt']==dt)) for dt in [.1,.05,.025]] for m in ['A','A-corrected','Lite']]))
parts.append('''The small Lite sample did not establish convergence. The frozen policy was therefore also evaluated at finer steps on the same forty independent confirmation audiences. This is a robustness check after selection, not optimization over step size.

''')
b=[['0.10',f(best['Lite']['stats']['mean']),f"[{f(best['Lite']['stats']['ciLow'])}, {f(best['Lite']['stats']['ciHigh'])}]",'reference']]
for r in rows('fine-step'):
 p=rep.paired(r['runs'],best['Lite']['runs']);b.append([str(r['cfg']['movement']['dt']),f(r['stats']['mean']),f"[{f(r['stats']['ciLow'])}, {f(r['stats']['ciHigh'])}]",f"{f(p['mean'])} [{f(p['lo'])}, {f(p['hi'])}]"])
parts.append(tab(['Step s','Lite mean s','95% CI','Paired difference vs 0.10 s'],b))
parts.append('''These results quantify whole-model sensitivity. A saturated-service unit test does not establish convergence of adaptive evacuation outcomes. A favorable discretization must not be promoted as an operational improvement.

Runtime is measured after the main jobs, in one process with one warm-up per model and three matched audiences in rotating model order. It includes construction and simulation, excluding serialization. Lite averages about 1.15 times faster than A here, a modest runtime benefit; B is about twice as fast as A. Shared routing and guidance still consume work. Contended exploratory worker timings are retained but not used for speedup claims.

''')
rt=load(R/'runtime.json');parts.append(tab(['Model','Mean wall time ms','Median ms'],[[m,f(x['mean']),f(x['median'])] for m,x in rt['stats'].items()]))
parts.append('''## Changes and reproduction

The earlier full suite passed 144 tests in 11 files. The final focused run passed 50 tests in three files, including a new blocked-door Lite regression and stronger every-step conservation assertions (145 total tests are now defined). Exact counts and build output are saved in `final-focused-tests.log` and `final-build.log`. Geometry and source hashes are in `verification.json`. All changes remain uncommitted.

| Component | Change and purpose |
|---|---|
| `LiteSimulation.ts`, `LiteMovement.ts` | Separate original-graph FIFO movement, strict storage, directional service, simpler group motion and density reporting |
| `Movement.ts`, `Routing.ts`, `Params.ts` | Optional numerical corrections and individual structural switches; original absent-flag behavior retained |
| `SimulationEngine.ts`, `MovementObserver.ts` | Optional movement factory and read-only diagnostic hooks; exact observer replay |
| `ManagerPolicy.ts`, `Guidance.ts` | Static acoustic staff policy and intended-counterflow forecast guard |
| Pool, optimizer and study scripts | A/B/Lite runs, complete configs, seeds, failures, source snapshots and final-50 trajectories |
| Movement/adaptive tests | Flow, storage, population, accessibility, closures, numerical counterexamples and guidance behavior |
| LaTeX pipeline | Editable sources, native mathematics, vector figures, cross-references and bibliography |

Large raw records are losslessly compressed on GitHub. Run `python3 scripts/restore-research-data.py` before using an analysis script that expects original JSON paths. Small runnable configurations and comparison CSVs remain uncompressed. The Python report builders read either format directly.

From `mateus-0420` with Node 22:

```
node --import tsx scripts/run-lite.ts --config results/lite-study/best-config.json --seed 1294506412 --out results/lite-study/reproduced.json
node --import tsx scripts/lite-study.ts --cases results/lite-study/confirmation-cases.json --out results/lite-study/reproduced-confirmation.json --seed 20261109 --runs 40 --workers 3
node --import tsx scripts/lite-convergence.ts
npm test
npm run build
python3 scripts/build-latex-docs.py --compile
python3 scripts/check-research-pdfs.py
```

The generated `latex` directory is self-contained: compile its `.tex` files using Tectonic or XeLaTeX. The first Tectonic run may fetch TeX packages. Generation requires Python/PyMuPDF; plots use Matplotlib. Fonts and vector equations are embedded. The study README identifies the retained final-model evidence; superseded prototypes are excluded from the published branch. Each final dataset includes configuration, seeds, source hash identifying an exact shared snapshot in `results/source-snapshots`. Every optimizer evaluation is retained.

## Recommendation and answers

**Is A overcomplicated relative to evidence?** Several microscopic and adaptive psychological rules use generic coefficients. More detail does not establish more realism. A remains valuable for exposing lane ordering, seated obstruction and spatial group interactions that queue models omit.

**Which restrictions are unnecessary?** Discarded admitted carry and invalid exhausted routes are demonstrated implementation artifacts. Acceleration is the strongest tested structural restriction; removing it is not a physical correction. Headway is a meaningful capacity mechanism, and its old discretization was optimistic. Removing seat squeezing or merge randomness did not consistently help. Group behavior cannot simply be deleted to claim success.

**Why is B faster?** It contracts walking links, aggregates seatway/lane travel, omits detailed spatial cohesion stops and retains optimistic receiving-storage/30-second relief. It still has heterogeneous response, preferences and group pace. Similar exit shares with very different clearance show that flow representation matters. Its under-180 result does not validate real Bailey performance.

**Is Lite more credible?** It is verified for stated population, storage and service invariants, not empirically validated. It retains the original spatial links and strict storage absent in B while omitting body-level interactions in A. This makes assumptions easier to inspect, not automatically more accurate. Queue coordinates cannot support contact-force, crush-injury or detailed body-level density claims.

**Which model should be primary?** Use A-Lite as the transparent operational-comparison model, original A as a required structural stress comparison, and B as an aggregate cross-check. Report time-step sensitivity and calibration uncertainty alongside results. The chosen Lite policy's poor transfer to A prevents calling it a robust building-wide solution. Corrected instant-acceleration A remains a structural sensitivity, not a validated replacement.

**Was 180 achieved defensibly?** Original A and Lite did not meet the independent mean target. The strongest complete new spatial-A alternative is 211.0 s after optional numerical fixes plus simplified acceleration. New open-route guidance alone gives 239.0 s. The historical 231.2 s A result used panels and is not a current installation recommendation. Lite gives 191.4 s at its nominal step; B gives 166.4 s under the same policy. No occupancy, response, compliance, geometry or physical rate was secretly changed. Finite search does not prove no better policy exists.

**What would improve evidence for judges?** Survey usable widths and visibility; measure seatway, aisle, stair and door trajectories/flow; observe group separation, response and actual staff/sign reach; compare with a suitable drill. These data could choose between model families and justify coefficients. Literature supports mechanisms, not venue-specific numerical validation. The defensible contribution is a transparent, reproducible comparison with explicit limits.
''')
(D/'SIMPLIFICATION_AUDIT.md').write_text('\n'.join(parts));print('Audit generated:',sum(len(x.split()) for x in parts),'words')
