# Dynamic behaviour, adaptive Crowd Managers and density over time

This document covers the implementation of 2026-11-07 (second round). It describes:
- what was static or dynamic before;
- what was added and the equations behind it;
- how responsibility, reach and influence of Crowd Managers are defined;
- how density is measured;
- how everything was tested;
- what the experiments show.

Generated result tables are in [ADAPTIVE_RESULTS.md](ADAPTIVE_RESULTS.md).

**Backward compatibility.** Two switches control everything:
- `adaptive.agents`: dynamic individuals;
- `adaptive.managers`: adaptive Crowd Managers.

Both default to `false`, which is the previous fixed-behaviour model. It reproduces the stored pre-change results exactly (`results/legacy-reference.json`, checked by `scripts/legacy-reference.ts` and by a test). The new density, Crowd Manager and behaviour bookkeeping is recorded in every run, but it never draws random numbers and never changes behaviour. The previous code is archived in `backup/pre-adaptive-2026-11-07.tar.gz`.

---

## 1. Audit of the previous implementation

| Mechanism | Before | Classification |
|---|---|---|
| Speeds, behaviour type, familiarity, group membership, compliance uniforms, exit taste | Drawn once per person | Static (randomised at initialisation) |
| Pre-movement (recognition, response, belongings) | Lognormal draws; clock sped up by moving neighbours and Crowd Manager instructions | Time-dependent; reactive to neighbours |
| Exit knowledge | Prior knowledge; signs noticed near nodes; seeing others; blocked exits learned on sight or by word of mouth | Reactive |
| Perceived congestion | Gate queues and aisle crowds within 15 m on the same floor, **seen through walls**; no memory (forgotten as soon as out of sight) | Reactive, local, but not physically consistent |
| Route choice | Logit over known exits at the start, at junctions (probability `reeval`), after waiting 6 s (random rate), and on new information | Reactive; re-evaluation mostly random, not triggered by expectations |
| Anti-oscillation | Inertia term; path inertia (keep path unless 15 % / 8 s better); no U-turn on routine decisions | Partly present |
| Crowd Manager reach | Straight-line distance ≤ 12 m on the same floor, **through walls** | Static geometry rule |
| Hearing several managers | A single version counter per **person**: someone who heard one manager never heard another manager at the same version | Implementation limitation |
| Crowd Manager instructions | Fixed zone → exit plan; optional rebalancing that read the **true queue at every gate in the building** | Static, or omniscient-reactive |
| Manager responsibility, workload, influence | Not tracked | Missing |
| Density | Peak local density, exposure above 3.5 p/m², time-averaged heat grid | Static summary; no time series by region |

**Diagnosis of the central congestion (`scripts/central-diag.ts`, baseline, seed 11):**
- **Who is in the centre aisles.** About 90 % of the people in the centre aisles (AW, AE) are heading to the main foyer. The reasons are:
  - the fixed plan assigns `ORCH_C_FRONT` and `ORCH_C_BACK` to the foyer, and Crowd Manager compliance is 0.8;
  - habit (familiarity weight of the habitual type);
  - group leaders.
- **Missed alternatives.** At 120 s, 26 of the 119 people in the centre aisles had an exit at least 20 s faster under true conditions.
- **Late imbalance.** At 150 s the portico queues are almost empty (5 and 2 people), while 54 people queue at the foyer doors.
- **No connectivity or accessibility error was found.** The lateral routes exist and are used.
- **Contributing implementation issues (fixed in the adaptive mode, see §2–4):**
  - perception and voice passed through walls;
  - there was no memory of congestion seen earlier;
  - re-evaluation was random rather than triggered by a wait that was longer than expected;
  - rebalancing managers were omniscient;
  - a person could not receive a second manager's instruction.

  None of these changes force anyone sideways: the share using lateral exits comes only from information, travel times and choice probabilities.

---

## 2. Dynamic individual behaviour (`adaptive.agents`)

### Stable characteristics

These are drawn once per person, reproducibly per seed. The new ones use a separate random stream (`traits`), so the audience is identical with and without adaptation.

