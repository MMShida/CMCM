# Two models of Bailey Hall evacuation: methodology report

This report covers the network-flow model added alongside the detailed agent-based simulator,
and the framework that compares them. Model A is specified in [MODEL.md](MODEL.md) and
parameter provenance is in [PARAMETERS.md](PARAMETERS.md). Generated numerical results are
in [COMPARISON_RESULTS.md](COMPARISON_RESULTS.md), and the feature audit is in [AUDIT.md](AUDIT.md).

There are three outcomes but only two simulation engines:

| | What it is | Code |
|---|---|---|
| **A** | Detailed agent-based simulation: spatial lanes, collisions and density, every seat row and aisle | `src/simulation/` |
| **B** | Network behavioural simulation: one agent per occupant, randomised psychology, capacity-constrained queues on a directed graph, no spatial collisions | `src/network/NetworkSimulation.ts` |
| **C** | Ideal optimised network flow: static max flow / min cut and the time-expanded quickest evacuation on B's graph. A mathematical benchmark, not a behavioural simulation | `src/network/StaticFlow.ts`, `TimeExpanded.ts` |

## 1. Why two models

The problem asks how long evacuation takes and whether cheap measures (barriers, LED strips)
help Crowd Managers. Two difficulties pull in opposite directions:

- **Physics.** Rows, aisles, the six access points, nine mezzanine doors, the corridor, foyer and
  stairs create capacity limits and spill-back. Model A represents these in detail. It is slow
  (about 1.5 s per run) and has many interacting rules, so it is hard to analyse.
- **Decisions.** People choose exits with partial knowledge, habit, imitation and guidance.
  The problem notes that individually rational choices can hurt the group, and that restricting
  choices can help. The natural way to quantify that is to compare simulated behaviour with the
  optimum on the same network.

Model B keeps Model A's people and decision rules but moves them on a graph. That makes it fast
(about 0.7 s per run), easy to analyse, and directly comparable with the optimum (C) computed on
**the same graph, capacities and departure times**. The B − C gap therefore isolates the cost of
decentralised decisions and queuing. A − B shows what the graph abstraction loses.

## 2. Building graph construction (`src/network/NetworkGraph.ts`)

