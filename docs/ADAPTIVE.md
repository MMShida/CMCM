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
- **How often.** Each (person, manager) pair has its own version counter, so a person can hear several managers. `adaptive.hearEvery = false` restores the previous model's rule (only the first manager met is heard until an instruction changes); it is an ablation switch used in §9.
- **Compliance.** `uCM < complianceProb × trust(t)`.
- **Trust changes.**
  - Confirmation by another manager: +0.05.
  - Contradiction: −0.125.
  - Queuing more than max(30, 2 × expected + 20) s on a route a manager recommended: −0.25, once per decision.

### Partial redirection by managers who see everything (`redirectMode = 'partial'`, Model A only)

This mode tests a project premise. From their posts the managers see the whole building, and they all know the same plan and the same state, so they agree. Instead of moving a whole planned exit, they redirect **part** of a flow: the end of the foyer queue goes to other exits as long as that is faster for those people. Model B keeps the zone rule. Code: `src/simulation/PartialRedirect.ts`, `GuidanceSystem.partialRedirect` and `setupResources`.

- **What the managers see:**
  - every queue, every person's position and heading, and the speed of the crowd on every link and direction (desired speed vs actual speed, with stairs included in the desired speed);
  - the people standing in queues;
  - the throughput of every door that has a queue.
- **Bottlenecks:**
  - every gate (doors, stair entries);
  - doors joining the same two rooms *and* within 6 m of each other form one pool (F1-F5, FC1-FC3, P1+P2, ...), while D1-D9 around the hall stay separate;
  - every narrow walkway (aisles, side passages, corridors up to 2.5 m wide), with capacity = width × `movement.doorFlow`.
  - On a door with a queue at two consecutive reviews, the measured throughput replaces the rating while the queue lasts.
- **Each person's own exit time** (what the managers predict):
  - every bottleneck is a first-come-first-served queue: d_i = max(a_i, d_{i-1}) + 1/c;
  - everybody's arrivals are chained through the queues (three passes), so people held back at an upstream door do not appear early at the doors behind it;
  - seated people arrive after their expected response time;
  - a person's exit time along a route is chained door by door; at the queues they are already in, they keep their place.
- **Rule (every 5 s):**
  - for each person within earshot who is already walking and has not been re-assigned yet (a group leader moves with the group), from the latest predicted exit down;
  - move them to the alternative with the earliest own exit if it is earlier than staying by more than `redirectMargin`;
  - then update the queues.
  - With one queued exit and an empty alternative this moves exactly n* = (Q_a/c_a − Δw)/(1/c_a + 1/c_b) (tested: 28 in the worked example).
- **Physical limits:**
  - no detour above `redirectMaxDetour` = 20 s;
  - no U-turn;
  - no route against an opposing stream or through standing people denser than `redirectCounterflow` = 0.5 p/m²;
  - no route that passes an outward-only door inwards.
- **Delivery:**
  - the instruction is personal and coordinated (not counted as a contradiction);
  - it is adopted only with compliance × trust and the person's own choice;
  - every manager then gives that person the same exit.
- The margin, the limits, the 6 m pooling distance and the walkway capacity are assumptions.

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

