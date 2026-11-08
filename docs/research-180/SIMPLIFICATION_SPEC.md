# A-Lite: specification and evidence audit

This continuation introduces a separate spatial queue engine. `SimulationEngine` still runs the original A when optional corrections and structural switches are absent. `LiteSimulation` supplies `LiteMovement` through a movement factory; it does not call, subclass or copy `NetworkSimulation`. The shared population, geometry, routing and guidance remain explicit dependencies.

## Movement mechanisms: evidence and simplification

| Mechanism | Classification and calibration | A-Lite treatment; information lost |
|---|---|---|
| 1,329 audience, three wheelchairs, three seating levels | Bailey-specific problem specification | Retain all people and sampled traits; no occupancy reduction |
| 268 nodes, 384 links, widths, slopes, exit connectivity | Bailey-specific reconstruction; many dimensions approximate | Retain every original link and distance; no contraction or new path |
| Accessibility, one-way links, closures | Bailey-specific requirements represented by graph attributes | Retain restrictions and discovery; a graph check does not establish installation compliance |
| Following gap and H=0.7 s | Empirically supported mechanism; generic coefficient [R4,R19] | Replace microscopic speed adjustment by the same representative rate J=v/(d+vH); lose individual gap trajectories |
| Acceleration relaxation, tau=0.5 s | Generic assumption, not calibrated to Bailey | Constant transit speed; no startup acceleration or braking waveform. Tested separately in A |
| Row cap 0.45, squeeze 0.20 m/s, 0.38 m obstruction lookahead | Literature supports row constraints; squeeze speed and detection distance generic [R18] | Seat-to-end distance / capped speed plus finite row storage and end service; lose seated obstruction and passing awareness cues |
| Random zipper priority, impatience bonus, lateral gap checks | Generic implementation of merging | FIFO among ready lane heads, shared downstream storage; lose body-level merge negotiation |
| Counterflow friction, lane changes, timed squeeze relief | Opposing-flow effects supported; exact rules generic | Directional capacity sharing and conservative slot exchanges; lose friction waves, body contacts and spontaneous lane formation |

## Behavioral mechanisms: evidence and simplification

| Mechanism | Classification and calibration | Decision and loss |
|---|---|---|
| Heterogeneous free speed, elderly mix and body size | Empirically supported heterogeneity; Bailey values assumed | Retain sampled attributes; radius affects reference capacity and exchange feasibility, not collision simulation |
| Lognormal recognition, response, preparation | Empirically supported distribution family; local parameters generic [R5] | Retain draws and state transitions. Their computational cost is small; removing them would change the problem |
| Neighbor awareness and phase-clock acceleration | Social response supported; exact coefficients generic | Retain for comparability; row passing no longer supplies an extra awareness cue |
| Group readiness, common destination and pace | Empirically supported effects; waiting/cohesion thresholds generic [R13,R14] | Retain readiness/90 s timeout, leader destination, slowest member's free pace; remove spatial lag stops and distance-triggered breakup |
| Persistent Gumbel tastes and familiar-exit preference | Empirically supported discrete-choice family [R3]; weights uncalibrated | Retain stable preferences, imperfect guidance acceptance and locally visible queues; no perfect shortest-path obedience |
| Urgency, trust, belief decay, event cooldown | Generic hypotheses; potentially unnecessary without calibration | Compare with existing on/off switch. Prefer the simpler state when performance and robustness support it |
| Route commitment and occasional reconsideration | Route revision observed, but exact thresholds generic [R7] | Retain existing routing for controlled movement comparisons; invalidate exhausted paths before inertia is applied |
| Manager hearing, activation and radio | Empirical mechanisms; Bailey hearing/reach values assumed | Retain imperfect hearing and activation, actual post coordinates and acoustic approximation; staff bodies are still absent |
| LEDs and pre-announcement | Supported interventions; separate detection and acceptance probabilities assumed [R8,R9] | Prefer fixed, visibility-limited public signs; retain incomplete adoption. No brightness or head-occlusion calibration |
| Adaptive staff/partial FCFS controller | Research-supported optimization family [R10]; global information in partial mode is a strong assumption | Compare static and zone control; partial forecasts tested in A, not asserted equivalent in Lite |
| Storage and service credit | Conservation is essential; 4.5 persons/m² and minimum link slots generic | Count every person in each original link, including transit and waiting. No 30 s capacity bypass |
| Falls, contact pressure, smoke tenability | Stress approximations or absent mechanisms | A-Lite rejects falls and separated-group stress; it is not an injury, fire or rescue simulator |

