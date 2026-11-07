# Mathematical model

This document specifies the model implemented in `src/simulation/`. Every equation below is
what the code computes; file references point to the implementation. Parameter values and
their provenance are listed in [PARAMETERS.md](PARAMETERS.md).

## 1. State and time

The system state at time t is the set of all agents (position on the network, speed,
behavioural state, knowledge, route) plus the gate token levels. The update
`x(t + Δt) = F(x(t), ξ_t)` with i.i.d. random inputs ξ_t is Markovian in the full state; a
Monte Carlo run samples one trajectory of this chain. Δt = 0.1 s. Two seeded random streams
are used: `population` (audience attributes, drawn once in a fixed order) and `dynamics` /
`routing` / `guidance` (runtime decisions), so interventions never change the audience
(common random numbers, see §8).

## 2. Building representation (`src/geometry/`)

A directed graph G = (V, E). Nodes are junctions (aisle/row ends, door sides, landings,
street destinations). Each link l ∈ E is a physically walkable channel with polyline
geometry, clear width w_l, walking length L_l (slope length for stairs), kind (row, aisle,
corridor, door, stair, ...), floor, and n_l = ⌊w_l / 0.6 + 0.2⌋ lanes. Agents only ever occupy
links, which were validated not to intersect any wall polyline (tests), so walking through a
wall or teleporting is impossible by construction. Exterior doors are one-way; the elevator
link is flagged prohibited and is never part of the navigable graph; storey-height stairs
(|drop| ≥ 2 m) may only be descended during evacuation.

Seat rows are links; a seat is a position s on its row link. Seat pitch is solved per level
so that the counts equal 527 / 486 / 316 (3 wheelchair positions on the mezzanine).

## 3. Pre-movement (`Population.ts`, `Behavior.ts`)

Each agent passes through UNAWARE → AWARE → PREPARING → WAITING → MOVING. Intrinsic phase
durations are lognormal:

- recognition τ_rec ~ LogNormal(ln m_rec, σ_rec), m_rec = m_rec,0 · (1.3 if dark) + Δ_alarm
- response τ_resp ~ LogNormal(ln m_i, σ_resp) with

  m_i = m_resp,0 · L_level · exp(β_aisle · min(d_aisle, 15) + β_exit · d_door / 10 − β_fam · 1[familiar])

  (d_aisle = distance from the seat to the nearest usable row end; d_door = distance to the
  nearest auditorium door; direction of both effects from Galea et al. 2017)
- preparation τ_prep ~ LogNormal(ln m_bel, σ_bel) with probability p_bel (belongings/coat),
  otherwise LogNormal(ln 1.5 s, 0.3) (standing up).

**Social influence.** φ_i(t) = (1/|N_i|) Σ_{j∈N_i} [1(j moving) + ½·1(j standing/preparing)],
where N_i are the seated neighbours within r_n = 2.5 m. The phase clock c_i runs at

  dc_i/dt = 1 + κ φ_i(t),

and the phase ends when c_i ≥ τ_phase, so φ ≡ 0 recovers the lognormal exactly. An unaware
agent additionally becomes aware with hazard λ_s φ_i(t). Being squeezed past in a row makes a
seated agent aware immediately and advances its clock.

**Crowd Manager instruction** (when heard): unaware → aware, and the remaining response time
is multiplied by c_CM: τ_resp ← c + (τ_resp − c) · c_CM.

**Groups.** Adjacent seats in a row form groups of 2–4 (start probability
p = f/(E[size](1 − f) + f) so the grouped fraction is ≈ f). A group leaves only when every
member is ready (timeout 90 s), adopts the leader's exit group, and while members are within
4 m the faster ones are capped at the slowest member's speed; members that fall more than
4 m behind make the leader slow to 0.3 m/s; a separation of more than 12 m breaks the group
(they continue independently). Stress test: one member starts in the foyer/corridor and walks
back to the group's row end (counterflow) before the group leaves.

## 4. Route choice (`Routing.ts`)

**Knowledge.** Each agent knows a subset K_i of the seven exit groups (foyer always; others
from prior probabilities, familiarity, exit signs noticed within 8 m with probability 0.38,
other people seen heading there, Crowd Manager and LED instructions) and a set B_i of links
it believes closed (discovered within 6 m, at the door itself, told by staff or by neighbours
within 2 m at rate 0.2/s).