The network is **derived automatically** from Model A's geometry JSON
(`src/data/geometry/bailey-hall.json`, reconstructed from the problem's plans). Both models
therefore share one topology, and every connection exists in the plans by construction.

1. **Feature links keep their identity.** Every door, access point, stair, exterior door and
   corridor-barrier slot becomes one network edge, whose id is the detailed link id. These are
   stable physical feature ids shared by A, B and C:
   - D1–D9: mezzanine doors
   - OST_*: the 6 orchestra access points
   - FC1–3: foyer connections
   - P1–P4: portico doors
   - F1–F5: exterior foyer doors
   - BSF*: balcony stair flights
   - BND*/BNST*: balcony north stairwells
   - SD*/SES*: stage escape routes
   - CO_* barrier slots W0–E2
2. **Seat rows become supplies.** Each guidance zone (20 zones) is a source node. It connects to
   every network node where one of its rows ends, with capacity (number of row ends) × J_row.
   A person's walk along the row to the row end (at the row speed) is part of their release time.
3. **Other walkable links are contracted** (aisles, cross-aisles, walkways, corridor, foyer,
   portico). Maximal chains through degree-2 nodes become one edge:
   - length = Σ lengths
   - capacity = min capacities
   - area = Σ areas
   - Chains longer than 8 m are subdivided to keep spatial resolution.
4. **The network ends at the 13 exterior doors**, the problem's definition of leaving the
   building: 5 foyer doors, 4 portico doors, 2 stage-escape exits and 2 balcony stairwells. The
   downstream node of each is a sink.
5. **Direction rules.** One-way exterior doors and descend-only storey stairs (as in A) define
   arc directions. The elevator is never part of the graph.

The result has 145 nodes (112 junctions, 20 sources, 13 sinks), 228 edges (51 physical features,
97 contracted chains, 80 row-exit edges) and 355 directed arcs. Every network node is a real
detailed node with the same id and coordinates. Every edge stores the detailed links it
represents and their polyline. `npx tsx scripts/network-info.ts --json results/network/network.json`
exports the full graph and mapping.

| Physical element (Model A) | Network element (Models B/C) |
|---|---|
| Seat row + seats | supply at the zone source; row-exit edge with capacity k·J_row; walking time along the row added to the release time |
| Aisle / corridor / foyer polyline chain | one edge (length sum, capacity min, storage from area); at most 8 m per edge |
| Door, access point, foyer connection | capacity-constrained edge with the same id and Model A's gate capacity |
| Staircase flight | edge with transit time at stair speed (slope length) and stair capacity, descend-only if storey height |
| Barrier slot | edge removed when a barrier is placed |
| Exterior door | edge into a sink (crossing it = left the building) |

### Shared physical assumptions (`src/shared/PhysicalModel.ts`)

Both engines read the same `SimConfig`:

```
gate (door, access point, stair entry)  C_e = q · w_eff · luggage · env      q = 1.3 (doors), 1.0 (stairs) p/(s·m)
                                        w_eff = w − 2b,  b = 0.15 m (doors), 0.09 m (stairs)
nominal urgency multiplier              g(u, 0) = 1 + 0.15 u                  (u = 0.6 → ×1.09)
walking lane                            J = v / (d_min + v T),  T = 0.7 s, d_min = 0.44 m, lanes = ⌊w/0.6 + 0.2⌋
seat-row end                            J_row = v_row / (d_min + v_row T),  v_row = 0.45 m/s   (0.58 p/s)
storage of node v                       S_v = ρ_max · ½ Σ_{e∋v} area_e,  ρ_max = 4.5 p/m²
```

The models necessarily differ in how they *use* these values. A computes per-lane headway
speeds, per-direction lanes and counterflow. B uses edge entry capacities, constant free speed
in transit and node storage. C uses the same as B, in discrete time.

## 3. Static maximum flow (Model C.1)

Let G = (V, E) with capacities c_e (persons/s), a super-source s* and a super-sink t*:

```
s* → every population source z         capacity +∞        (we ask for a RATE)
z  → row-end node n                     capacity k_{z,n} · J_row
x  → t* for every exterior-door sink x  capacity +∞

maximise F = Σ_e f(s*, ·)   s.t.  0 ≤ f_e ≤ c_e  (e ∈ E),   Σ_in f = Σ_out f  (v ≠ s*, t*)
```

It is solved with Dinic's algorithm (`src/network/MaxFlow.ts`), Ford–Fulkerson with augmentation
along shortest residual paths in blocking-flow phases. By max-flow = min-cut, the nodes reachable
from s* in the residual graph define a cut whose saturated edges are the **structural
bottleneck**. Each cut edge is a named physical feature.

**Rate versus time.** F* is the largest sustainable discharge *rate*. Population counts are
never used as capacities. The 180 s benchmark corresponds to an *average* rate of
1,329 / 180 = **7.38 persons/s**. F* ≥ 7.38 is necessary for meeting 180 s but far from
sufficient. A finite population needs at least T ≥ τ_min + N / F*, and in practice much longer,
because supplies are spatially uneven and must first reach the bottlenecks. That is what the
time-expanded model computes.

The same routine computes per-level flows (each level evacuating alone), the effect of closing
each feature (blocked exits), the effect of barriers, and the building-only bound (unlimited
row-end supply).

## 4. Time-expanded network flow (Model C.2)

Time step Δt (1 s by default), layers k = 0 … H:

```
nodes      (v, k)            for every network node v
movement   (u, k) → (v, k + τ_a)      capacity c_a(k) = ⌊c_a (k+1) Δt⌋ − ⌊c_a k Δt⌋
           τ_a = round( L_a / (v_rep · σ_a) / Δt ),  σ_a = stair ratio on stairs, 1 otherwise (τ_a = 0 allowed)
holdover   (v, k) → (v, k + 1)        capacity S_v (storage), +∞ at sources
supply     s* → (z, k)                capacity = #persons of zone z released in step k
sink       (x, k) → t*                capacity +∞ for exterior-door sinks x
```

The **cumulative-floor capacity** c_a(k) is the integer, deterministic accumulator. Over any K
consecutive steps it delivers between c_a K Δt − 1 and c_a K Δt + 1 persons (tested). Model B's
token buckets (burst 1) obey the same bound.

- **Quickest evacuation:** T* = min{H : maxflow(H) = N}.
- **Earliest-arrival curve:** A(H) = maxflow(H) for every H, the most people who can be outside
  by time H.

The network is grown one layer at a time and the existing flow is **augmented**, not recomputed.
Adding layer H only adds arcs, so the previous flow stays feasible. Flow on earlier sink arcs
never decreases (t* is never interior to an augmenting path). So one pass yields the whole
earliest-arrival curve, and the final flow attains A(H) at every H (Gale 1959; Minieka 1973). A
test checks this against a fresh max-flow at every horizon.

Release times define three benchmark variants for each seed:

| Variant | Release time of person i |
|---|---|
| C_imm, ideal immediate movement | row walk only (t_i = d_row / v_row) |
| C_pre, ideal routing with individual departures | + sampled intrinsic pre-movement t_rec + t_resp + t_prep (no social acceleration, no group waiting) |
| C_A / C_B, ideal routing with a model's realised departures | + the start times realised in Model A / Model B for the same seed |

These are idealised benchmarks: perfectly coordinated routing at the representative free speed
(1.2 m/s), with no behaviour beyond the release times. The 3 wheelchair users are part of the
single commodity (their accessible-route restriction is not represented in C). Rounding of
transit times changes shortest source-to-exit times by about 0.6 s on average (reported with
every result).

**Validation on small networks with known answers** (`tests/network-flow.test.ts`):

- CLRS max-flow example (23).
- Max flow = min-cut capacity on 40 random graphs.
- A single corridor gives T* = τ + ⌈N/c⌉ − 1.
- Two parallel routes give T* = 8.
- Release-time delays shift T* exactly.
- Closed edges carry no flow.
- The incremental earliest-arrival curve equals fresh computations.
- Discretisation bounds hold.

## 5. Human psychology and probabilistic decisions (Model B)

**Paired population.** For a seed, Model B calls the same `createPopulation(geo, cfg, seed)` as
Model A. Both models therefore simulate exactly the same people:

- seats
- behaviour types: shortest-time, habitual, social follower, queue avoider, cooperative, impatient
- free speeds (normal, truncated, older people 22% slower) and stair ratios
- lognormal phase durations t_rec, t_resp, t_prep, whose medians depend on aisle distance, exit
  distance, level and familiarity
- compliance uniforms for Crowd Managers and LEDs
- exit knowledge, groups and seated neighbourhoods

A test checks attribute equality. B's own dynamics use separate seeded streams (`net-route`,
`net-dyn`, `net-guidance`), so model-specific randomness stays separate.