| Characteristic | Representation |
|---|---|
| Familiarity with exits | `familiar` and the prior known-exit set (unchanged) |
| Baseline preference for familiar routes | Behaviour-type weight `wF` |
| Walking speed | `v0` (unchanged distributions) |
| Cooperation tendency | `coop` in [0, 1]: cooperative type ≈ 0.8, impatient type ≈ 0.25, others ≈ 0.5, sd 0.15 |
| Social influence susceptibility | `socialSus`, lognormal with mean 1 and sd `socialSusSd` = 0.3 |
| Baseline trust in Crowd Managers | Compliance uniform `uCM` compared with `complianceProb` (unchanged draw) |
| Mobility constraints | Elderly and wheelchair users (unchanged) |
| Group membership | Unchanged |

### Dynamic state

These are updated during the evacuation. Fields are in `Agent.ts`.

| State | Update |
|---|---|
| Awareness | Pre-movement state machine (unchanged) |
| Urgency `u` | Once per second: `u ← u + (u* − u)(1 − e^{−1/10})`, with `u* = min(1, b + 0.2·[instructed] + 0.3·[knows a closure] + 0.15·min(1, ρ/3) + 0.15·min(1, wait/60))`. `b` = 0.35 for a voice alarm, 0.2 for a tone. A Crowd Manager instruction raises `u` to at least 0.5 |
| Known exits | As before; also learned from instructions |
| Perceived congestion (beliefs) | `belief[g]` (s) with time stamp `beliefT[g]`, from own sight or from a Crowd Manager |
| Expected wait | `expDelay`: queue delay expected on the chosen route at the last decision |
| Waiting since the decision | `delaySince` (s queuing) |
| Confidence | `confidence[g]` (below) |
| Trust | `trust` relative to the baseline, in [0.2, 1.2] |
| Received guidance | `cmGroup`, `cmSource` (which manager), `cmTime` |
| Current destination | `targetGroup`; time of the last switch `lastSwitchT` |

### Information

People only use what they can see or are told:
- **Sight.**
  - A gate queue counts if the gate is on the person's floor, within the visibility range (15 m, plus 0.5 m per person queuing), **and** in the same room, or at a door of that room.
  - A room is a connected part of the building without crossing a door, so walls block the view.
  - An aisle crowd counts if it is within the visibility range in the same room.
- **Memory.** A belief decays as `e^{−age/τ}` with τ = `memoryTau` = 60 s.
- **Communication.** A Crowd Manager passes on the waits it knows on the route to each exit, with the age of that information. The person's own newer information wins. Blocked exits spread by word of mouth (unchanged).

### Utility and choice probability

One forward search per decision gives, for each known exit group g:
- the perceived route time `T̂_ig`, including visible queues weighted by `w_queue/w_time`;
- the queue delay actually seen on that route, `O_ig`.

If **the exit door of g is visible**, the observation replaces the belief: `B_ig = O_ig`, and the confidence is 1.

Otherwise the unseen part comes from memory or communication. The seen and the remembered delays are **not added**, so nothing is double-counted:

    T_ig = T̂_ig + max(0, B_ig e^{−age/τ} − O_ig),     c_ig = max(c0_g, e^{−age/τ})

with c0 = 0.8 for the main entrance or familiar people, and 0.5 otherwise.