## Spatial queues and travel

For link e, let L be walking length, w width, l lane count and g the drawing-length/walking-length ratio. A-Lite retains A's lane count and all original graph nodes. Each directed lane has a FIFO queue. At entry, choose the least occupied available lane; opposing traffic uses A's allowed-lane count. Different lanes can proceed concurrently. Within a passage lane, a later entrant cannot leave before an earlier one. Row occupants join their selected row-end queue in predicted arrival order because their origins differ along the row.

$$
\begin{aligned}
v_{i,e}&=\min\!\left(v_i,\min_{j\in\operatorname{group}(i)}v_j\right)f_{\mathrm{env}}f_{\mathrm{stair}} \\
v_{i,\mathrm{row}}&=\min(v_{i,e},v_{\mathrm{row}}) \\
a_{i,e}&=\operatorname{entry}_{i,e}+\frac{L_e-s_{i,\mathrm{entry}}}{v_{i,e}}
\end{aligned}
\tag{L1}
$$

The group minimum is omitted for ungrouped people or the separately configured meet-outside scenario. Stair ascent/descent ratios and the outdoor factor remain individual. Nonzero response precedes entry. A-Lite does not apply A's extra spatial cohesion stop or break groups according to Euclidean separation. This is a structural simplification, not unchanged group mechanics.

An agent travels by a clock until a_i,e, then waits for service and downstream storage. Interpolated coordinates place it on its actual link for signs, staff reach and regional occupancy. Queue positions are drawn back along their lane. These coordinates do not establish collision-free body packing or accurate sub-link density.

$$
\begin{aligned}
J_e&=\frac{l_ev_{\mathrm{rep},e}}{2r_{\mathrm{mean}}+v_{\mathrm{rep},e}H} \\
S_e&=\max\!\left(l_e,\lfloor\rho_{\max}L_eg_ew_e\rfloor\right),\quad
S_{\mathrm{row}}=\max\!\left(1,\left\lfloor\frac{L_{\mathrm{row}}}{2r_{\mathrm{mean}}}\right\rfloor\right)
\end{aligned}
\tag{L2}
$$

The representative rate uses the inherited 1.2 m/s, H=0.7 s and mean radius 0.22 m; stairs use the inherited representative stair ratio. Actual travel still uses individual speeds. Door and stair entries also require their unchanged gate capacity C from the main guide. Multiple limits can bind, but no nominal physical rate is multiplied upward. Minimum lane slots mean S is not everywhere exactly floor(ρA), particularly on very short links.

## Service, counterflow and conservation

With N_e,+ and N_e,− people currently occupying a passage, divide its service between directions by their demand shares. Empty passages accumulate no new discharge credit. Each row end is a separate service resource: people leaving opposite ends generally drain different row portions, so row-end capacities are not halved simply because both ends are used.

$$
\begin{aligned}
\alpha_{e,d}&=\frac{N_{e,d}}{N_{e,+}+N_{e,-}}, & C_{e,d}&=\alpha_{e,d}J_e \\
b^*_{e,d}&=b_{e,d}+C_{e,d}\Delta t, & n_{e,d}&\le\lfloor b^*_{e,d}\rfloor \\
b'_{e,d}&=\min(1,b^*_{e,d}-n_{e,d})
\end{aligned}
\tag{L3}
$$

One initial person of credit is allowed per direction. Hence cumulative passage discharges in both directions cannot exceed the integrated shared rate plus two initial persons. Idle credit is bounded after admissions; no long idle period earns a burst. The same inherited gate token account enforces exterior and stair admission, with conservative service integration enabled.

