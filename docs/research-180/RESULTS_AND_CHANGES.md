# What changed after 04:20 — and did it reach 180 seconds?

**Original guidance study: A 231.2 s; B 166.4 s. Later A-Lite study: 191.4 s [188.3, 194.6] on forty new audiences. A and Lite remain above the mean 180-second target.**

The tables in sections 1–8 preserve the original intervention study, including historical panel configurations. The later no-barrier simplification study is summarized below and fully documented in **SIMPLIFICATION_AUDIT.pdf**. Its structural changes to group motion are separate from the earlier unchanged-group intervention scope.

This is a continuation of Mateus's 8 November 2026, 04:20:42 EST commit **3e4bcf0**, in the isolated `mateus-0420` checkout. Earlier dirty work is preserved in the parent checkout. This report accompanies **MODEL_GUIDE.pdf**, which develops all model equations and research references from basic flow to the full agent model.

The target is the average, across audiences, of the last person's building-departure time. Every primary test retains **1,329 occupants, three wheelchair users, the original building, physical capacities, speeds, response distributions, group behavior, assistance and compliance probabilities**. No occupancy reduction or capacity multiplier is used to obtain the result.

Final confirmation uses **40 new audiences per configuration**, separate from screening and optimization. There are 6,052 recorded simulation replications across the reproduced matrix, search, confirmation, calibration/congestion sensitivities and 259 optimizer evaluations; time-step and ideal-flow diagnostic runs are additional. Optimization is not proof of a global optimum.

## 1. Independent confirmation

| Configuration | Model | Mean seconds [95% CI] | Runs ≤180 | Unresolved |
|---|---|---|---|---|
| Mateus original fixed | A | 268.6 [262.2, 275.1] | 0/40 | 0/40 |
| Mateus original fixed | B | 221.9 [217.9, 226.0] | 0/40 | 0/40 |
| Service integration only | A | 260.9 [256.3, 265.6] | 0/40 | 0/40 |
| Service integration only | B | 209.2 [205.7, 212.8] | 0/40 | 0/40 |
| Initial A finalist | A | 230.7 [227.4, 234.1] | 0/40 | 0/40 |
| Signs with wall occlusion, A plan | A | 230.8 [228.5, 233.2] | 0/40 | 0/40 |
| Selected for Model B | B | 166.4 [162.3, 170.5] | 34/40 | 0/40 |
| Signs with wall occlusion, B plan | B | 169.3 [165.7, 172.8] | 33/40 | 0/40 |
| Selected for A after refinement | A | 231.2 [227.7, 234.8] | 0/40 | 0/40 |

On matched audiences, selected A changes clearance by **-37.4 s [-45.2, -29.6]** relative to the original fixed policy. Selected B changes it by **-55.5 s [-61.2, -49.8]**. Negative values mean faster.

Cross-application: the selected A plan gives **180.9 [177.3, 184.5] s in B**; the selected B plan gives **257.4 [253.5, 261.2] s in A**. Full confirmation rows, including removing B's barriers, are in the app and CSV. Model-specific success is not automatically transferable.

The mean target and the probability of clearing every run by 180 s are different requirements. Confidence intervals represent seed variation under the assumptions; they do not measure error relative to a real Bailey evacuation. Any unresolved run makes the reported all-person mean unresolved.

## 2. What the selected guidance actually does

**Selected for A after refinement:** 6 managers at existing posts; adaptive individuals off, adaptive managers on; preassignment on; LEDs inherited abstract guidance field; group-consistent plan off; W1 (hard-panel), E1 (hard-panel).

**Selected for Model B:** 10 managers at existing posts; adaptive individuals on, adaptive managers on; preassignment on; LEDs 12 fixed signs, 24 m catchment, occlusion off; group-consistent plan off; W1 (soft-rope, 5 perceived s), E1 (soft-rope, 5 perceived s).

Instructions divide the audience into Mateus's original **44 zone/side/front-or-back blocks**. Search changes destinations on the existing routes, staff posts/count, communication options and corridor barrier slots. The plans are saved in the full configuration objects in `confirmation-cases.json` and `refinement-confirmation-cases.json` and can be loaded from the app's **180-second study** tab.