**Pre-movement** uses the same state machine and parameters as A:

```
UNAWARE → AWARE → PREPARING → (WAITING for group) → moving
dc/dt = 1 + κ φ_i(t),   aware with hazard λ φ_i(t),   φ_i = share of seated neighbours standing/moving
```

A Crowd Manager's instruction makes an unaware person aware and multiplies the remaining
response time by 0.5.

**Exit choice** is a multinomial logit over the exit groups the agent knows, with Model A's
weights per behaviour type:

```
V_k = − w_time · C_k / 30 + w_fam · 1[k = foyer] + w_soc · s_k + 3 w_guid · G_k + w_inert · 1[k = current]
C_k = min over paths to group k of Σ_arcs ( L_a / v_i + (w_queue / w_time) · q_a / c_a · narrow_a · 1[a visible] )
P(k) ∝ exp(V_k)   (sampled with Gumbel noise)
```

- q_a / c_a is the visible queue delay at arcs within 15 m.
- narrow_a = 1 + 1.5 · max(0, (2 − w)/2) at doors.
- s_k is the share of moving agents within 5 m heading to k.
- G_k = 1 if the accepted Crowd Manager or LED instruction points to k (0.5 each if they conflict).

The behaviours map onto these terms as follows:

| Behaviour | How it is represented |
|---|---|
| Habit | the foyer bonus w_fam; habitual types weight it highest |
| Individual optimisation | the time term |
| Social following | the share s_k; followers may also learn an unknown exit when more than 30% of nearby people head there |
| Queue avoidance | the visible-queue cost, weighted by w_queue |
| Crowd Managers | same posts, count rule (ceil(N/250) or set), lognormal activation, 12 m voice radius and per-second hearing probability as A; compliance with probability 0.8 (fixed per agent); dynamic Crowd Managers redirect zones whose planned exit is cut off |
| LED strips | perceived with probability 0.9 when starting to move, followed with probability 0.7; conflicts with Crowd Managers add a 4 s hesitation |
| Blocked exits | learned by discovery (within 6 m of a closed edge, or on reaching it), from Crowd Managers (immediately, after an announcement delay, or never), and by word of mouth between people waiting at the same node (rate 0.2/s) |