$$
\begin{aligned}
N'_e&=N_e+\operatorname{admissions}_e-\operatorname{departures}_e,\quad0\le N'_e\le S_e \\
\text{admit }i\text{ to }e&\text{ only if open, accessible to }i\text{, and }N_e<S_e
\end{aligned}
\tag{L4}
$$

A reversal on the same link does not add occupancy. Two opposing queue heads may exchange slots at their common junction only when both have completed travel, both have discharge credit, any gate credits are available, and the two body diameters fit the narrower link. Remove both before adding either. Counts and service are conserved; this is not a permission to overfill storage after waiting. Unresolved queues remain failures. The rule represents passing in an aggregate queue model, not proven collision-free trajectories.

Finite-storage pedestrian networks are supported as a modelling family by Guo, Huang and Wong (2011) [L-R1]. Restricted queues can produce representational deadlocks, including ones that swapping customers resolves, as discussed by Palmer, Harper and Knight (2018) [L-R2]. Neither paper calibrates this particular Bailey hybrid or its exchange rule.

## Response, route choice and visibility

The original population's lognormal recognition/response/preparation draws, local social clocks and readiness waiting remain. The primary endpoint is still the last of all 1,329 people crossing an exterior boundary; assisted travel to street level is reported separately. Leaving a door and reaching the street are distinct route stages. An exhausted indoor route must be invalidated before selecting its continuation, otherwise a zero-length old path can defeat the route-inertia threshold.

$$
\begin{aligned}
c_{i,e}&=\operatorname{walk}_{i,e}+\operatorname{visibleQueueCost}_{i,e}+\operatorname{opposingCost}_{i,e}+\operatorname{ropeCost}_e \\
U_{i,g}&=-w_T\frac{T_{i,g}}{30}+w_FF_g+w_SS_{i,g}+3w_GG_{i,g}+w_II_{\mathrm{current}}+\varepsilon_{i,g} \\
\varepsilon_{i,g}&\sim\operatorname{Gumbel}(0,1)\quad\text{(once per person and exit)}
\end{aligned}
\tag{L5}
$$

These are the existing A equations, not a fresh parameter fit. Choice is restricted to known exits and accessible/open routes, with imperfect acceptance of staff, pre-announcement and signs. Persistent tastes mean the softmax formula describes the cross-sectional random-utility construction, not an independent redraw at every junction. Adaptive urgency/trust/memory can be switched off while preserving this simpler choice model.

Spatial signs retain floor, distance, facing and drawn wall/column occlusion. Manager reach is evaluated using the original graph and room approximation. A-Lite thus differs from B in its uncontracted spatial links, finite storage accounting for all transit, lane-level FIFO, row occupancy, queue location, and conservative opposing-slot exchanges. It is not B with a new label. It also retains more A behavior than a minimal queue network; the audit identifies which mechanisms still need calibration.

## Essential parameters and reproducible choice weights

The primary tone-alarm population uses independent standard-normal draws for speed, recognition, response and preparation; the repeated Z notation below denotes the appropriate draw, not a single shared variate. With age factor f=0.78 for the sampled 25% elderly share and f=1 otherwise, speed is clipped to [0.5,2.0] m/s; wheelchair speed is 0.8. Recognition and response have log-scale sigma 0.6. Preparation is a 50:50 mixture, preserving a short nonzero preparation phase even without belongings.

$$
\begin{aligned}
v_i&=\operatorname{clip}\!\left[f(1.2+0.25Z),0.5,2.0\right] \\
\tau_{\mathrm{rec}}&=6e^{0.6Z},\qquad\tau_{\mathrm{response}}=m_i e^{0.6Z} \\
m_i&=14L_{\mathrm{level}}\exp\!\left[0.04\min(d_{\mathrm{aisle}},15)+0.05\frac{d_{\mathrm{door}}}{10}-0.15I_{\mathrm{familiar}}\right] \\
\tau_{\mathrm{prepare}}&=\begin{cases}6e^{0.6Z},&\text{probability }0.5,\\1.5e^{0.3Z},&\text{otherwise.}\end{cases}
\end{aligned}
\tag{L6}
$$