All 29 new tests pass; the whole suite is 124 tests.

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
  - a lead counts the people its following peers would move (and not when coordination is off);
  - partial redirection:
    - the balancing moves the analytical n* (28 in the worked example);
    - a person keeps their place in the queue (only the people at the back are moved);
    - non-compliers are not counted as moved;
    - chained arrivals leave no phantom queue behind an upstream door, and a shared bottleneck is not "relieved" by another exit behind it;
    - in the simulation nobody is redirected twice, every exit is valid, runs are reproducible and the default mode is unchanged.
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
11. **Explained, not a defect: corridor posts cannot speak to seated people through a wall.** In the decision-point layout, adaptive managers that never redirect (`place-decision-noredirect`) are as slow as the full adaptive layout, so the penalty is not the policy. Running fixed and adaptive delivery in lock-step (same seed, legacy hearing rule, unlimited reach through doors) shows the first difference at t = 7 s: a seated person 11 m from DP4 is instructed in the fixed model but not in the adaptive one. DP3 / DP4 (like BN4, HY5 / HY6, RB4 and BN1) stand in the corridor, behind the auditorium wall, while the nearest-centroid rule gives them orchestra seating zones. The previous voice rule passes through walls: in the fixed runs the corridor posts give 140-295 instructions per run through a wall (DP3 177, DP4 162, HY5 184, HY6 190, RB4 295, BN4 140; existing posts at most 53). With walls blocking the voice these people are not instructed while seated (longer pre-movement, habit = foyer). The fixed model therefore flatters layouts with corridor posts. Ablation (16 seeds, managers only): hearing only the first manager (`hearEvery = false`) instead of every one costs +12.7 s at the existing posts (266.9 vs 254.2 s; fixed 263.5 s) and +8.7 s at the decision posts (299.2 vs 290.5 s), so the measured benefit of adaptive managers at the existing posts comes from people re-evaluating their route each time they hear a manager, not from redirections (manager switches ~0 in Model A, see §9).

All the paired fixed-model results are unaffected, because they were reproduced exactly at every step. The results of the run before fixes 9-10 are kept in `results/adaptive/superseded-2026-11-07/` for traceability only.

---

## 9. Results

See §9 of the summary in [ADAPTIVE_RESULTS.md](ADAPTIVE_RESULTS.md) (generated) and the discussion below.

All figures: 40 paired seeds per configuration (same audiences everywhere), run on 2026-11-08 after fixes 9-10 of §8. "Δ" is the paired difference against the stated reference, with its 95 % CI; a CI that contains 0 means no detectable difference. T = time the last person leaves the building. P(T ≤ 180 s) is 0 % in every concert configuration of both models, so it is only discussed for the package. Full tables: [ADAPTIVE_RESULTS.md](ADAPTIVE_RESULTS.md).

### 9.1 Fixed vs dynamic individuals vs adaptive managers vs both

| Configuration | Model A T (s) | Δ vs fixed | Model B T (s) | Δ vs fixed |
|---|---|---|---|---|
| 1. Previous fixed model | 263.9 [259.8, 268.1] | – | 229.1 [224.2, 234.1] | – |
| 2. Dynamic individuals | 262.3 | −1.6 [−6.2, 2.9] | 219.8 | −9.4 [−15.9, −2.8] |
| 3. Adaptive managers | 253.1 | −10.8 [−15.2, −6.3] | 221.1 | −8.0 [−12.9, −3.0] |
| 4. Both | 255.7 | −8.2 [−11.8, −4.7] | 217.7 | −11.4 [−16.3, −6.6] |

- Adaptive managers shorten the evacuation by about 8-11 s in both models. Dynamic individuals help in Model B but not detectably in Model A. The two effects do not add up: "both" is no better than the better of the two alone.
- **The managers' gain does not come from redirections.** Managers change their instruction 0.0 times per run on average in these four configurations (both models). An ablation (16 seeds, managers only, existing posts) attributes the gain to how instructions are delivered. When every manager passed is heard, each hearing is an occasion to re-evaluate the route with the queues in sight: 254.2 s, against 266.9 s when only the first manager is heard (`hearEvery = false`) and 263.5 s with fixed managers. Also, 682 people comply with CM3 or CM4 in the adaptive mode against 188-256 in the fixed one, because they hear them again.
- The redirection rule rarely fires because it is all-or-nothing per planned exit and the moved flow is forecast conservatively (§3). Moving a whole zone's remaining people to a portico is almost never 20 s better. Partial redirection ("this aisle to the portico") is not modelled, and it is the obvious next step.
- Exit switches rise from 57 to 80 per run (A) and from 45 to 56 (B). Flip-flops stay below the 2 % test limit.

### 9.2 Placements