People who know no usable exit follow what others around them do, notice signs, and after 10 s
find the nearest open exit with probability 0.2 per second. They are reported TRAPPED only if
nothing is reachable after 30 s.

**Groups** wait until every member is ready, adopt the leader's exit and move at the slowest
member's pace.

**Cooperation and impatience** enter through the type weights and through the gate capacity
modifier g(u, π) = (1 + 0.15u)(1 − 0.45 · max(0, (π − 0.35)/0.65)²), with π the urgency-weighted
mean impatience of the queue. This is the same faster-is-slower function as A.

There is no universal "panic": people are boundedly rational, with partial information.

## 6. Detailed versus simplified crowd movement

| | Model A (detailed) | Model B (network) |
|---|---|---|
| Space | polylines with lanes, positions along links, wall-validated | edges between real nodes, positions only for display |
| Rows | agents step along the row at 0.45 m/s and squeeze past seated people | walk time along the row, then the row-end capacity k · J_row |
| Speed | time-headway car-following v ≤ (h − d_min)/T per lane; counterflow lanes | constant individual free speed in transit (optional Weidmann slowdown, off by default) |
| Bottlenecks | token buckets at gates, lanes elsewhere | token bucket on every arc (entry capacity) |
| Spill-back | lanes fill and block upstream; occupancy ≤ 4.5 p/m² | node storage S_v; entry blocked when the head node is full (30 s relief prevents artificial deadlock) |
| Time step | 0.1 s | 0.25 s (each hop costs up to one step extra on average) |
| Run time | about 1.5 s | about 0.7 s |

**Discrete-time steps in Model B:**

1. Pre-movement.
2. Information and guidance (once per second).
3. Route revision (U-turns only on new information).
4. Arc service in fixed order: tokens += c · g · Δt (≤ 1); serve the FIFO head while a token
   remains and head storage allows.
5. Agents enter arcs with transit time L / (v_i · σ).
6. Advance transit.
7. Arrivals; crossing an exterior edge = left the building.
8. Statistics each second.

Runs stop when everyone is out or trapped, at t_max, or after 120 s without progress (flagged
as gridlock).

**Capacity versus speed.** An edge's entry capacity and its free-speed transit time are
independent in B and C. Capacity limits throughput while speed limits travel time; in reality
speed falls with density. In A this is the headway model. B and C use storage limits instead,
and B offers an optional density slowdown. This is the main physical difference between the
models.

## 7. Monte Carlo methodology

- **Seeds.** `batchSeeds(base, n)` gives deterministic, distinct seeds. Each replication is a pure
  function of (configuration, seed), so batches in workers equal sequential runs (tested).
- **Pairing.** For each seed, A and B simulate the identical audience and the same closure
  condition. Interventions reuse the same seeds, which gives common random numbers. Model C is
  recomputed for every topology and seed.
- **Statistics:**
  - mean, median, SD and 5th/95th percentiles
  - Student-t 95% confidence interval of the mean
  - P(T ≤ 180 s) with a Wilson interval; unfinished runs count as failures
  - mean queue time per person
  - largest queue and where it formed
  - exit usage
  - unresolved and trapped agents
  - paired differences with t-intervals
- **Execution.** Web Workers in the browser (`src/compare/ComparePool.ts`, dynamic load balancing)
  and worker threads on the command line (`npm run compare`). Per-cell results are cached.

**Metric definitions.**

- **Evacuation time T:** the last person crossing an exterior door. Wheelchair users count when
  they reach the assistance point, and are never counted as safe.
- **Queue time:**
  - Model A: time an agent was blocked (speed below 30% of desired).
  - Model B: time spent in arc queues, including waiting at the row-end capacity.