**Forward search.** At each decision the agent runs Dijkstra from its own position over
links not in B_i with perceived link cost

  c_i(l) = τ_l · 1.2/v0_i + (w_Q/w_T) · q_l/C_l · (1 + b · max(0, (2 − w_l)/2)) + κ_cf · n_opp(l)/n_l

τ_l = nominal time (L/1.2 m/s walking, L/0.7 descending, L/0.6 ascending stairs, +1 s per
door). The queue term only counts if the gate is on the agent's floor within r_vis + 0.5 m·q_l
(the tail of a long queue is visible even if the door is not). Seat rows other than the
agent's own are not used as passages; routine re-plans may not U-turn onto the link just
walked.

**Exit-group choice (multinomial logit).** With T_ig = minimum search cost to any street
destination of group g:

  U_ig = −w_T T_ig/30 + w_F 1[g = foyer] + w_S S_ig + 3 w_G G_ig + w_I 1[g = current] + ε_ig,
  ε_ig ~ Gumbel(0,1)   ⇒   P(i → g) = exp(V_ig) / Σ_{h∈K_i} exp(V_ih)

- S_ig = (share of visible moving people within 5 m heading to g) · min(1, n/3)
- G_ig = 1 if i accepted guidance towards g (0.5 each if Crowd Manager and LED disagree)
- weights (w_T, w_Q, w_F, w_S, w_G, w_I) depend on the behaviour type (PARAMETERS.md)

The agent follows the shortest path of the chosen group. Re-evaluation happens at junctions
(probability by type), when information changes, and while waiting at a node; a new path is
adopted only if it is better by max(8 s, 15%) (route inertia). Agents with no known reachable
exit adopt the exits of the people they see; after 30 s without a route they step aside and
are reported as TRAPPED (never as evacuated). Wheelchair users route on accessible links to
the assistance point outside the main doors (AWAITING_ASSIST, not counted as safe).

## 5. Movement and congestion (`Movement.ts`, `Congestion.ts`)

Within a lane, agents are ordered; the follower's speed is

  v_des = v0_i · f_terrain · f_env · f_cf ,  f_terrain = stair ratio on stairs, row speed cap 0.45 m/s in rows
  v ≤ (h − d_min) / T_h ,   d_min = r_i + r_leader     (time-headway following model)
  v ← min(v_des_capped, v + (v_des − v) · Δt/τ),  s ← s + vΔt,  s ≤ s_leader − d_min

with opposing-flow friction f_cf = 1/(1 + c ρ_opp). This gives a lane capacity
J = v/(d_min + vT_h) ≈ 0.94 p/s at 1.2 m/s (≈ 1.5 p/(s·m)). (Weidmann's area-density law
v = v0(1 − exp(−γ(1/ρ − 1/ρ_max))) is available as an option; it under-predicts discharge from
dense queues, see PROGRESS.md.)

**Rows.** An agent steps into its row only if no one is within d_min in front of its seat and
no one is approaching within d_min + gap_yield behind it (gap_yield 0.9 m cooperative, 0.3 m
normal, 0.05 m impatient). Passing somebody who is still seated or collecting belongings is
only possible at 0.2 m/s. People closer to the aisle therefore leave earlier, and deeper
people are delayed by their neighbours: the row behaves as a small queue feeding the aisle.

**Transitions.** At the end of a link an agent is admitted to the next link only if
(1) the link is physically open (blocked exits and barriers refuse entry; the agent then
learns the closure and re-plans), (2) a gate token is available, (3) a lane has entry space,
and (4) the link holds fewer than ⌊4.5 p/m² · area⌋ people. Competing entrants at a node
are served in random order with a zipper bonus for alternating incoming links and a bonus
u·impatience. Under counterflow each direction keeps to its own half of the lanes; two people
facing each other at a node may swap ("squeeze past"); after 20 s blocked an agent may
squeeze into the lane with most room (prevents permanent gridlock; gates still apply).