| Layout (six managers) | A, fixed model: Δ vs existing | A, both adaptive: Δ vs existing | B, fixed: Δ | B, both: Δ |
|---|---|---|---|---|
| Decision points | +2.1 [−2.9, 7.2] | **+30.4 [24.6, 36.1]** | −4.3 [−11.1, 2.5] | +2.4 [−2.0, 6.8] |
| Bottlenecks | +6.1 [0.9, 11.2] | +10.8 [6.1, 15.4] | +2.8 [−3.7, 9.3] | +3.6 [−1.2, 8.4] |
| Hybrid 2-2-2 | +5.7 [0.9, 10.5] | **+31.6 [26.2, 37.0]** | +6.2 [−1.7, 14.0] | +5.1 [−0.3, 10.5] |
| Robust | +12.0 [6.6, 17.3] | +17.1 [13.3, 21.0] | −3.1 [−7.9, 1.6] | +3.6 [−1.2, 8.3] |

- **No alternative layout beats the existing posts** in either model or mode. In Model A with adaptive managers, the decision-point and hybrid layouts are about 30 s slower.
- **The redirection policy is not the cause.** `place-decision-noredirect` (the same layout, never redirecting) gives exactly the same result in both models (Δ +0.0 s).
- **The cause is the wall (§8, item 11).** These layouts put two managers in the corridor behind the auditorium wall (DP3/DP4, HY5/HY6; BN1/BN4 and RB4 are corridor posts too), while the planning rule gives them orchestra seating zones. The previous voice rule passes through walls: in the fixed runs these posts give 140-295 instructions per run through a wall, against at most 53 for the existing posts. With walls blocking the voice, the side-orchestra people are not instructed while seated, which means a longer pre-movement and habit, i.e. the foyer.
- **Consequence:** the fixed model makes corridor posts look nearly as good as posts inside the hall. This one is a modelling result, not a statistical one. Managers must stand in the room whose occupants they are responsible for.
- Model B is much less sensitive (all CIs within about ±10 s), because its voice and route choice act on network edges.

### 9.3 Blocked exits

| Case | Model A | Model B |
|---|---|---|
| FC2 blocked (discovered on arrival), fixed → both adaptive | 269.9 → 262.4, Δ −7.5 [−10.9, −4.0] | 240.3 → 224.5, Δ −15.8 [−19.0, −12.7] |
| Foyer blocked (FC1-3, announced after 30 s) | T undefined in every run (see below) | T undefined in every run |
| … person-seconds above 2 p/m² (fixed / both / both, robust layout) | 58 867 / 70 212 / 62 454 | 19 526 / 38 119 / 35 491 |
| … mean individual exposure (p·s/m²) | 104.7 / 117.4 / 108.9 | 74.7 / 86.4 / 87.7 |
| … exit switches per run | 570 / 203 / 427 | 752 / 331 / 488 |

- A discovered closure is where adaptation helps most in Model B (−16 s). People who meet the closed door and managers who are told about it pass the information on.
- With the whole foyer closed, **T is undefined because the three wheelchair users are trapped in every run**. The only step-free route is through the foyer (state TRAPPED; checked on seed 777). This is a property of the scenario, not a gridlock. The generated tables reported "6 unresolved", which counted the same three people twice (`inside` already includes the trapped); that is fixed in `scripts/adaptive-experiments.ts`, and the recomputed values (unresolved 3, trapped 3 in all six blocked-foyer configurations) are in `results/adaptive/experiments-blocked-foyer-corrected.json`.
- With adaptive behaviour, far fewer people switch exits (570 → 203 in A). However, the time spent above 2 p/m² rises (+19 % in A, ×2 in B): people commit to the porticos and stage exits earlier and queue there, instead of spreading out by trial and error. The robust layout recovers part of this in Model A.

### 9.4 Information and communication (both adaptive; Δ vs both)

| Level | Model A Δ | Model B Δ |
|---|---|---|
| No queue information at all | +146.9 [141.5, 152.3] | +56.2 [51.9, 60.4] |
| Managers do not pass on congestion | +1.7 [−0.8, 4.3] | +1.5 [−3.1, 6.1] |
| No radio between managers | −0.7 [−2.7, 1.3] | +2.0 [−1.5, 5.5] |
| Idealised: every queue visible to everyone | −13.2 [−16.3, −10.1] | −3.4 [−7.7, 1.0] |