- **Largest queue:** persons waiting at one gate. In A this includes everyone blocked in the
  lane behind it; in B only those at the node, which is bounded by node storage.

The queue measures are therefore not directly comparable between models.

## 8. Validation and limitations

**Automated tests:** 74 in 7 files (`npm run test`).

- Model A (38 tests, unchanged): geometry, physical invariants, reproducibility, capacities,
  reporting, statistics and the flow bound.
- Model C (12 tests): small networks with known answers (section 4), and on Bailey Hall: max flow
  = min cut, closures only reduce flow, and T* ≥ N/F*.
- Model B (15 tests):
  - every official connection is exactly one network edge with the same id
  - nodes are real detailed nodes; chain lengths equal the sums of detailed lengths
  - every seat reaches a source and a row end; every source reaches an exit
  - descend-only stairs; identical paired population
  - population conserved; queues consistent; no double counting; moves only between adjacent arcs
  - capacity never exceeded in any 10 s window; discharge never above the static bound
  - no run faster than the ideal bound
  - reproducible seeds; closed exits and barriers never discharge
  - unfinished and trapped runs reported; guidance compliance changes choices
- Framework (9 tests): paired runs, ordering of benchmarks (later departures never evacuate
  faster), shared-clock synchronisation (both engines within one step of the clock, one snapshot
  per second), the width-sensitivity direction, paired statistics and report assembly.

**Feature audit by experiment.** `scripts/feature-probe.ts` switches each behavioural feature
low/high in both models on paired seeds and checks the response; see [AUDIT.md](AUDIT.md).

**Limitations:**

- The geometry comes from scans: about ±6% scale, with door and stair widths estimated
  (±0.3 m). The width sensitivity reports the implied band.
- Behaviour weights, reaction-time medians and compliance are not calibrated to Bailey Hall.
- B and C have no density-speed relation by default; B has no counterflow interaction.
  Directions of a corridor do not share capacity in B or C.
- C assumes perfect coordination and a single representative speed, and ignores the wheelchair
  users' route restriction.
- Model A's start time includes waiting for a gap to enter the row (seated in state WAITING), so
  C_A partly contains A's row congestion and A − C_A understates A's routing cost.
- Neither model shows that 180 s is met or missed in reality; the results are comparative.

## 9. Comparison methodology

The **cleanest comparison is B against C_B**: same graph, same capacities, same people, same
departure times. Their difference is the cost of decentralised, partially informed route choice
and queuing. It is the network analogue of the gap between a user equilibrium and the system
optimum (the "price of anarchy" the problem alludes to).

Further paired differences on common seeds:

| Difference | What it measures |
|---|---|
| C_pre − C_imm | cost of the sampled intrinsic pre-movement under ideal routing |
| C_B − C_pre | social influence, group waiting and Crowd Manager prompts on departures (negative means faster departures) |
| A − C_A | decentralised routing and detailed movement in A, given A's departures |
| **B − A** | **not a behavioural effect**: it mixes spatial representation (rows, lanes, counterflow), collision rules, queue implementation (storage vs. lanes), geometry simplification (contraction), time step (0.1 vs. 0.25 s) and speed model (headway vs. constant). It is reported as a model-structure difference |

**Interventions.** An intervention's effect is reported per model as a paired difference against
the same reference seeds, with 95% CIs. Model C's F*, minimum cut and T* are recomputed for the
changed topology (barriers remove edges, blocked exits close edges). A strategy is called better
only when the interval excludes zero, and only for the model in which it does.

**Attributing an improvement:**

- If C improves (F* or T* changes), the gain is **physical routing**: the topology or capacities
  changed.
- If C is unchanged but B (and A) improve, the gain comes from **guidance and behaviour**: better
  use of the same physical capacity.
- If the effect appears in only one of A and B, it depends on the **model structure** and should
  be treated as uncertain.

## 10. Which model is most useful for the competition questions