The initial search used 6 audiences, the placement/channel/barrier follow-up and coordinate descent used 4, and the shortlist used 12 common training audiences. A final A refinement started from the best 12-audience plan, then was assessed on those 12 training audiences before any reserved outcomes were consulted. It improved the training mean and entered separate 40-audience confirmation. The final 40-audience sample was reserved for confirmation. Joint mirrored front-to-back plans complement the asymmetric one-block optimizer; symmetry is a candidate restriction, not an asserted property of real evacuation behavior.

The refinement did not improve the independent A mean: 231.2 s versus 230.7 s for the initial finalist. It remains the training-selected plan; both results are retained, with no further tuning on these audiences.

The optional service correction conserves fractional door/stair service after admissions. It keeps the stated rates and a one-person idle burst. It is compared separately as “Service integration only”; it is not an invented physical improvement. Legacy defaults remain unchanged.

## 3. Crowd managers versus LEDs and preassignment

The table isolates guidance channels on the selected screening plan. These are **four-audience exploratory comparisons**, not independent estimates of effect size. “CM” denotes existing staff instructions; “pre” denotes the inherited probabilistic preassignment, and “LED” the inherited abstract guidance field. The underlying plan, behavior and probabilities remain fixed within each group.

| Training case | Model | Mean s | Inside at 180 | Unresolved |
|---|---|---|---|---|
| bestA-none | A | 325.9 | 531.8 | 0/4 |
| bestA-cm6 | A | 252.9 | 233.8 | 0/4 |
| bestA-cm10 | A | 245.8 | 217.5 | 0/4 |
| bestA-led | A | 291.2 | 423.0 | 0/4 |
| bestA-pre | A | 302.1 | 311.3 | 0/4 |
| bestA-cm-led | A | 237.1 | 209.5 | 0/4 |
| bestA-cm-pre | A | 231.6 | 231.8 | 0/4 |
| bestA-led-pre | A | 257.3 | 294.8 | 0/4 |
| bestB-none | B | 233.1 | 232.5 | 0/4 |
| bestB-cm6 | B | 170.4 | 0.3 | 0/4 |
| bestB-cm10 | B | 177.8 | 0.5 | 0/4 |
| bestB-led | B | 175.0 | 0.5 | 0/4 |
| bestB-pre | B | 191.8 | 9.3 | 0/4 |
| bestB-cm-led | B | 177.0 | 0.3 | 0/4 |
| bestB-cm-pre | B | 164.8 | 0.3 | 0/4 |
| bestB-led-pre | B | 177.6 | 1.3 | 0/4 |

