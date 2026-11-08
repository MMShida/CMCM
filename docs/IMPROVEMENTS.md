# Model improvements (2026-11-07)

This document lists every item of the improvement list, what was changed, and how each change
was checked. The source tree before these changes is in
`backup/pre-improvements-2026-11-07.tar.gz`. Results are in the second part,
[Results: how close can we get to 180 s?](#results-how-close-can-we-get-to-180-s).

Status: **done** = implemented and tested; **tool** = a script or analysis was added;
**cannot be coded** = needs data that only a measurement or a drill can provide.

## A. Model correctness and numerics

| # | Item | Status | What changed |
|---|---|---|---|
| 1 | Time-step dependence and jam outliers | done | Three probabilities were applied per step instead of per second, so halving dt doubled them: queue reconsideration, lane changes, group-cohesion and group-timeout ticks. They are now rates per second. At dt 0.1 → 0.05 the mean moved +12 s with a worst run of 423 s before; it now moves +2.6 s (inside the CI), sd 21 → 16 s. Check it with `scripts/convergence-check.ts`. |
| 2 | Doors D1/D9 and P1/P4 almost unused in Model A | done | **Root cause:** Model A agents routed to the *street* destination, 15.6 m beyond P1 along the portico, while Models B and C end at the exterior door (the problem's definition of leaving). Agents still inside now treat the node just outside an exterior door as the goal, and count the outdoor rest with `routing.outdoorWeight = 0.2`. P1 use went from about 5 to 65 per run (Model B: about 95). |
| 3 | Faster-is-slower mechanism has no effect | done (diagnosed) | The mechanism works, but it can never trigger in the base case: π = u × mean impatience ≈ 0.6 × 0.37 = 0.22, below the threshold 0.35. Switching it off only removes the 9% moderate-urgency gain. Documented; it stays a stress-test hypothesis (scenario `competitive`). |
| 4 | Assisted evacuation of wheelchair users | done | `assist.*`: two staff teams, free from 60 s, each carry one person down the main stair (60 s median, lognormal), then walk back. Completion is known when the person reaches the assistance point. New metric `tSafeAll`: the last person *including* assisted users at the street. T_evac is unchanged, because the assistance point is outside door F1, so these users have already left the building. |
| 5 | End point of the three models | done (verified) | All three models now end at the exterior doors. The portico stairs are outdoors, beyond the boundary, so they are correctly absent from B and C. |
| 5a | Route loops (found by tracing the last persons out) | done | People walked into the foyer and back out, re-entered the hall through D-doors, and went back down into the orchestra. There were two causes. **(i)** The logit error term was redrawn at every junction, a random walk between exits. It is now a persistent per-person taste (`routing.persistentTaste`, one Gumbel draw per person and exit, from a separate random stream, so the audience is unchanged; identical in A and B). **(ii)** Nothing stopped people from going back in. Now `routing.noReentry`: auditorium doors D1–D9, foyer connections FC1–FC3 and the orchestra access stairs are used outward only, except by people walking back to rejoin their group (A and B). |
| 5b | Crowd Manager instructions forced U-turns | done | Hearing an instruction re-planned unconditionally (no inertia, U-turn allowed), and rebalancing re-broadcasts. An instruction now re-plans like a routine decision; only newly learned closures force an unconditional re-plan (A and B). The no-U-turn rule now also applies to a re-plan in the middle of a link. |
| 5c | Crowds inside aisles invisible to route choice | done | Only door and stair queues were perceived, so agents chose detours into jammed aisles; one person queued 100+ s in an aisle while the stage exit was 12 s ahead. Now `routing.aisleQueueWeight`: a visible crowd walking the same way in an aisle, cross-aisle or passage costs n / (lanes available to that direction × 0.94 p/s), weighted like a gate queue. Model B already perceived all visible queues. |
| 5d | Nobody ever turned back in a jam | done | After 20 s stuck, a re-plan may turn back (`'stuck'` cause); route inertia still applies. |

## B. Geometry and capacity data

| # | Item | Status | Notes |
|---|---|---|---|
| 6 | Real stair, door and aisle widths | **cannot be coded** | Measurement checklist below. Stair flow is still the most sensitive physical input. |
| 7 | Row lengths and which aisle each centre row exits to | **cannot be coded** | Same checklist. |
| 8 | Plans by seat block | done | `src/simulation/Plan.ts`: plan keys `ZONE`, `ZONE:W\|E` and `ZONE:W\|E:F\|B` (half of a zone; front or back half of its rows). The most specific key wins. Zone-level plans behave exactly as before. Used by Crowd Managers, LEDs and pre-assignment in Models A and B. 44 blocks. |

## C. Pre-movement and alarm

| # | Item | Status | What changed |
|---|---|---|---|
| 9 | Calibrated pre-movement | partial | No Bailey Hall data. The Galea-type values remain a sensitivity case. The new Model C *pre-movement budget* (section H) says how much faster the starts must be for 180 s to be feasible at all. |
| 10 | Alarm timeline | done | `alarm.declarationDelay` (the clock starts at the declaration; nobody reacts before the alarm) and `alarm.mode = 'voice'` (informative message: recognition × 0.6, response × 0.8; the magnitudes are assumptions, the direction is from Proulx & Sime 1991). |
| 11 | Exit decided before movement | done | `preassign`: a pre-show announcement or seat card gives every seat block its exit. 60% hear and remember it, and 70% of those follow it from t = 0, *before* Crowd Managers can reach them. It uses a separate random stream, so the audience is unchanged and A and B pre-assign exactly the same people. Guidance is the share of adopted instructions (CM, LED, pre-assignment) that point to an exit, which reproduces the old CM/LED rule when pre-assignment is off. |

## D. Row and aisle clearance

| # | Item | Status | Notes |
|---|---|---|---|
| 12 | Zipper merge at row ends | already present | Movement.ts already gives a +0.4 priority to the incoming link that was not served last (alternation). The diagnosis showed that the tail is not a merge-priority problem. The back access stairs OST_BW/BE (1.08 p/s each) received about 165 people with queues of up to 168, while the front access stairs received only 55. Fixed through plans (items 8, 16), not through merge rules. |
| 13 | Use the other end of a blocked row | already present | Seated agents choose the row end by the forward search, which includes visible gate queues. |
| 14 | Row metering by ushers | not implemented (by evidence) | Metering changes *who* waits, not the bottleneck capacity. Once the access-stair loads are balanced (item 16) there is no capacity left to gain. Recorded as an operational option, not as a model mechanism. |
| 15 | Overtaking in single-lane aisles | not implemented (by design) | 1.1 m aisles between seat ends do not allow passing in a queue. Multi-lane links already allow lane changes. |

## E. Route choice and plan design

| # | Item | Status | What changed |
|---|---|---|---|
| 16 | Optimised plan | tool + result | `scripts/optimise-plan.ts`: coordinate descent over the 44 blocks; each block can go to the exits on its own side. Every candidate is evaluated on the same 16 seeds (paired, so differences of about 1 s are meaningful). Seeds are separate from the evaluation seeds (out-of-sample check). Uses a persistent worker pool (`scripts/pool.ts`). |
| 17 | Dynamic Crowd Manager rebalancing | done | `crowdManagers.rebalance`: every 5 s an active Crowd Manager estimates the time to each exit group from the post (walking time plus the longest queue/capacity wait on the staff route). If the planned group is more than 20 s worse, the manager redirects and re-broadcasts. Implemented identically in A and B. |
| 18 | Route-choice weights | **cannot be coded** | They need choice data (drills or VR). Sensitivity: weakening the habit weight 2.8 → 0.8 saves 16 s [1, 32]. |
| 19 | Density next to time | done | The optimiser reports high-density exposure for each plan; the occupancy curve and the batch report show it. |

## F. Crowd Managers

| # | Item | Status | What changed |
|---|---|---|---|
| 20 | Posts at the bottleneck | done | `crowdManagers.posts`: choose which posts are staffed, in priority order (e.g. CM7 orchestra front, CM10 orchestra back). |
| 21 | Active tasks (redirect front rows) | done | Through block plans plus rebalancing. |
| 22 | Sources for radius, rate, compliance and activation | **cannot be coded** | Still assumptions (PARAMETERS.md). |

## G. Movement physics

| # | Item | Status | Notes |
|---|---|---|---|
| 23 | Up/down stair speeds | done (hook) | `population.stairRatioUp` (and the elderly value) is used on ascending stairs in Model A. The default equals the descending value, because no source was extracted; behaviour is unchanged until data is entered. Model B has no stair direction. |
| 24 | Groups meeting outside | done | `population.groupMeetOutside` (intervention: members leave when individually ready, choose their own exit, no cohesion) and `population.groupWaitMax` (was a hard-coded 90 s). Model B now has the same 90 s give-up rule as Model A; before, it waited forever. |
| 25 | Responders entering, counterflow | done | `stress.responders`: the listed doors lose capacity from a given time (A and B). Separated-group counterflow and falls already existed. |

## H. Models B and C

| # | Item | Status | What changed |
|---|---|---|---|
| 26 | Speed classes in C; wheelchair users | done | `individualBound`: max over persons of departure + row walk + the shortest effective length to an exterior door at the person's *own* speed and stair ratio (wheelchair users on accessible links only). No plan can beat it. Wheelchair users are now excluded from the flow and included in this bound. The reported bound is `max(T*_flow, T_ind)`. |
| 27 | Release schedule | done (as a budget) | `premovementBudget`: the largest factor α such that the ideal flow with departures α·t_depart still meets 180 s, found by bisection. |
| 28 | Equilibrium vs optimum | tool (not yet run: about 1 h of CPU) | `optimise-plan.ts --objective ue`: best-response dynamics between blocks (each block minimises its own mean exit time) vs `so` (minimise T_evac). |
| 29 | Counterflow in B | done | Both directions of an edge share its capacity in proportion to demand (queue + in transit). |

## I. Statistics and metrics

| # | Item | Status | What changed |
|---|---|---|---|
| 30 | P(T ≤ 180) as the main metric | done | Shown first in the batch output, the Monte Carlo page and the occupancy curve. With the run-to-run spread now about 12–13 s, P ≥ 95% needs a mean of about 160 s (mean + 1.65 sd ≤ 180). |
| 31 | Tail metrics | done | `p90Exit`, `p99Exit`, `insideAt180`, clearance per zone and level, `meanExitByBlock`, and a profile of the last 20 persons out (zones, elderly share, group share, start time, queue time). In RunResult, the CSV, the batch console and the Monte Carlo page (card "Who sets the evacuation time"). |
| 32 | Per-zone clearance | done | `clearanceByZone` / `clearanceByLevel`. |

## J. Calibration, scenarios and tooling

| # | Item | Status | What changed |
|---|---|---|---|
| 33 | Validation against drills | **cannot be coded** | No data. |
| 34 | T(N) curve and N_max | tool + result | `scripts/occupancy-curve.ts`: T(N), P(T ≤ 180) and the largest audience with P ≥ 95%, with the legal ceil(N/250) Crowd Managers at each level. |
| 35 | Convergence check, "last out" panel | done | `scripts/convergence-check.ts`; Monte Carlo page tail card. |
| 36 | Plans by block from the command line and UI | done | `--set crowdManagers.plan.ORCH_C_FRONT:W=PORTICO_W` works; the plan JSON can be loaded in the UI JSON section, and block entries are flagged in the plan editor. |

## Measurement checklist (items 6, 7, 22, 33)

1. Clear width of each orchestra access stair (OST_FW/MW/BW and mirrored) and its number of risers. These short flights are modelled as stairs (1.0 p/(s·m)). If they are 2–3 risers, a door-like flow (1.3–1.9) may be more appropriate, and that is worth up to about 20 s.
2. Clear widths of doors D1–D9, P1–P4, FC1–FC3, F1–F5 and the stage doors (now estimated from door-swing symbols).
3. Width of aisles AW/AE (now 1.1 m, one lane) and the seat count per row of ORCH_C_FRONT/BACK.
4. A drill or video of a concert exit: pre-movement distribution, Crowd Manager compliance, and the share of people using the foyer.

## Results: how close can we get to 180 s?

All runs: full house (1,329), concert emergency, **evaluation seeds base 777, 40 paired runs per
case** (the plan was optimised on separate seeds, base 9001). "Change" is the paired difference
from the improved baseline. Raw output: `results/requirements-180.json`,
`results/three-models-180.json`, `results/occupancy-*.json`, `results/plans/*.json`.

### 1. The corrected model (before any intervention)

| Step | Model A mean T_evac |
|---|---|
| Original model (morning of 2026-11-07) | 291 s |
| + dt fixes and the exterior door as the goal | 288 s |
| + aisle crowds visible, no forced U-turns | 272 s |
| + persistent taste, no re-entry (**improved baseline**) | **264 s** [260, 268] |

The improvements removed artefacts (route loops, random walks between exits, invisible aisle
jams). The spread across runs fell from sd 27 s to about 13 s.

### 2. Interventions and what the building would need (Model A)

| Case | Mean T [95% CI] | Best run | P(T ≤ 180) | Inside at 180 s | Change vs baseline |
|---|---|---|---|---|---|
| Improved baseline | 263.9 [259.8, 268.1] | 245 | 0% | 284 | — |
| Optimised seat-block plan | 248.8 [244.1, 253.5] | 228 | 0% | 254 | −15.1 [−18.8, −11.5] |
| + pre-assigned exits | 246.7 [241.8, 251.7] | 228 | 0% | 246 | −17.2 [−23.6, −10.7] |
| **180 s package** (plan + pre-assignment + voice alarm + meet outside + rebalancing) | **227.3** [223.3, 231.3] | 210 | 0% | 145 | **−36.6** [−42.4, −30.9] |
| package, everyone informed and compliant | 229.7 [226.7, 232.7] | 214 | 0% | 161 | −34.2 |
| package + fast start (recognition 3 s, response 7 s, CMs at 3 s) | 217.2 [215.3, 219.1] | 201 | 0% | 108 | −46.7 |
| package + stair flow 1.3 p/(s·m) | 222.3 [219.5, 225.1] | 207 | 0% | 136 | −41.6 |
| package + access stairs 1.6 m (hypothetical) | 223.0 [219.9, 226.1] | 206 | 0% | 137 | −40.9 |
| package + centre aisles 1.7 m / 3 lanes (hypothetical) | 223.2 [219.4, 226.9] | 199 | 0% | 131 | −40.7 |
| package + both geometry changes + fast start (hypothetical) | 214.3 [211.0, 217.5] | 197 | 0% | 84 | −49.6 |

The optimised plan (`src/data/plans/optimised-A.json`, used by all "package" cases) differs from
the zone plan in 11 of the 44 blocks:

- **Centre orchestra:** the front-row band of both centre zones (C_FRONT and C_BACK, each side)
  goes to its own side's portico instead of the foyer, leaving the back access stairs to the back
  rows. The east back band goes to the east stage exit.
- **Front sections:** the front-west back rows and the front-east front rows go to the porticos
  instead of the 1 m stage doors.
- **Upper levels:** the loge west-north front rows and the mezzanine east back rows go to the
  foyer; the loge west-north back rows go to the west stage exit; the balcony NE back rows go to
  the foyer.

Compliance matters for the plan itself: with *perfect* compliance the plan is slightly worse,
because it was optimised for partial compliance.

### 3. Three models

| | Baseline | 180 s package |
|---|---|---|
| A, detailed agent-based | 263.9 s, P(≤180) 0% | 227.3 s, 0% |
| B, network behavioural | 229.1 s, 0% | **195.3 s, 5% [1, 17]** (best run 175 s) |
| C, ideal flow: T*_imm / T*_pre / own-speed bound | 101 / 148 / 163 s | 101 / 125 / 143 s |
| C, pre-movement budget α | 1.32 | 1.64 |

Model C shows that **180 s is physically feasible**. With perfect coordination, the departures
could be 1.32× (baseline) or 1.64× (package) slower than sampled and still meet 180 s. The capacity
of the building (max flow 17.2 p/s, 7.4 p/s needed) is not the problem.

The losses come from behaviour and fine-scale movement:

- B − C (about 50–65 s) is the cost of decentralised route choice and queueing on the network.
- A − B (about 32–35 s) is the row → aisle → access-stair mechanics, which only Model A
  represents: single-lane flow per direction in the 1.1 m centre aisles, and front rows
  waiting for a gap in an aisle full of people heading to the back.

### 4. Largest audience that meets 180 s (P ≥ 95%, legal ceil(N/250) Crowd Managers)

| Strategy, model | Occupancy where P(T ≤ 180) ≥ 95% | N_max |
|---|---|---|
| Baseline, Model A | 40% (P = 100%), 50% (78%) | **561** |
| 180 s package, Model A | 60% (93%), 50% (100%) | **754** |
| 180 s package, Model B | 70% (95%), 80% (90%) | **930** |

Slope of T(N) above the knee: about 11–15 s per 100 extra persons (effective capacity 6.8–9.2 p/s).

### Conclusion

- **Full house within 180 s is not reached by any tested combination in Models A or B.** The best
  realistic package gives 227 s (A) and 195 s (B, with 5% of runs ≤ 180 s).
- The **operational package** is the most effective lever: −37 s in A, −34 s in B. Geometry
  changes add about 4–10 s each in A.
- The 180 s rule holds with ≥ 95% probability up to about **750 (A) to 930 (B) attendees** with the
  package, versus about 560 with today's plan.
- The data items in the checklist above (aisle and access-stair widths and risers, pre-movement,
  compliance) decide where between A and B the real hall lies. They should be measured before
  any number is used as a capacity limit.