| Question | Most useful | Why |
|---|---|---|
| Q1 ordinary departure | A (cross-checked by B) | coats, habit and no guidance make detailed row and aisle congestion matter |
| Q2 emergency with Crowd Managers; unknown obstruction | A and B together, C as a bound | B gives fast Monte Carlo over obstruction knowledge; C shows how much capacity the obstruction removes; A checks spatial effects (merging at the corridor centre) |
| Q3 lecture | A and B | familiarity and drills change routing more than capacity; C is unchanged |
| Q4 barriers / LED | B for screening many placements, A to confirm, C to classify the gain | barriers change topology (C recomputed); LEDs change behaviour only (C unchanged), so the B − C_B gap is the target |
| Q5 cost-effectiveness | B (cheap sensitivity) + C | the value of extra Crowd Managers versus LEDs is a behavioural question; C caps the achievable gain |

The network-flow optimum is an **idealised benchmark**: no guidance strategy can beat it on the
modelled graph. The behavioural models capture some effects of decentralised decisions and
uncertainty, but not all. A result that both A and B agree on, and whose direction C explains, is
the most robust conclusion we can draw.

## Parameter table

**Status codes:**

- **BUILDING:** given by the problem or read from the plans.
- **PUBLISHED:** value from the research notes' literature, to be re-checked against the original
  source.
- **ASSUMPTION:** our choice, varied in the sensitivity analysis.

| Quantity | Value | Status | Used by |
|---|---|---|---|
| Seats orchestra / mezzanine-loge / balcony | 527 / 486 / 316 = 1,329 (incl. 3 wheelchair positions) | BUILDING (problem) | A, B, C |
| Evacuation benchmark | 180 s, from declaration until the last person leaves the building | BUILDING (problem) | all |
| Crowd Managers | ≥ 1 per 250 attendees (6 at full house) | BUILDING (problem, NY law) | A, B |
| Mezzanine doors / access points / foyer connections / portico doors / foyer exterior doors | 9 / 6 / 3 / 4 / 5 | BUILDING (problem + plans) | A, B, C |
| Balcony stairs (2 flights × 2 lanes each side), stage escape routes, balcony north stairwells | as on plans pp. 4–7 | BUILDING (plans); routes behind the stage are schematic | A, B, C |
| Door clear widths D / P / FC / F / stage | 1.6 / 1.6 / 1.8 / 1.8 / 1.0 m | ASSUMPTION (door swings on scans, ±0.3 m) | A, B, C |
| Access-point (OST) widths | 1.2 m | ASSUMPTION | A, B, C |
| Plan scale | 0.08 m per plan pixel (about ±6%) | ASSUMPTION (calibrated to stated areas) | geometry |
| Door specific flow q | 1.3 p/(s·m) | PUBLISHED (SFPE design value) | A, B, C |
| Stair specific flow | 1.0 p/(s·m) | ASSUMPTION (order of SFPE values) | A, B, C |
| Boundary layers | 0.15 m doors, 0.09 m stairs | ASSUMPTION (SFPE concept) | A, B, C |
| Row speed | 0.45 m/s | PUBLISHED (Predtechenskii & Milinskii) | A, B, C |
| Free speed | N(1.2, 0.25) m/s in [0.5, 2.0]; older people ×0.78; stair ratio 0.57 / 0.51 | ASSUMPTION / PUBLISHED | A, B; C uses 1.2 |
| Time headway T, d_min | 0.7 s, 0.44 m (lane capacity about 0.94 p/s) | ASSUMPTION | A; lane and row capacities in B, C |
| Maximum density ρ_max | 4.5 p/m² | ASSUMPTION | A (occupancy cap), B, C (storage) |
| Pre-movement | lognormal; recognition median 6 s, response 14 s (σ = 0.6) | PUBLISHED form / ASSUMPTION values | A, B, C_pre |
| Social influence κ, λ | 1.5, 0.4 /s | ASSUMPTION | A, B |
| Behaviour shares | shortest 0.2, habitual 0.35, follower 0.25, queue avoider 0.1, cooperative 0.05, impatient 0.05 | ASSUMPTION | A, B |
| Logit weights per type | `DEFAULT_WEIGHTS` in Params.ts | ASSUMPTION | A, B |
| Crowd Manager compliance / radius / activation | 0.8 / 12 m / lognormal median 10 s | ASSUMPTION | A, B |
| LED perception / compliance | 0.9 / 0.7 | PUBLISHED (order of values; not Bailey Hall) | A, B |
| Groups | 50% of people, sizes 2/3/4 with weights 0.7/0.2/0.1 | ASSUMPTION | A, B |
| Faster-is-slower g(u, π) | gain 0.15, drop 0.45, threshold 0.35, u = 0.6 | ASSUMPTION (direction from literature) | A, B; C uses g(u, 0) |
| Network segment length | ≤ 8 m | ASSUMPTION (modelling) | B, C |
| Model B time step / storage relief | 0.25 s / 30 s | ASSUMPTION (numerical) | B |
| Time-expanded step | 1 s (cumulative-floor capacities, rounded transit times) | ASSUMPTION (numerical) | C |