Dynamic signage research supports investigating redirection, but the reported **66% final redirection in one combined sign/voice experiment** is not a universal probability of noticing or obeying a sign. This continuation labels the existing 0.9 notice and 0.7 acceptance values as assumptions; it does not raise them to make the target pass. [Galea et al., primary study](https://gala.gre.ac.uk/id/eprint/16552/).

## 3a. Additional staff: a resource comparison

The final staffing extension tests 12 and 18 proposed posts near existing walkable junctions, using the same activation-time distribution, hearing radius and acceptance probabilities. Each complete layout assigns every seating zone to a manager. These are additional personnel, not a cost-free change to the original six-manager plan. The inherited model omits staff footprint, crowd obstruction and staff evacuation: the unchanged 1,329-person population is the audience. Additional staffing must be read with this abstraction limit.

| Training case | Model | Mean s | Inside at 180 | Unresolved |
|---|---|---|---|---|
| staff12-A-fixed | A | 237.6 | 229.3 | 0/4 |
| staff12-A-managers | A | 257.6 | 212.5 | 0/4 |
| staff12-A-both | A | 243.1 | 250.0 | 0/4 |
| staff18-A-fixed | A | 239.9 | 221.3 | 0/4 |
| staff18-A-managers | A | 233.1 | 219.8 | 0/4 |
| staff18-A-both | A | 245.5 | 253.5 | 0/4 |
| staff12-B-fixed | B | 174.8 | 0.3 | 0/4 |
| staff12-B-managers | B | 166.6 | 0.0 | 0/4 |
| staff12-B-both | B | 164.0 | 0.0 | 0/4 |
| staff18-B-fixed | B | 176.5 | 0.3 | 0/4 |
| staff18-B-managers | B | 170.5 | 0.3 | 0/4 |
| staff18-B-both | B | 166.2 | 0.0 | 0/4 |

The first ten activation draws remain unchanged. Additional staff receive additional independent draws from the same distribution instead of cyclically reusing another manager's activation. Unavailable posts are honored in both engines, and the UI lists the selected layout's actual posts. These four-audience comparisons enter the training shortlist before any confirmation outcomes are available.

## 4. Visibility and barrier comparisons

| Visibility case | Model | Mean s | Inside at 180 | Unresolved |
|---|---|---|---|---|
| bestA-signs12-walls | A | 231.9 | 225.3 | 0/4 |
| bestA-signs12-clear | A | 234.5 | 224.8 | 0/4 |
| bestA-signs24-walls | A | 232.6 | 224.5 | 0/4 |
| bestA-signs24-clear | A | 232.2 | 230.0 | 0/4 |
| bestB-signs12-walls | B | 174.9 | 0.5 | 0/4 |
| bestB-signs12-clear | B | 164.9 | 0.0 | 0/4 |
| bestB-signs24-walls | B | 167.0 | 0.0 | 0/4 |
| bestB-signs24-clear | B | 161.9 | 0.0 | 0/4 |

For the selected B plan, enabling wall occlusion changes time by **2.8 s [-0.8, 6.4]** on the same 40 audiences; the configuration differs only in that switch. Its mean remains **169.3 s**, with 33/40 audiences at or below 180.

The visibility variant uses 12 fixed-message signs, same-floor eligibility, a 75-degree half-angle, 12 or 24 m range and optional wall/column/panel occlusion. These dimensions are assumptions tested for sensitivity. Sign height, crowd occlusion, luminance and actual installation feasibility are not resolved. [Visibility catchment method](https://fseg.gre.ac.uk/fire/visibility_catchment_area.html).

## 4a. Panel, rope and placement comparisons

These six-audience screening rows share the plan and guidance mode within each block. The final selected configuration is subsequently retested on the untouched audiences. Penalties are in perceived seconds, not measured walking delay.

| Barrier screening case | Model | Mean s | Inside at 180 | Unresolved |
|---|---|---|---|---|
| split-fixed | A | 239.2 | 232.7 | 0/6 |
| split-fixed-panel1 | A | 232.3 | 192.7 | 0/6 |
| split-fixed-rope5 | A | 235.5 | 208.3 | 0/6 |
| split-fixed-rope15 | A | 231.1 | 206.8 | 0/6 |
| split-fixed-rope30 | A | 233.1 | 198.7 | 0/6 |
| portico-both | B | 165.0 | 0.0 | 0/6 |
| portico-both-panel1 | B | 172.6 | 0.2 | 0/6 |
| portico-both-rope5 | B | 164.2 | 0.0 | 0/6 |
| portico-both-rope15 | B | 177.8 | 0.3 | 0/6 |
| portico-both-rope30 | B | 173.3 | 0.3 | 0/6 |

On the final 40 audiences, the selected B ropes change time by **-1.2 s [-5.4, 2.9]** versus the identical plan without barriers. The interval, rather than the small mean difference alone, determines how persuasive the barrier benefit is.

Hard panels close an existing corridor slot and occlude sight. Low ropes remain traversable and add an assumed 5/15/30 s perceived routing penalty; they do not slow actual walking or increase capacity. Panel/rope/asymmetric-location comparisons are fully listed in **ALL_COMPARISONS.csv**. Early rope screening preceded the correction that applies its cost consistently when reassessing the current path; selection and confirmation rerun candidates on the final mechanism.

Diversion posts, guardrails, ropes and opaque panels are not interchangeable. Experiments report context-dependent time and density effects, including guardrails that reduce density while increasing time. This lane/network model lacks the contact-force mechanism needed to claim a post's “arch-breaking” benefit. No imported percentage speed bonus or unmodeled mesh benefit is applied. [Wang et al.](https://arxiv.org/abs/2212.01296), [Feliciani et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC7525554/), [Chen et al.](https://doi.org/10.1016/j.ssci.2022.106020).

## 5. What is driving time, and what remains uncertain?

| Diagnostic on final selected plan | Model A | Model B |
|---|---|---|
| People still inside at 180 s | 194.5 | 0.3 |
| Mean start time of the last 20 out | 40.2 | 28.4 |
| Recorded wait of the last 20 out | 42.4 | 41.6 |
| Mean speed attribute of the last 20 (m/s) | 1.06 | 0.93 |
| Share of last 20 in a social group | 59.8% | 75.1% |
| Original-policy excess-density exposure | 17.5 | 19.2 |
| Selected-policy excess-density exposure | 18.3 | 16.9 |

Exposure integrates density above 2 persons/m² over time; its units are person·seconds/m² for each individual. This comparison level is not a safety threshold. A's faster policy has slightly more excess-density exposure than its original policy; B's has less.

**Spatial movement:** A imposes row speeds, no passing within a lane, gap acceptance, group pacing and finite space. At 1.2 m/s its inherited headway rule permits about **0.94 persons/s/lane** before other delays. The inherited rule floor(width/0.6 + 0.2) gives a 1.1 m aisle two lanes. B shares the representative lane-capacity formula but uses network queues and constant transit speed by default; its inherited storage-relief rule permits entry after 30 s of blockage. B therefore cannot establish A's target.

**Response and groups:** the maximum over 1,329 people amplifies late response and travel tails. Group readiness waiting, leader following and pacing can increase time; experiments motivate retaining group interaction. Their Bailey-specific parameters need measurements. Group-consistent messages preserve those rules. The inherited voice-alarm/meet-outside package and vacated-row routing are reported separately and excluded from the primary winner.

**Bailey:** the geometry is a reconstruction, not an as-built survey. Measured clear widths, door operation, stair routes, sightlines and whether particular posts are usable remain uncertain. Another theatre's symmetry and visible exits do not establish those properties here. Cornell's public seating figure differs from the problem specification; all primary runs deliberately retain **1,329**. [Theatre drills](https://link.springer.com/article/10.1007/s10694-018-0783-2), [Cornell venue information](https://scl.cornell.edu/get-involved/event-planning/bailey-hall/technical-information).

## 6. Numerical and ideal-flow checks

| Case | Audiences | Mean A: Δt=.1 | Mean A: Δt=.05 | Mean B: Δt=.25 | Mean B: Δt=.125 |
|---|---|---|---|---|---|
| mateus-fixed | 3 | 266.1 | 271.8 | 218.1 | 232.1 |
| selected-A | 3 | 225.2 | 240.9 | 173.0 | 172.5 |
| selected-B | 3 | 258.2 | 260.7 | 160.1 | 167.8 |
| refined-A | 3 | 230.2 | 242.4 | 173.6 | 174.4 |

Time-step differences include interactions and discrete decision timing, not only service integration. Three diagnostic audiences per configuration are a sensitivity check, not a convergence proof. A result near 180 must be read with this limitation.

| Case | Runs | Flow N | Mean C immediate | Mean C intrinsic | Mean own-speed bound | Mean C: A starts | Mean C: B starts |
|---|---|---|---|---|---|---|---|
| mateus-fixed | 3 | 1326 | 101.0 | 146.3 | 172.7 | 189.7 | 115.3 |
| selected-A | 3 | 1326 | 101.0 | 146.3 | 172.7 | 155.0 | 115.3 |
| selected-B | 3 | 1326 | 101.0 | 146.3 | 172.7 | 143.7 | 115.0 |
| refined-A | 3 | 1326 | 101.0 | 146.3 | 172.7 | 156.3 | 115.3 |

Model C's time-expanded flow has **1,326 ambulatory releases** and a representative travel speed. It is an ideal allocation benchmark, not a behavioral simulation of all 1,329 or a universal lower bound on every faster individual. The separate own-speed calculation includes the audience and accessibility. Missing departure times or unreachable routes now make the bound unresolved instead of silently dropping people. Building departure and assisted arrival at street level remain separate endpoints.

## 6a. Is Model B reasonable, and why is it faster?

B is a useful aggregate queue-and-route model. It is **not independently calibrated for Bailey**, and A's extra detail does not automatically make A correct. The same B-selected plan takes 257.4 s in A and 166.4 s in B on the 40 confirmation audiences.

| Mechanism | Spatial A | Network B |
|---|---|---|
| Seats to aisle | Actual row gaps, occupied-seat squeezing, no passing | Timed row travel, then aggregate row-end queue |
| Aisle movement | Individual gaps and lane order; slow walkers constrain followers | Representative capacity at 1.2 m/s, then individual transit time |
| Groups | Readiness, pace and physical separation/cohesion stops | Readiness, leader choice and slowest-member pace; no spatial cohesion stop |
| Crowding | Continuous space and opposing-flow interactions | Density slowdown off by default; approximate node storage |
| Recorded start | First physical row insertion | Beginning of timed row traversal after readiness |

The following **12-audience training-seed diagnostics** keep the selected plans and use only B's existing options. “No relief” removes the 30 s storage bypass but retains its original incoming-arc storage approximation; it is not a strict reservation of all incoming streams.

| Plan | B option | Mean s [95% CI] | Unresolved |
|---|---|---|---|
| A-selected | inherited | 180.9 [175.9, 185.9] | 0/12 |
| A-selected | density-slowing | 287.1 [280.0, 294.3] | 0/12 |
| A-selected | no-storage-relief | 181.8 [175.7, 187.9] | 0/12 |
| A-selected | density-and-no-relief | 293.0 [283.4, 302.5] | 0/12 |
| B, wall occlusion | inherited | 169.4 [165.8, 173.0] | 0/12 |
| B, wall occlusion | density-slowing | 294.9 [286.1, 303.8] | 0/12 |
| B, wall occlusion | no-storage-relief | 173.6 [165.4, 181.7] | 0/12 |
| B, wall occlusion | density-and-no-relief | 298.5 [289.4, 307.6] | 0/12 |

Density slowing changes visible-sign B from 169.4 to 294.9 s; removing relief alone gives 173.6 s. Slowing acts over a whole contracted arc at admission, possibly overlapping queue delay. **This uncalibrated sensitivity is not the corrected answer.** B's sub-180 result depends on its movement representation.

## 6b. Can existing A parameters reasonably reduce time?

The user-requested calibration audit changes two existing parameters while preserving all 1,329 people, geometry, body sizes, free-speed distribution, response, groups, compliance and guidance. These are **12 common training audiences**, separate from the unchanged-problem confirmation. Changing physical parameters is not counted as a guidance/barrier success.

| Parameter case | Row m/s | Headway s | A mean [95% CI] | B mean [95% CI] |
|---|---|---|---|---|
| Inherited parameters | 0.45 | 0.7 | 226.8 [222.2, 231.5] | 180.9 [175.9, 185.9] |
| Row speed only | 0.6 | 0.7 | 227.4 [221.0, 233.8] | 179.1 [173.0, 185.2] |
| Headway 0.60 | 0.45 | 0.6 | 225.4 [220.8, 230.0] | 183.2 [176.2, 190.1] |
| Headway 0.50 | 0.45 | 0.5 | 223.0 [219.7, 226.4] | 180.8 [173.1, 188.6] |
| Headway 1.06 | 0.45 | 1.06 | 241.3 [237.8, 244.8] | 181.7 [177.5, 185.9] |
| Row + headway 0.60 | 0.6 | 0.6 | 224.1 [219.4, 228.7] | 180.4 [173.9, 187.0] |
| Row + headway 0.50 | 0.6 | 0.5 | 225.0 [219.3, 230.7] | 184.0 [177.0, 191.1] |

The fastest tested A setting is **Headway 0.50**, 223.0 [219.7, 226.4] s, versus 226.8 s with inherited parameters. Its paired change is **-3.8 s [-8.9, 1.3]**; 0/12 audiences clear by 180. The paired interval includes zero, so this sample does not establish a reliable improvement. Mean individual excess-density exposure rises from 17.9 to 21.7 person·s/m². This is an exploratory comparison, not a confirmed winner or proof that 180 is impossible.

**Research supports testing, not choosing by the target.** Spearpoint and Xiang's lecture-theatre validation questioned a universal 0.45 m/s row cap and discusses 0.60 m/s as an alternative model value. Johansson motivates shorter net headways, while Seyfried's single-file data show a larger spacing slope. The definitions, settings and populations differ. The Model Guide's calibration-evidence section gives the equations and transfer limits. [Lecture-theatre study](https://publications.iafss.org/publications/fss/10/599/view), [headway study](https://arxiv.org/pdf/0908.3118), [single-file study](https://arxiv.org/pdf/physics/0506170).

A defensible next calibration would compare row trajectories, aisle discharge curves and group separation against observations, then validate on separate data. Simply reducing response delays, deleting group waiting, shrinking bodies or raising door flow until the target passes is not justified. No calibration setting from this audit replaces Mateus's defaults or the primary confirmed configurations.


## 6c. Can we simply weaken congestion until A passes?

This final user-requested check deliberately goes beyond the research-motivated calibration range. It removes the explicit opposing-flow speed penalty, raises the occupancy cap from 4.5 to 5.4 persons/m², and reduces net headway as far as 0.1 s. These settings are **diagnostics, not Bailey-calibrated improvements**. Geometry, audience, intrinsic speeds, response, groups and the selected A guidance remain unchanged. Each row uses the same 12 training audiences.

| A parameter case | H (s) | Counterflow coefficient | Density cap | Mean s | Runs ≤180 |
|---|---|---|---|---|---|
| inherited | 0.7 | 0.5 | 4.5 | 226.8 | 0/12 |
| no-counterflow-friction | 0.7 | 0 | 4.5 | 230.7 | 0/12 |
| density-cap54 | 0.7 | 0.5 | 5.4 | 229.4 | 0/12 |
| headway030 | 0.3 | 0.5 | 4.5 | 221.8 | 0/12 |
| headway010 | 0.1 | 0.5 | 4.5 | 224.6 | 0/12 |
| combined030 | 0.3 | 0 | 5.4 | 223.4 | 0/12 |
| combined010 | 0.1 | 0 | 5.4 | 225.7 | 0/12 |

The fastest tested case is **headway030: 221.8 s [216.7, 226.8]**, with 0/12 unresolved runs. Its paired change from inherited parameters is **-5.1 s [-11.0, 0.9]**. Mean individual excess-density exposure is 26.2, versus 17.9 person·s/m² originally.

At the unchanged representative speed 1.2 m/s and mean body diameter 0.44 m, reducing H from 0.7 to 0.3 or 0.1 s increases nominal lane capacity from 0.938 to 1.50 or 2.14 persons/s: approximately **60% or 129% more**. This changes physical throughput assumptions even though no aisle is widened. Removing counterflow friction still leaves lane sharing, body gaps, merging and queue constraints. Raising the density cap permits more crowding; it does not add door capacity.

Even these deliberately optimistic tests do not produce a sub-180 mean. They do not prove that every possible intervention or calibration must fail. The headway literature motivates testing shorter gaps, but it does not justify using 0.1 s for this mixed full-house audience. A target is an evaluation criterion, not a calibration observation.

No stress-test setting replaces the defaults or primary confirmed plans. Files: `congestion-cases.json`, `congestion.json`; reproduce with the study runner's evaluate mode, 12 runs and training seed base 9001. `research-congestion-report.ts` regenerates this page.


## 7. Exact changes from Mateus and verification

| Files / area | Change and reason |
|---|---|
| QueueSystem; NetworkSimulation; SimulationEngine | Optional conservative service integration; original default retained. |
| Barriers; Routing; StaticFlow; TimeExpanded | Distinguish physical panel closures from traversable rope routing cues in A, B and C. |
| SignVisibility; Guidance; NetworkSimulation | Optional range/facing/occlusion eligibility with fixed public sign messages and one notice opportunity. |
| Plan; Guidance; Placements | Optional consistent group messages; coverage layouts with 6, 10, 12 or 18 staff; guarded existing partial redirection. |
| Routing | Optional research sensitivity for staff-guided vacated seatways; excluded from primary search. |
| Comparison; TimeExpanded | Unknown starts and inaccessible destinations cannot disappear from the all-person individual bound. |
| ResearchStudyView; controls; map controllers | Load recorded configurations; show rope/panel distinction, actual network staff posts and spatial signs. |
| Research scripts; tests; docs | Seeded searches, raw runs/configs, source snapshots, failure-aware summaries, comparisons and both PDFs. |

**Unchanged fundamentals:** population generator, geometry data, physical flow-rate formulas, base movement law, recognition/response distributions, group waiting/cohesion, assistance and compliance probabilities. Default adaptive-off behavior reproduces stored legacy A/B results exactly.

Validation: The clean full suite passed 132 tests in 10 files. Updated layouts, the additional staffing test, all nine research tests and exact legacy A/B reproduction subsequently passed (133 tests covered). TypeScript checking and the production build passed. Both PDFs passed overflow checks and visual review. Browser checks confirmed all 16 result rows, both PDF links, exact configuration loading and A/B advancement to 60 s, with no console errors. One existing test assumed every custom placement had six posts; it was extended for the explicit ten-person layout and caught a misplaced new rear post, which was moved to the existing rear cross-aisle. All affected placement cases were rerun. This did not alter inherited post coordinates.

## 8. Reproduce and inspect

Run from **CMCM/mateus-0420**, not the older dirty parent checkout. `npm run dev -- --port 5180 --strictPort` serves this version. The study tab links both PDFs and loads each confirmed configuration into its matching engine.

**Confirmation:** `node --import tsx scripts/research-study.ts --mode evaluate --cases results/research-180/confirmation-cases.json --runs 40 --seed 20261108 --out results/research-180/confirmation.json`.

If the final A refinement was selected, its additional confirmation uses `refinement-confirmation-cases.json` with the same 40 untouched audience seeds and writes `refinement-confirmation.json`. `research-refine-finish.mjs` records the training-only selection rule and runs this additional comparison and its diagnostics.

**Original matrix:** `node --import tsx scripts/adaptive-experiments.ts --runs 40 --workers 5 --out results/research-180/mateus-matrix.json --doc docs/research-180/MATEUS_MATRIX.md`. Its defaults preserve the 04:20 behavior; the archived original run loaded the exact base simulation before these changes.

**Audit files:** `screen.json`, `followup.json`, `placement-corrected.json`, `bands.json`, `optimise-A/B-trials.jsonl`, `shortlist.json`, `confirmation.json` and `ALL_COMPARISONS.csv`. Each primary run retains its complete configuration and seed. Confirmation and diagnostics include exact source snapshots. The first broad screen used an earlier optional-feature state and is retained as search history, not final confirmation.

**Calibration audit:** `node --import tsx scripts/research-study.ts --mode evaluate --cases results/research-180/calibration-cases.json --runs 12 --out results/research-180/calibration.json`; run `research-network-audit.ts --id refined-A` and `--id visible-B` with the same Node/tsx invocation, then `research-calibration-report.ts`. These retain training seeds and do not replace confirmation.

**Regenerate the professional LaTeX documents:** `python3 scripts/build-latex-docs.py --compile`, then `python3 scripts/check-research-pdfs.py`. Editable `.tex` sources and vector figures are in `docs/research-180/latex`; Tectonic or XeLaTeX compiles them. Full mathematical derivations, equations and source-specific scope limits are in **MODEL_GUIDE.pdf**. The data remain available for independent review, including failures and out-of-scope inherited sensitivity cases.

## 9. A-Lite extension: independent results and new corrections

The separate spatial FIFO model retains all 268 nodes, 384 links and 1,329 people. It substitutes travel clocks, lane FIFO service and strict storage for microscopic following and acceleration; group readiness and slowest-member pace remain, while spatial cohesion stops and distance breakup are removed. Original A defaults remain available. All new operational finalists have no barriers.

| New confirmation case | Model | Mean s [95% CI] | Runs ≤180 | Unresolved |
|---|---|---|---|---|
| Original 04:20 | A | 263.6 [259.9, 267.4] | 0/40 | 0 |
| Open-route A guidance | A | 239.0 [235.6, 242.3] | 0/40 | 0 |
| All numerical corrections | A | Unresolved | 0/40 | 1 |
| Corrections + instant acceleration | A | 211.0 [207.5, 214.5] | 0/40 | 0 |
| Lite-selected guidance | A | 259.0 [254.7, 263.4] | 0/40 | 0 |
| Lite-selected guidance | A-Lite | 191.4 [188.3, 194.6] | 6/40 | 0 |
| Lite-selected guidance | B | 166.4 [163.2, 169.7] | 38/40 | 0 |

These fresh audiences use base seed 20261109; the previous study used 20261108. Do not interpret differences between their original-A means as a code change. The Lite policy uses eighteen coverage staff, fixed acoustic instructions with closure overrides, preassignment, no LED and no barrier. More staff is an explicit resource; staff bodies are not part of the inherited audience model. The same policy transfers poorly to spatial A.

New numerical switches preserve admitted boundary velocity, use start-of-step following gaps and invalidate exhausted paths before inertia. Each has an isolated counterexample and regression test. The all-corrections A case leaves 36 inside on one audience; its completion-conditioned 230.9 s mean is not a valid unconditional clearance mean. Instant acceleration is a separately labeled structural simplification, not a numerical fix.

At a 0.025 s step, the frozen Lite policy averages 188.7 s [186.2, 191.2] on the same forty audiences. The target still fails. The complete audit includes individual ablations, six-cell headway/row-speed sensitivity, blocked-door paired tests, final-50 traces, queue/exit/density comparisons and runtime. No physical capacity, population, intrinsic response or compliance was tuned to manufacture a pass.
