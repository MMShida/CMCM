# Key findings from the example experiments

Source: [RESULTS.md](RESULTS.md) (`npm run experiments -- --runs 40 --seed 2026`). The scenario and
strategy tables use 40 paired seeds; the sweeps use 20. All numbers are **model outputs under the
documented assumptions** ([PARAMETERS.md](PARAMETERS.md)). The model is not calibrated to Bailey Hall, so
absolute times should not be quoted as predictions. Comparisons between strategies on common seeds are
the robust use of these results.

## 1. The binding constraint is inside the auditorium, not at the exterior doors

- Network max-flow bound (independent of agent behaviour): the exterior doors could discharge
  F* = 15.8 p/s, i.e. 1,329 people in 84 s of pure flow.
- The orchestra, however, is capped at 5.8 p/s by its six access points (527 people need at least
  90 s of flow), and the balcony at 4.4 p/s by its stair flights (≥ 72 s).
- Consistently, the door specific flow has almost no effect on the last-person time (1.4 s swing for
  1.0 → 1.9 p/(s·m)), whereas stair/access-stair flow (28 s swing), the share of people in groups (39 s),
  Crowd Manager compliance (26 s) and walking speed (23 s) matter most.
- In every full-house run, the last people out are slow walkers from the front-centre orchestra.

## 2. Baseline times and the 180 s benchmark

| Case | Mean T (s) [95% CI] | P(T ≤ 180 s) |
|---|---|---|
| Ordinary concert departure (coats, habit, no guidance) | 466 [455, 477] | 0% |
| Concert emergency, 6 Crowd Managers | 299 [291, 306] | 0% |
| Same audience, no Crowd Managers | 366 [355, 376] | 0% |
| University lecture (no Crowd Managers, students know exits, backpacks) | 341 [324, 358] | 0% |

- Occupancy curve (legal Crowd Manager minimum): P(T ≤ 180 s) = 90% at 10% occupancy, 85% at 25%,
  35% at 50%, 0% at 75–100%. Above roughly half capacity, the access-point/stair capacity dominates.
- Under these assumptions, no tested configuration meets 180 s at full occupancy. Read this as "the
  benchmark is capacity-limited by the internal access points and pre-movement", not as a statement
  about the real building. The largest levers are faster pre-movement, fewer group delays, and the
  access stairs.

## 3. Crowd Managers

- 0 → 6 Crowd Managers: −67 s [−81, −53] (paired). Foyer load drops from 1,087 to 738 people.
- Diminishing returns: 2 CMs 324 s, 4 CMs 289 s, 6 CMs 303 s, 10 CMs 287 s (20 runs each; the 4–10 CM
  differences are within noise).
- One CM absent (CM3) makes no detectable difference (−0.1 s [−10, 10]).

## 4. Interventions (Q4)

| Strategy vs S1 (CM only), 40 paired seeds | Δ mean T [95% CI] | Δ p95 individual exit | Δ exposure > 3.5 p/m² |
|---|---|---|---|
| S2 + LED guidance | −7 [−18, +3] | −0.2 [−2, +2] | +242 [+91, +392] |
| S3 + corridor barriers W1/E1 | −9 [−22, +3] | −5.9 [−9.0, −2.9] | **−1,253 [−1,413, −1,093]** |
| S4 + LED + barriers | −8 [−19, +3] | −4.7 [−7.8, −1.6] | −1,100 [−1,245, −955] |

- **Barriers mainly make the evacuation safer, not much faster.** Placed between side door P2 and
  mezzanine door D3 (and mirrored), they halve the person-seconds spent above 3.5 p/m² and shorten
  the 95th-percentile individual exit time. The mean last-person time gain is not significant.
- **Barrier position matters** (section F, 20 runs): W1/E1 −17 s [−33, −0.3]; W1/E1 + W2/E2
  −22 s [−38, −7]; W2/E2 alone +11 s [−15, +38]; W0/E0 ≈ 0. A badly placed barrier can make things worse.
- **LED strips add little when six compliant Crowd Managers already guide people**, because the binding
  constraint (orchestra access) is not an exit-choice problem. The LED compliance sweep (0.3–0.9) is
  flat. LEDs that contradict the Crowd Managers (sending everyone to the foyer) did not measurably
  slow the evacuation in this model, but they increased foyer use from 738 to 848 people.
- Implication for Q5: under these assumptions, extra Crowd Managers beyond the legal minimum and LED
  strips buy little evacuation time. Barriers are cheap and mainly reduce dense-crowd exposure. Any
  measure that speeds up the orchestra access points or pre-movement would pay off more.

## 5. Blocked exit (FC2) and information

- Blocking the centre foyer connection FC2 with discovery-only knowledge was **not slower; it was
  15 s faster** [−26, −5] than the baseline. With everyone knowing immediately: +0.5 s [−10, +11].
  Announced after 45 s: +12 s [−1, +25].
- A plausible mechanism is a Braess-like effect: FC2 sits at the corridor's centre merge, where the
  west and east streams and door D5 converge; removing it splits the flows cleanly to FC1/FC3. A
  late re-direction by staff disturbs flows that had already organised themselves. **This is a model
  result that needs checking** (sensitivity to the corridor geometry and merge rules) before it is
  used as an argument.
- Losing the whole foyer leaves the portico and stage routes: all ambulatory people get out
  (mean 355 s), but the three wheelchair users have no accessible route and are reported as unresolved.

## 6. Other scenarios

- Darkness +30 s [19, 42], smoke (simplified) +49 s [36, 61], separated groups with counterflow
  +19 s [8, 30], falls on stairs +7 s (n.s.), older audience +8 s (n.s.), younger −13 s [−27, −0.1].
- "Highly competitive" crowd: −25 s [−34, −16]. With the default faster-is-slower parameters
  (gain 0.15, drop 0.45, threshold 0.35), clogging only partly offsets the faster, more time-driven route
  choices of impatient agents. Faster-is-slower is therefore not produced by default; it needs a
  stronger drop parameter, which remains an open, testable hypothesis.

## Caveats to state in the paper

Geometry ±6% scale with estimated door/stair widths; uncalibrated behaviour weights; 1D lane
dynamics with no contact forces; simplified stress tests; wheelchair assisted evacuation not modelled.
The biggest uncertainties are exactly the parameters with the largest swings: pre-movement and
groups, access-stair capacity and compliance.