## Results and interpretation

Generated by `npm run compare` (seed 2026): 30 paired seeds for the baseline, interventions and
occupancy, and 15 for the sensitivity analysis. The full tables are in
[COMPARISON_RESULTS.md](COMPARISON_RESULTS.md). Effects relative to configuration 2 (Crowd
Managers only) are in `results/comparison/effects-vs-S1.txt` (`npx tsx scripts/effects-vs-s1.ts`).
All values are model outputs under the assumptions above.

### Baseline: concert emergency with 6 Crowd Managers

| | A detailed | B network | C ideal flow |
|---|---|---|---|
| Mean T [95% CI] | 299 s [290, 308] | 243 s [235, 251] | 101 s (everyone ready at 0); 176 s [161, 190] (sampled pre-movement) |
| P(T ≤ 180 s) | 0% [0, 11] | 0% [0, 11] | 100% (t = 0); 67% [49, 81] (pre-movement) |
| p95 individual exit | 224 s | 177 s | - |

- **The building can physically carry the flow.** F* = 17.2 p/s against the 7.38 p/s required on
  average. The minimum cut is the layer of portico doors, foyer connections, stage-escape doors and
  balcony north doors, not the exterior foyer doors. With perfect coordination everybody would be
  out in 101 s.
- **Paired decomposition (same seeds):**

  | Difference | Value | Reading |
  |---|---|---|
  | C_pre − C_imm | +75 s [60, 89] | the slowest intrinsic reaction times dominate the ideal time |
  | C_B − C_pre | −60 s [−75, −46] | social influence and Crowd Manager prompts make B's departures *faster* than the intrinsic draws |
  | B − C_B | +128 s [120, 136] | the cost of decentralised, partially informed exit choice and queuing on the same graph with the same departures: the largest single term |
  | A − C_A | +101 s [91, 110] | understated, because C_A contains A's row waiting |

- **The decentralisation cost has a visible cause: exit choice.**
  - The foyer: C sends 489 people through it, while A sends 740 and B 774.
  - The side porticos: C uses about 298 per side, A and B about 200.
  - The stage and balcony north exits are under-used in A and B (36–49 people each, against
    60–62 in C).

  Habit, imitation and the Crowd Manager plan concentrate people on the main entrance.
- **The models locate the worst queue differently.** In A it is the orchestra back access points
  (Access E3/W3, about 177 people), in B the balcony south stair doors (about 41 people). A's
  lanes let a queue fill an aisle; B's node storage spreads it back into the rows.
- **B − A = −56 s [−68, −44]** is a model-structure difference, not a behavioural one.
  - At 10% occupancy the models agree: B − A = −5 s [−19, 9], not significant.
  - The gap grows with crowding: −19 s at 50%, −37 s at 75%, −56 s at 100%.

  So the difference comes from how congestion is represented: rows, lanes, counterflow and
  headway in A, against capacity queues with constant free speed in B. It does not come from the
  shared behaviour rules. B is therefore an optimistic lower estimate of A under the same
  assumptions.

### Interventions (Q2–Q4), paired with the same 30 audiences

| Effect on mean T | A | B |
|---|---|---|
| Crowd Managers vs no guidance | −66 s [−82, −50] | −20 s [−31, −8] |
| LED strips, on top of Crowd Managers | −7 s [−19, +6] (not significant) | −10 s [−20, 0] (not significant) |
| Barriers W1/E1, on top of Crowd Managers | −10 s [−24, +6] (not significant) | −6 s [−16, +5] (not significant) |
| LED + barriers, on top of Crowd Managers | −8 s [−22, +6] (not significant) | −8 s [−17, +2] (not significant) |
| FC2 blocked, static guidance, vs Crowd Managers | −18 s [−30, −6] | +8 s [−3, +20] |
| Lecture vs concert without guidance | −15 s (not significant) | +17 s [5, 30] |