The utility is

    U_i(g, t) = −wT (1 + k u_i) T_ig / 30 − wU (1 − c_ig) + wF (1 − k u_i) F_g + wS s_i S_ig(t)
                + 3 wG (0.75 + 0.5 coop_i) G_ig(t) + wI 1[g = current] − wI 1[g = exit abandoned < 30 s ago] + ε_ig

    P_i(g, t) = exp(U_i(g, t)) / Σ_k exp(U_i(k, t))      (ε_ig Gumbel, the person's persistent taste)

with k = `urgencyEffect` = 0.5 and wU = `uncertaintyWeight` = 0.5. `S_ig` is the share of visible neighbours heading to g. `G_ig` is the share of adopted instructions (manager, LED, pre-assignment) pointing to g.

### Event-triggered re-evaluation

These events are checked once per second for people walking or queuing:

| Event | Trigger |
|---|---|
| Wait longer than expected | Queuing since the decision for more than `max(waitExcessMin = 12 s, waitExcessFactor = 1.5 × expected)` |
| Visible queue worse than expected | Visible queue on the rest of the route exceeds expected + `max(queueSurpriseMin = 10 s, 50 %)` |
| A previously unknown closure | Discovered on approach, by word of mouth or from a manager. Unconditional re-plan (unchanged) |
| New Crowd Manager instruction | Re-evaluation that bypasses the commitment interval |
| New information about another route | Arrives with the instruction (beliefs) and enters the next evaluation |

### Anti-oscillation

- **Commitment.** A routine or event re-evaluation cannot change the exit group within `minCommit × (1 − u/2)` s (10 s at u = 0) of the last change. Closures, new instructions and the first choice are exempt.
- **Switching costs.** These come from the inertia term and from path inertia: keep the current path unless the new one is better by max(8 s, 15 %).
- **Hysteresis.** Returning within 30 s to the exit just abandoned costs the inertia penalty a second time.
- **Cooldown.** At most one event review per `eventCooldown` = 6 s.
- **Information delays.** Manager observations arrive 2 s late, and radio messages 3 s late.

### Physical validity

The physical rules are unchanged:
- routes only use links believed open (closed links are never entered);
- outward-only doors are never used inwards;
- evacuees do not climb a storey;
- wheelchair users use accessible links only;
- a U-turn is allowed only after a closure is learned or after more than 20 s stuck.

---

## 3. Adaptive Crowd Managers (`adaptive.managers`)

The code is in `ManagerPolicy.ts`, shared by Models A and B.

### Manager state

Each manager keeps:
- post: position, floor and nearest network node;
- formal responsibility (zones) and its planned exits;
- known waits by gate, with observation time;
- known closures;
- current instruction per planned exit (`redirect`) and time of the last change;
- instruction history;
- radio messages received (`leadInfo`);
- information version broadcast to the audience;
- workload and scope time series.

### Observation

- Every second, a manager reads the queues of the gates in its **observation set**: same floor, within 18 m, and same room or within 1.4 × 18 m on foot.
- Each reading becomes usable after 2 s.
- A closure inside the observation set is learned the same way.
- People in reach who know of a closure tell the manager, with probability 0.5 per second.
- Gates that no manager watches count as "no queue". Managers are **not** omniscient.

### Communication

- **Radio (`comm = 'radio'`).** Every observation, closure and decision goes to every other manager. Each message arrives with probability 0.9, after 3 s.
- **`comm = 'none'`.** Each manager works alone.

### Decision rule

A manager reviews every 5 s, or at once when a closure becomes known or a watched gate on a current route exceeds 30 s of waiting. For planned exit p with current instruction c:

    est_m(g | p) = Σ_k w_k · [walking time from post k to g + Σ known waits on that staff route] / Σ_k w_k
                 + p_comply · (persons of OTHER planned exits already sent to g) / capacity(g)
                 + p_comply · M_p / capacity(g)                                   for g ≠ c   (moved load)

- k runs over the manager and the peers that follow its decision for p (coordination); w_k = M_k,p + 1.
- M_p = Σ_k M_k,p, with M_k,p = max(persons in reach of k planned for p, persons in k's zones still inside planned for p). An instruction stays in force and is given to everyone who comes into earshot later, so the people it moves are the remaining flow, not only those in earshot at the moment of the decision. This forecast is conservative: some of the zone's people may already queue at p.
- The moved load is **not** added to the current destination c: the people already sent there are in its observed wait (adding them again double counted them and made every redirection look wrong right after it was made).
- Known waits are this manager's own (observed or received by radio).

- **Closed:** if c is known to be closed, switch to the best exit immediately.
- **Switch:** if c has been held at least `minHold` = 20 s, and est(c) − min est > `switchThreshold` = 20 s, switch to the best exit.
- **Return:** if held at least 20 s, c ≠ p and est(p) ≤ est(c), return to the plan.
- **Otherwise:** keep c. This is a hysteresis band: leave the plan when it is more than 20 s worse, return only when it is no worse.
- **No chained redirections:**
  - an exit the manager is sending its own planned people away from is not offered to others;
  - an exit currently receiving redirected people keeps its own people.

### Coordination

- **Peers** are managers whose voice areas overlap: same room and floor, posts at most 2 × voice radius apart.
- Among a manager and its peers there is one **lead** per planned exit: the lowest index among the active ones that plan it.
- The others apply the lead's last radio decision for every planned exit their peers manage. No message means "the plan".
- Non-peers decide for their own area, because a decision depends on where it is made, but they use all radio information.

Without radio, contradictions are possible. When a person receives one, it is counted, and it costs the person `conflictDelay` = 3 s of hesitation and half of `trustLoss`.

### Delivering instructions

- **Who can hear.** A person on the same floor within 12 m in a straight line **and** either:
  - in the same room, or
  - within 1.4 × 12 m on foot through a door.
- **How often.** Each (person, manager) pair has its own version counter, so a person can hear several managers.
- **Compliance.** `uCM < complianceProb × trust(t)`.
- **Trust changes.**
  - Confirmation by another manager: +0.05.
  - Contradiction: −0.125.
  - Queuing more than max(30, 2 × expected + 20) s on a route a manager recommended: −0.25, once per decision.

### Formal reassignment (`reassign = 'whenClear'`)

When a manager's formal area has been empty for 10 s, it takes co-responsibility for the zones of the nearest busy manager on the same floor. Off by default.

### Responsibility, reach and influence

Recorded every second for every manager, in both modes:

| Quantity | Definition |
|---|---|
| R_m(t) formal responsibility | Persons still inside whose seat zone is in m's zones |
| H_m(t) communication reach | Persons inside who can hear m now (adaptive rule above; the previous rule in the fixed mode) |
| I_m(t) influence | Persons inside who adopted m's instruction **last** (`cmSource = m`) and whose current exit choice equals it. Attribution rule: most recent adopted manager, so a person counts for at most one manager at a time |
| Unique reached, instructed, complied | Cumulative unique persons |
| Changed route | Persons whose exit choice changed to m's instruction right after hearing it |
| Conflicts | Contradictory instructions involving m |
| Critical bottlenecks | Watched gates with a current wait above 30 s |
| Local density | Highest link density in the observation area |
| Workload index | W = H/80 + 0.5 × critical gates + 0.5 × max(0, ρ_loc − ρ_ref)/ρ_ref. **Assumed indicator, not validated.** Overload means W > 1; time overloaded is accumulated |
| Heard through a wall | Instructions delivered under the previous straight-line rule that the adaptive rule would block (diagnostic of the previous model) |

---

## 4. Crowd Manager placements (`crowdManagers.placement`)

These are in `Placements.ts`. Every layout has six managers at fixed posts within 2.5 m of a junction of the navigation graph, never in a door leaf, stair flight or seat row. Zones are assigned to the nearest manager on the same floor, by seat centroid. That is a transparent rule, not an optimisation.

| Id | Layout |
|---|---|
| A `existing` | Geometry posts CM1–CM6 with their zones (baseline) |
| B `decision` | Orchestra front cross-aisle; mezzanine centre aisle above the orchestra; W and E corridor at P2/P3; balcony walkway junctions (north vs south stair) |
| C `bottleneck` | Corridor at FC1–FC3; tops of AW and AE; portico door P2; balcony stair doors BSDW and BSDE |
| D `hybrid222` | Two at the balcony staircase decision areas; two at the D4/D6 radial aisles; two at the W/E corridor junctions |
| E `robust` | Orchestra front, loge W, loge E, corridor south, balcony W, balcony E (one upstream of each exit group) |

Activation times are the same draws for the i-th manager in every layout, so comparisons are paired.

---

## 5. Density over time

### Regions

Regions are defined in `DensityRegions.ts`:
- 19 regions built from geometry links;
- every measured link belongs to **one** region, so nobody is counted twice;
- seat rows, the elevator and outdoor street links are excluded.

The requested regions:
- central orchestra aisles; side orchestra aisles; orchestra front cross-aisle;
- orchestra-to-mezzanine access steps; loge cross-aisles; mezzanine radial aisles; rear walkway;
- auditorium doors D1–D9 ("mezzanine exits");
- W, S and E corridor; foyer; main doorway approach; side porticos; stage escape routes;
- balcony aisles; balcony staircase entrances; balcony staircases; external staircases.

**Area** = Σ link length × clear width of the reconstructed geometry. The widths are estimates from the scanned plans (±0.3 m, ASSUMPTION), so areas carry about ±20–30 % uncertainty for narrow aisles. Regions with approximate links are flagged.

Model B maps its edges back onto the same links, so both models report identical regions and areas.

### Recorded every second

- occupancy N_A(t) and density ρ_A = N_A / Area(A);
- inflow and outflow:
  - Model A: exact boundary crossings;
  - Model B: counted when a person starts along an edge;
- mean speed;
- number queuing;
- capacity utilisation = outflow / nominal outflow capacity of the region boundary (gate capacities or lanes × 0.94 p/s);
- area and number of regions above ρ_ref;
- a per-link density frame for the heat map.

Summaries per region:
- peak density and when it occurred;
- peak occupancy;
- time-averaged density;
- seconds above each reference density (1, 2, 3, 4 p/m²);
- person-seconds in regions above ρ_ref.

### Individual exposure

    E_i = ∫ max(0, ρ(x_i, t) − ρ_ref) dt

ρ_ref = `analysis.densityRef` = 2 p/m². This is an analytical reference, **not** a safety threshold.
- Model A uses the local density (persons in the 2 m window ahead divided by 2 m × width) on links of at least 1.5 m.
- Model B uses the density of the edge the person is on, which is coarser.

Reported: mean, median, p90, p95, maximum, share exposed, and mean time above the reference.

**No density value here certifies that conditions are safe or unsafe.**

Actual density drives movement (headway, capacities, occupancy cap). Perceived congestion only drives decisions (§2), so congestion is not penalised twice.

---

## 6. User interface

- **Left panel → "Dynamic behaviour & adaptive Crowd Managers".** Switches, placement, information level, memory, commitment, event threshold, uncertainty aversion, radio, observation, hold, threshold, coordination, sharing congestion, reassignment, and the reference density.
- **Tab "Density over time".** Click *Run and record* (Model A or B, any seed). Then:
  - **A** the heat map updates live while the run advances;
  - **F** replay any second with the slider or *Play*; click a link to select its region;
  - region table at the replay time;
  - **B** density timeline of one region, plus occupancy, queue and outflow;
  - **C** up to six regions compared, plus the congested area over time;
  - **D** time above 1, 2, 3 or 4 p/m² per region;
  - **E** exposure histogram;
  - **G** Monte Carlo in Web Workers (Model A or B): peak-density box plots, a table with 95 % CIs and an exposure histogram;
  - **H** CSV and JSON exports (time series, region definitions with areas and links, summary, Monte Carlo).
- **Tab "Crowd Managers"** (uses the same recorded run).
  - Manager table: R, H, I maxima, reached, instructed, complied, changed route, instruction changes, conflicts, overload time, maximum W, reach through walls.
  - Charts of R, H and I and of workload per manager, and H for all managers.
  - Posts and voice rings on the heat map at any recorded second.
  - Instruction history with reasons.
  - CSV exports.
  - **"Compare the fixed and adaptive policies"**: runs the current configuration with the four combinations of the two switches on paired seeds and shows the paired difference against the fixed model.

The UI is checked by `scripts/ui-check-dynamics.mjs` (headless Chrome, no page errors).

---

## 7. Validation (automated tests, `tests/adaptive.test.ts`)

All 24 new tests pass; the whole suite is 119 tests.

- **Legacy:** both switches off reproduce the stored pre-change results exactly (A and B).
- **Information:** beliefs are learned with time stamps and confidence; no belief is from the future.
- **Congestion response:** when told that their exit has a long queue, over 90 % of people who cannot see that exit change their choice. People who can see the exit trust what they see.
- **Commitment:** it blocks a routine switch but not a new instruction.
- **No continuous switching (A and B):**
  - at most 6 exit switches per person;
  - A→B→A flips within 30 s for fewer than 2 % of people;
  - exit switches below 0.25 per person.
- **Blocked exit:** nobody enters the closed door, more than 20 people learn of it, and everyone leaves.
- **Invalid routes:** none. Closed links and inward use of outward-only doors never occur; every exit is through an exterior door; nobody is trapped.
- **Reproducibility:** the same seed gives identical adaptive runs (A and B).
- **Adaptation is not hard-wired to help:** a paired case where adaptive managers are slower than the fixed model (Model B, seed 12).
- **Policy unit tests:**
  - switch on observed congestion (at once for a critical bottleneck), hold for 20 s, return to the plan;
  - an unwatched queue changes nothing;
  - a non-lead peer follows the lead by radio, while a non-peer decides itself but receives the observations;
  - a closure is acted on at once;
  - no double counting: people already sent to the instructed exit are not added to its load again;
  - a lead counts the people its following peers would move (and not when coordination is off).
- **Scope:**
  - reach changes as people move (more than 10 enter and more than 10 leave a manager's reach between 25 s and 70 s);
  - walls block the voice;
  - multiple managers: a contradiction is counted for both, costs hesitation and trust, and the newer instruction is adopted;
  - R equals its definition; I matches its definition to within the change in one time step.
- **Placements:** six managers each, every zone assigned exactly once, posts within 3 m of a walkable junction.
- **Density:**
  - regions never overlap and areas equal Σ length × width;
  - density = occupancy / area;
  - occupancy summed over regions equals the people on measured links (no double counting);
  - occupancy is conserved: the change between samples equals inflow − outflow for every region and every second (Model A);
  - histories are recorded; Model B reports the same regions; same audience and posts in both models;
  - gate capacities still hold.

---

## 8. Experiments

`scripts/adaptive-experiments.ts --runs 40`:
- 40 paired seeds (777…) per configuration, Models A and B;
- output in `results/adaptive/experiments.json` and [ADAPTIVE_RESULTS.md](ADAPTIVE_RESULTS.md);
- nothing older is overwritten.

Configurations:
- the four policy combinations;
- four alternative placements, each with both adaptive and with the fixed model;
- blocked FC2 and blocked foyer, fixed vs adaptive, and robust placement with the foyer blocked;
- information levels: none, no congestion sharing, no radio, idealised global;
- compliance 0.5 and 0.95, fixed vs adaptive;
- the 180 s package, fixed vs adaptive.

Statistics:
- mean evacuation time with a t-based 95 % CI;
- 95th percentile across runs;
- P(T ≤ 180 s) with a Wilson interval;
- paired difference against the reference configuration on the same audiences, with its CI and the share of seeds where the configuration was slower;
- regional peaks and time above 2 p/m²; person-seconds above 2 p/m²;
- individual exposure; exit utilisation; exit switches; manager switches; share following a manager;
- manager workload; unresolved occupants.

The results and their interpretation are in §9.

### Defects found by these experiments and fixed before the final run

The first experiment runs showed implausible results, which were traced to defects, not tuned away:
1. **A coordination lead decided for the whole building.**
   - A manager at the orchestra front sent balcony people to the stage exit, through the radio "follow the lead" rule (decision layout +108 s).
   - Coordination is now limited to peers whose voices overlap.
2. **Managers ignored the load they themselves would create.** They sent around 300 people to a 1 m stage exit; the own-load term was added.
3. **Non-lead managers decided alone** when the lead had not broadcast, i.e. when the lead had kept the plan. They now defer to the lead.
4. **Managers instructed people planned for exits outside their own zones** without the room's decision. Peers now apply the lead decisions for all planned exits.
5. **The hysteresis band was too narrow** (return to the plan even when 10 s worse). It now returns only when the plan is no worse.
6. **Oscillating balcony managers.** The announced load counted the manager's own redirected people against the destination being evaluated, and chained redirects were possible.
7. **Beliefs were overwritten by any visible gate** (e.g. the nearby D door), so information about the unseen foyer doors was ignored. Only a visible exit door now replaces a belief, and seen and remembered delays are combined by maximum.
8. **Queue visibility and voice passed through walls.** They are now room-based in the adaptive mode.
9. **Double counting at the redirect target (found in the first 40-seed run, decision layout +59 s).** After a redirect the people already queuing at the new destination were counted both in its observed wait and as load still to come, so the next review reversed the decision ("FOYER better by 139 s" 20 s after "STAGE_W better by 23 s"); 33-43 A→B→A flips per run. The moved load is no longer added to the current destination.
10. **A lead ignored the people its followers move.** The front manager decided for the room using its own earshot only, while the back manager applied the same decision to about 500 more people. The lead now counts its followers' people, forecasts the remaining flow (see Decision rule), and evaluates the routes from every member's post (a portico route from the back runs through the mid-side access doors, which built queues of about 100).
11. **Remaining, not explained by a defect:** in the decision-point layout, adaptive managers that never redirect (`place-decision-noredirect`) are still slower than fixed managers in the same posts (8 seeds: about +20 s). Ablations (no radio, unlimited voice through doors, no conflict delay, no trust gain, no congestion sharing) did not isolate a single mechanism at 8 seeds. The difference between the two voice rules is that every manager is heard (fixed: only the first one met), and each hearing is an occasion to re-plan; at central posts more people are kept on the default plan, which loads the foyer (foyer use 844 vs 788). See §9.

All the paired fixed-model results are unaffected, because they were reproduced exactly at every step. The results of the run before fixes 9-10 are kept in `results/adaptive/superseded-2026-11-07/` for traceability only.

---

## 9. Results

See §9 of the summary in [ADAPTIVE_RESULTS.md](ADAPTIVE_RESULTS.md) (generated) and the discussion below.

<!-- RESULTS-DISCUSSION -->

---

## 10. Model comparability

| Mechanism | Model A | Model B | Model C |
|---|---|---|---|
| Stable traits, beliefs, confidence, urgency, trust, commitment | Yes | Yes (same code paths) | No: no psychology |
| Events: wait longer than expected, visible queue worse | Walking or queuing on links | Only while queuing at a node (a person in transit on an edge cannot turn) | — |
| Room-based visibility and voice | Navigation graph rooms | Network rooms (edges without doors) | — |
| Manager policy | `ManagerPolicy.ts` | Same code; gates = arcs of gate edges | — |
| Density regions and areas | Links | Edges mapped back to the same links (identical areas) | — |
| Individual exposure | Local 2 m window density | Edge density (coarser) | — |
| Flows across regions | Exact crossings | Counted at the start of an edge | — |

Model C remains an optimised flow benchmark with no behaviour. The same physical capacities and the same audiences (seed for seed) are used in all comparisons.

---

## 11. Remaining limitations and uncalibrated parameters

All new magnitudes are **assumptions**; the mechanisms come from the literature, the numbers do not. They are listed in `PARAMETERS.md` §9 and `PARAM_INFO`:
- memory 60 s, uncertainty weight 0.5, commitment 10 s;
- event thresholds 1.5× / 12 s / 10 s, urgency effect 0.5;
- trust changes, conflict delay;
- reach factor 1.4, observation range 18 m and delay 2 s;
- radio reliability 0.9 and delay 3 s;
- decision interval 5 s, hold 20 s, switch threshold 20 s, critical wait 30 s;
- workload reference 80 persons;
- reference density 2 p/m².

None is calibrated to Bailey Hall drills.

Further limitations:
- **Rooms** are graph components without doors, a geometric proxy for line of sight and acoustics. Open doors are assumed transparent; balconies and the orchestra are separate floors.
- **The influence attribution rule** (most recent adopted manager) is one of several defensible rules. An effect cannot be split between managers who said the same thing.
- **The workload index** is an operational indicator with an assumed form.
- **Region densities** are averages over regions of 4–60 m². The heat map shows link averages; local peaks are higher. Areas inherit the width uncertainty of the geometry.
- **Model B event review** only happens in queues, and its exposure uses edge densities, so absolute exposure values are not comparable between models (relative comparisons within a model are).
- **Physical relocation** of managers is not modelled (fixed posts, as requested).