- **"No queue information" is a lower bound, not a realistic level.** It removes even the local queue perception that the previous fixed model has, so everyone follows habit and the plan. It shows that seeing queues is the strongest single mechanism in the model.
- Radio and congestion sharing make no detectable difference, which is consistent with §9.1: the managers hardly redirect, so what they would coordinate is rarely used.
- Perfect information is worth about 13 s in Model A, which is an upper bound for any information system (screens, apps) acting through exit choice alone.

### 9.5 Compliance (Δ both vs fixed at the same compliance)

| Compliance | A: fixed T | A: Δ both | B: fixed T | B: Δ both |
|---|---|---|---|---|
| 0.5 | 275.3 | −9.5 [−14.5, −4.5] | 224.0 | −1.8 [−5.9, 2.3] |
| 0.8 (default) | 263.9 | −8.2 [−11.8, −4.7] | 229.1 | −11.4 [−16.3, −6.6] |
| 0.95 | 258.3 | −3.0 [−7.5, 1.5] | 226.0 | −7.9 [−14.0, −1.9] |

In Model A higher compliance helps the fixed model, and the advantage of adaptation shrinks as compliance rises. In Model B the fixed model is not monotone in compliance (0.5 is faster than 0.8), so the plan itself is not optimal for Model B. These interactions are model dependent and should not be generalised.

### 9.6 The 180 s package

| | Model A | Model B |
|---|---|---|
| Package, fixed | 227.3 [223.3, 231.3], P(≤180) 0 % | 195.3 [191.3, 199.4], P(≤180) 5 % |
| Package, both adaptive | 239.8 [236.1, 243.4], P(≤180) 0 % | 185.1 [181.6, 188.6], P(≤180) **33 %** |
| Δ | **+12.5 [7.8, 17.2]** (worse in 83 % of seeds) | −10.3 [−15.2, −5.4] |

- The package's fixed variant uses the previous **omniscient** rebalancing: every manager knows every queue in the building and redirects every 5 s; it makes 12.9 changes per run in Model A. The adaptive mode replaces it with managers who know only what they see or hear by radio, and who change their instruction 3.9 times per run. The Model A loss is therefore the value of omniscience, not a defect of adaptation. Before fixes 9-10 the loss was +42.7 s.
- In Model B the adaptive package is the best configuration of this study: a third of the runs meet 180 s. The two models disagree on the sign, so whether adaptive managers help the package is uncertain.

### 9.7 Regional density and exposure

- The central orchestra aisles (AW/AE, 1.1 m) reach about 4.0 p/m² (region average) in every Model A configuration and stay above 2 p/m² for 125-138 s. Dynamic individuals shorten this time by about 12 s, while adaptive managers alone do not. In Model B the peak is 3.6-3.9 p/m² for about 90 s.
- The foyer region stays below 1 p/m² (A) and 0.4 p/m² (B). The foyer's problem is the door capacity, not the density in the foyer itself.
- Mean individual exposure (∫max(0, ρ − 2) dt) rises with both switches in Model A (18.0 → 21.7 p·s/m²; p95 67 → 83), while the total person-seconds above 2 p/m² is unchanged (22 785 → 22 373). More people take the side passages and porticos, so the exposure is spread over more people. In Model B exposure falls (19.5 → 16.2).
- These densities are analytical outputs of uncalibrated models. The 2 p/m² reference is not a validated safety threshold (§5).

### 9.8 Manager workload

- At the existing posts, CM3/CM4 (mezzanine radial aisles) have up to about 390 people within earshot and a workload index above 1 for 170-184 s per run (max W ≈ 5.7-5.9). CM5/CM6 (balcony) stay near 1.3. The index is an operational indicator with an assumed reference of 80 persons, not a validated measure.
- Contradictory instructions: 0 per run at the existing posts.

### 9.10 Partial redirection by managers who see everything (Model A only)