- **Crowd Managers** are the only intervention with a large, significant effect in both models.
  Model C is unchanged by them (F* and T* depend only on topology), so the gain is
  **guidance / behaviour**.
- **LED strips and barriers on top of Crowd Managers** do not significantly change the mean
  evacuation time in either model. They do shorten the tail:
  - p95 individual exit: −7 s [−10, −3] with barriers in A; −2 to −5 s in B.
  - Queue time per person: −2 s [−2.5, −1.5] with barriers in A.
- **Barriers change the physics, not the capacity.** C shows the minimum cut moving onto the
  mezzanine doors D1, D2, D8 and D9, with F* unchanged at 17.2 p/s. They redirect flows without
  removing usable capacity. LED strips leave C unchanged, as expected for a pure guidance measure.
- **The blocked exit (FC2) costs little in the ideal benchmark**: F* falls from 17.2 to 15.1 p/s
  and T*_imm from 101 to 102 s.
  - In A, blocking FC2 is even 18 s *faster* than the unblocked Crowd-Manager case (the
    Braess-like effect already noted in FINDINGS.md).
  - B does not reproduce this. It is slightly slower (+8 s, not significant) and has a much worse
    tail (p95 exit +36 s).

  By the attribution rule of section 9, the A-only speed-up depends on the model structure (merge
  handling at the corridor centre) and should not be used as an argument.
- **Lecture (Q3).** The ideal time with sampled pre-movement rises to 318 s, because students take
  longer to respond. The behavioural models are faster than that because of social acceleration:
  A 350 s, B 280 s. The two models disagree on the sign of the lecture versus concert difference.
  Pre-movement, not capacity, dominates this case (F* = 16.1 p/s with backpacks).

### Occupancy

| Occupancy | A: P(T ≤ 180 s) | B: P(T ≤ 180 s) | T*_imm |
|---|---|---|---|
| 10% (134 people) | 87% | 90% | 45 s |
| 25% | 83% | 93% | 48 s |
| 50% | 40% | 80% | 63 s |
| 75% | 0% | 13% | 81 s |
| 100% | 0% | 0% | 101 s |

The ideal time grows almost linearly with N (capacity-limited). The behavioural times grow faster,
because congestion amplifies the cost of choosing exits badly.

### Sensitivity (15 seeds per level; paired with the baseline)

- **Stair and access-point widths matter most in all three models.**
  - ×0.8: A +44 s [22, 66], B +15 s [0.3, 30], T* 101 → 126 s.
  - ×1.2: A −18 s [−35, −1], T* → 92 s.

  The orchestra access points and balcony stairs are the real limit for the behavioural models.
- **Exterior and mezzanine door widths change F* strongly** (12.8–20.5 p/s) and T* only at ×0.8
  (118 s). A barely responds (−6 / −4 s, not significant); B responds only to narrower doors
  (+20 s [6, 35]). Door specific flow behaves in the same way.
- **Reaction times, habit share, compliance, walking speed and Crowd Manager effectiveness** move
  A or B by up to about 20 s, but with 15 seeds none of these effects is significant: the
  last-person time is a noisy statistic.

  The width uncertainty of the scanned plans (±0.3 m) therefore translates into roughly ±20–45 s
  for A and ±15–20 s for B.

### What this means for the questions

- **Q2:** under the assumptions, a full-house emergency with Crowd Managers takes about 240–300 s
  in the behavioural models. The physical optimum is about 100 s. The 180 s target is
  capacity-feasible, but it is missed through exit choice and pre-movement.
- **Q4:** the measures that would close the gap must change *where* people go. A and B agree that
  barriers and LEDs, as configured here, add little to compliant Crowd Managers in mean time. They
  mainly reduce tail times and queuing (barriers). The B − C_B gap (128 s) is the room for
  improvement that a better zone → exit plan could target.
- **Q5:** on these numbers, money is better spent on what moves people from the foyer to the
  porticos, stage and balcony north exits early. The access points, if they could be widened,
  give the largest physical gain.