**Gates and faster-is-slower** (`QueueSystem.ts`). Doors and stair entries are token buckets:
tokens grow at C(t) per second up to 1, each entry consumes one, so passes over any interval
of length T ≤ ∫C dt + 1. With effective width w_eff = w − 2b (doors, b = 0.15 m) or
w − 2b_s (stairs; per lane for stairs divided by a barrier, b_s = 0.09 m):

  C = q · w_eff · f_luggage · f_env · g(u, π),
  g(u, π) = (1 + a·u) · (1 − d · max(0, (π − θ)/(1 − θ))²),  π = u · mean impatience of the queue.

Moderate urgency raises flow ("faster-is-faster"); extreme urgency with a highly impatient
queue lowers it ("faster-is-slower"). The relation is a switchable hypothesis, tested in the
"competitive" stress scenario.

## 6. Guidance (`Guidance.ts`)

Crowd Manager c is active from t_c ~ LogNormal(10 s, 0.5) and every second reaches agents
within R = 12 m on its floor; an agent who has not yet heard the current message hears it with
probability 1 − e^{−h}. The message is the zone's planned exit (zone → exit plan), replaced by
the cheapest open exit if the staff know of a closure (dynamic mode). Compliance is a fixed
per-agent Bernoulli (u_i < p_CM). LED strips activate at t_LED; an agent perceives them when it
starts moving with probability p_see and complies with p_LED (base case 0.9 × 0.7 ≈ 0.63).
Contradictory LED/CM instructions cost a hesitation delay. Blocked-exit knowledge modes:
immediate (everyone at t = 0), announced (staff learn at t_a and broadcast), discovery only.

## 7. Metrics (`Metrics.ts`)

Per run: T_evac (last person leaves the building, the problem's definition; NaN if anyone
remains inside), T_evac,ambulatory, T_safe (last ambulatory person at street level),
individual exit-time mean/median/p95, start-time distribution, persons inside/left/safe/
moving/queuing per second, exit usage by group and door, per-gate max queue, mean and total
waiting time, max passes in one second, peak local density (2 m window, links ≥ 1.5 m) and
exposure (person-seconds above 3.5 p/m²), reroutes, unresolved agents (inside, awaiting
assistance, trapped) and gridlock.

## 8. Monte Carlo and comparison (`MonteCarlo.ts`)

R replications with seeds s_r derived from a base seed. For each metric:
mean T̄, s = sqrt(Σ(T_r − T̄)²/(R−1)), 95% CI T̄ ± t_{0.975,R−1} s/√R, median, p5/p95.
P(T ≤ 180 s) uses the Wilson 95% interval; unfinished runs count as failures and are
reported separately. Strategies A and B use the same seeds; paired differences
D_r = M_r^B − M_r^A give D̄ ± t s_D/√R (smaller variance than independent samples because the
audience is identical). A strategy that is faster but raises peak density / exposure is
flagged, and robustness is judged by the 95th percentile and the benchmark probability,
not by the best run.

## 9. Network-flow cross-check (`QueueModel.ts`)

Independent of the agent dynamics: the maximum flow F* from all row ends to the exterior
doors (or street) with link capacities (gates: C_l at u = 0; other links n_l · 0.94 p/s; row
ends 0.6 p/s; storey stairs downward only), computed with Dinic's algorithm. N/F* is a lower
bound on the flow time and the minimum cut names the structural bottleneck. Tests verify that
the simulated building outflow never exceeds F* (allowing the urgency gain) and that
T_evac > N/F*.

## 10. Known limitations

- Geometry reconstructed from scans (≈ ±6% scale; door/stair widths estimated; backstage stage
  escape routes schematic; the ground level and service areas ignored as instructed).
- No calibration to Bailey Hall data. Behavioural weights are qualitative; results should be
  read comparatively (A vs B under the same assumptions).
- 1D lane model: lateral 2D effects (arching, body contact forces, crush) are not represented;
  density above ~4.5 p/m² cannot occur by construction, so the density metrics are a proxy.
- Smoke, darkness, winter and falls are simplified stress tests, not validated mechanisms.
- Assisted evacuation of wheelchair users is not modelled (they are reported as awaiting
  assistance outside, or trapped if no accessible route exists).