L_level is 1 for orchestra/mezzanine and 1.1 for balcony. Recognition and response clocks advance at 1+1.5φ; preparation advances at 1. Here φ is nearby moving share plus half preparing/standing share. Additional awareness uses the implemented first-order probability 0.4φΔt. Staff activation is lognormal with median 10 s, sigma 0.5; hearing uses 1−exp(−0.35) each second within eligible reach. Acceptance remains 0.8 before adaptive trust, preassignment reach/adoption 0.6/0.7, and LED notice/adoption 0.9/0.7. These numerical choices are inherited assumptions.

| Type (population share) | T | Q | F | S | G | I | Replan |
|---|---|---|---|---|---|---|---|
| Shortest (0.20) | 2.4 | 1.2 | 0.3 | 0.3 | 1.0 | 0.8 | 0.8 |
| Habitual (0.35) | 0.6 | 0.3 | 2.8 | 0.5 | 0.8 | 1.5 | 0.15 |
| Follower (0.25) | 0.8 | 0.4 | 0.9 | 2.8 | 1.0 | 1.0 | 0.5 |
| Queue avoider (0.10) | 1.4 | 2.8 | 0.4 | 0.2 | 1.0 | 0.6 | 0.9 |
| Cooperative (0.05) | 1.0 | 0.8 | 1.0 | 1.0 | 1.6 | 1.2 | 0.3 |
| Impatient (0.05) | 2.2 | 0.8 | 0.5 | 0.5 | 0.6 | 0.6 | 0.7 |

T/Q/F/S/G/I weight time, queues, familiarity, social choice, guidance and inertia in (L5); Replan is the probability of reconsidering at an eligible junction. They are uncalibrated qualitative orderings, retained to isolate movement changes. Queue cost is (Q/T) times visible Q_e/C_e with inherited narrow-door aversion; no perceived cost is added to physical travel time. Route inertia requires improvement above max(8 s,15% of remaining cost).

Gate capacity is q×max(0.4,w−2b)×0.97×environment×urgency factor: q=1.3 for doors or 1.0 for stairs; b=0.15 or 0.09 m. Divided stairs apply boundary loss to each lane. The unchanged urgency factor is (1+0.15u)[1−0.45 max(0,(u×meanImpatience−0.35)/0.65)²], with u=0.6. All complete configurations and the original population generator are saved; none of these weights is fitted to the 180-second target.

## References specific to this extension

**[L-R1]** Guo, R.-Y., Huang, H.-J. & Wong, S.C. (2011). *Collection, spillback, and dissipation in pedestrian evacuation: A network-based method.* Transportation Research Part B 45, 490–506. [Author/institutional manuscript](https://sem.buaa.edu.cn/__local/C/C9/7C/FE43AA20309F2E9E62D9D53E007_57E48E48_2356F5.pdf), [DOI](https://doi.org/10.1016/j.trb.2010.09.009). Supports finite-storage spatial-flow modelling; its hexagonal-cell model is not this implementation.

**[L-R2]** Palmer, G.I., Harper, P.R. & Knight, V.A. (2018). *Modelling deadlock in open restricted queueing networks.* European Journal of Operational Research 266, 609–621. [Author manuscript](https://orca.cardiff.ac.uk/id/eprint/106314/1/1-s2.0-S0377221717309529-main.pdf), [DOI](https://doi.org/10.1016/j.ejor.2017.10.039). Queue deadlock and model interpretation; no claim of pedestrian passing calibration.

[R3–R19] refer to the numbered primary sources in `MODEL_GUIDE.md`, including Train; Seyfried; Johansson; Spearpoint and Xiang; theatre response/route-choice studies; group studies; and signage trials. Mechanism support and numerical calibration are separate claims throughout this report.