40 paired seeds; Δ against "both adaptive" with the usual zone rule (255.7 s) unless stated. Final results: `results/adaptive/experiments-partial-redirection-A.json`; the two earlier versions are kept in `results/adaptive/superseded-2026-11-08-partial/`.

| Estimator version | Margin | T (s) | Δ [95 % CI] | Worse in |
|---|---|---|---|---|
| v1: exit-level drain times (first version) | 5 / 15 / 30 s | 276.9 / 266.3 / 259.0 | +21.2 / +10.6 / +3.1 [−1.3, 7.4] | 93 / 83 / 59 % |
| v2: + crowd speed, pooled measured throughput (defective, see below) | 15 / 30 s | 286.7 / 283.1 | +31.0 / +27.4 | 90 / 93 % |
| **v3 (current): own exit time, chained FCFS queues, aisles as bottlenecks** | 15 / 30 s | 284.2 / 283.7 | **+28.5 [20.3, 36.8] / +28.0 [19.0, 37.0]** | 83 / 88 % |
| v3 with the previous (non-adaptive) individuals, vs adaptive managers (253.1 s) | 15 s | 265.8 | +12.7 [6.2, 19.2] | 73 % |

- **No version shortens the evacuation.** The best one is neutral (v1 with a 30 s margin). The more precise v3 is worse.
- **How v3 was checked:**
  - Every person moved was logged with the predicted and the actual exit time.
  - After the fixes, moves between the foyer and the porticos are predicted to within 7-18 s, and the people moved leave earlier than predicted for staying.
  - **Moves to the stage exits stay 35-100 s too optimistic.** Those decisions are made early (t ≈ 20-50 s), before the aisles fill. The congestion that forms when everybody else starts walking is not visible yet. The stage exits are small (≈ 1 p/s) and lie down the aisle, against the stream going up. Once 20-30 extra people are sent there, the stage exits finish last.
  - A diagnostic run without stage targets (5 seeds, not kept in the code) is neutral: 255.5 vs 254.7 s. There the managers even move people *from* the porticos *to* the foyer.
- **The v2 defects** were found by an independent review (44 agents, every finding checked by two skeptics); all were fixed in v3:
  1. D1-D9 were pooled as one 9-door bottleneck;
  2. throughput was measured on unsaturated pools;
  3. standing queues were ignored in the crowd speed;
  4. the clearing time of a whole resource was used instead of the person's own exit time;
  5. arrivals downstream of a queue were unchained;
  6. stairs were counted twice;
  7. routes passed outward-only doors inwards.
- **Why the premise does not deliver here:**
  1. The adaptive individuals already balance the exits by themselves: in 4 of 5 seeds the remaining imbalance comes from people who start late and walk through jammed aisles, not from a misallocation between exits.
  2. Seeing the present is not seeing the future: early decisions cannot see the jams that form a minute later.
  3. The only exits with spare capacity (stage) are small and lie against the main stream.
- **Consequence for the 180 s question:** as in 9.1-9.6, the gain has to come from capacity at the shared hall doors and aisles, a plan that assigns rows before people move (the optimised plan of the package), or a shorter pre-movement, not from redirecting people once they queue.

### 9.9 Unexpected outcomes and what explains them

1. Adaptive managers help without redirecting (§9.1): the cause is re-hearing and re-evaluation, shown by the `hearEvery` ablation.
2. Alternative layouts look fine in the fixed model but not with walls (§9.2): the cause is corridor posts behind walls, shown by the lock-step comparison and the through-wall counts.
3. The adaptive package is worse in Model A and better in Model B (§9.6): it is a trade between omniscient and local information, and the models disagree.
4. With the foyer blocked, adaptive behaviour cuts exit switching but increases high-density time (§9.3).
5. Managers who see everything and redirect part of the flow do not help (§9.10): adaptive individuals already re-balance the exits, early decisions cannot see the jams that form later, and the only spare exits (stage) are small and against the main stream.
6. The first 40-seed run showed the decision layout at +59 s, with oscillating managers. That was caused by defects (double counting, follower load), fixed and tested; the superseded results are kept in `results/adaptive/superseded-2026-11-07/`.

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
