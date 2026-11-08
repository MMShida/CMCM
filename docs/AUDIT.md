# Repository audit and feature verification (2026-11-07)

> **Second update:** dynamic behaviour, adaptive Crowd Managers and density over time were added (both switches default to off; see [ADAPTIVE.md](ADAPTIVE.md), which also contains the audit of static and dynamic mechanisms).
>
> **Update:** the model was revised later the same day. See [IMPROVEMENTS.md](IMPROVEMENTS.md): numerical fixes, routing fixes, seat-block plans, interventions, Model C bounds, the 180 s analysis, 95 tests. The numbers below describe the model *before* that revision.

## Starting state

- **Version control:** not a git repository, so there is no status or commit hash. The source
  tree before this work is archived in `backup/pre-network-model-2026-11-07.tar.gz`.
- **Source PDFs:** both are present in the project root: `CMCM_2026_Bail(ey)ing_Out.pdf` and
  `Bail(ey)ing Out_ Modeling Considerations and Sources (CMCM 2026).pdf`.
- **Existing code (Model A):**
  - simulation engine: `src/simulation/`, including SimulationEngine, Movement, Routing, Behavior,
    Guidance, QueueSystem, Population, Metrics, MonteCarlo and Scenarios
  - building geometry: `src/geometry/` and `src/data/geometry/bailey-hall.json`
  - visualisation: `src/components/`
  - 26 scenarios and 7 strategies
  - 38 tests
  - one piece of optimisation code: `src/simulation/QueueModel.ts`, a max-flow bound on the
    detailed graph used as a cross-check
- **Changes to existing files** are additive only:
  - `LiveController.advanceTo`
  - the canvas `drawOverlay` hook
  - `fmt` accepts `undefined`
  - new tabs, CSS and npm scripts

  Model A's mathematical behaviour is unchanged; its 38 tests pass unchanged.

## Feature verification by experiment

`npx tsx scripts/feature-probe.ts --seeds 3` (raw output: [feature-probe.json](feature-probe.json)).

Method:

- Each feature is switched low → high in the full-house concert emergency.
- Both levels run on the same 3 seeds in both models.
- **Verified** means the metric moved in the expected direction for every seed.

| Feature | Low → high | Metric | Model A | Model B |
|---|---|---|---|---|
| Individual pre-movement delays (lognormal) | recognition median 3 → 12 s | median start (s) | 22.3 → 25.6 ✔ | 20.7 → 24.3 ✔ |
| Social influence on pre-movement | κ = 0, λ = 0 → κ = 3, λ = 1 | p95 start (s) | 60.0 → 54.5 ✔ | 47.3 → 34.2 ✔ |
| Social groups (waiting for members) | group share 0 → 0.8 | median start (s) | 21.4 → 25.6 ✔ | 20.4 → 23.9 ✔ |
| Seat-row clearance | row speed 0.8 → 0.25 m/s | mean exit (s) | 122.8 → 129.8 ✔ | 94.9 → 101.0 ✔ |
| Randomised walking speeds | mean 1.4 → 0.9 m/s | mean exit (s) | 118.2 → 141.3 ✔ | 93.4 → 106.2 ✔ |
| Doorway / stair bottlenecks | door 1.9 / stair 1.3 → 0.7 / 0.6 p/(s·m) | evacuation time (s) | 277 → 310 ✔ | 216 → 304 ✔ |
| Familiar-exit (habit) preference | familiarity weights ×0 → ×2.5 | persons using the foyer | 546 → 906 ✔ | 590 → 924 ✔ |
| Crowd Manager guidance | compliance 0 → 1 | persons using the foyer | 939 → 668 ✔ | 926 → 701 ✔ |
| LED guidance (no CMs) | compliance 0 → 1 | persons using the foyer | 1,046 → 895 ✔ | 943 → 736 ✔ |
| Queue avoidance | queue-avoider share 0 → 0.7 | exit imbalance (max/mean) | 3.96 → 3.38 ✔ | 4.21 → 3.46 ✔ |
| Social following (imitation) | social weights ×0 → ×3 | exit imbalance | 3.71 → 3.97 ✔ | 3.85 → 4.20 ✔ |
| Blocked-exit discovery and rerouting | none → FC2 blocked (discovered) | agents who rerouted | 301 → 333 ✔ | 358 → 476 ✔ |
| Impatience / faster-is-slower | impatient share 0 → 0.8, urgency 1, drop 0.9 | evacuation time (s) | 274.5 → 280.8 **not verified** (mean up, not on every seed) | 230.4 → 279.4 ✔ |

Further evidence from the automated tests (`npm run test`, 74 tests):

- **Corridor congestion and capacities:** gate throughput never exceeds capacity in any 10 s
  window (A and B); the discharge never exceeds the max-flow bound (A and B).
- **Blocked exits and barriers:** they never discharge (A and B).
- **Monte Carlo seeds:** the same seed gives identical runs and different seeds vary (A and B);
  batches equal individual runs.
- **Cooperation:** represented only through route-choice weights (stronger guidance and habit
  terms) and low impatience. It has no separate mechanism, such as yielding at merges, in either
  model.

## What is complete, partial, or not implemented

| Item | Status |
|---|---|
| Model A detailed simulator, scenarios, Monte Carlo, live UI | complete (pre-existing; verified above) |
| Model B network behavioural simulator | complete; same people and decision rules as A, simplified movement |
| Model C static max flow / min cut, blocking and barrier effects | complete; tested on small networks |
| Model C time-expanded quickest flow and earliest-arrival curve | complete; tested against known answers and fresh computations |
| Shared topology, feature ids, mapping, shared capacity rules | complete; derived automatically from the geometry JSON |
| Paired Monte Carlo (A, B, C per seed), interventions, occupancy, sensitivity | complete (browser workers and CLI) |
| Side-by-side animation on a shared simulated clock | complete (one snapshot per second each; shared replay) |
| Results dashboard and exports | complete (CSV / JSON; reads the CLI report or this session's experiment) |
| Faster-is-slower clogging in Model A | partial: the mechanism exists, but Model A does not respond reliably even with a strong drop parameter (see above and FINDINGS.md section 6) |
| Density-dependent speed in B/C | partial: optional slowdown in B (off by default so B matches C); none in C |
| Counterflow in B/C | not represented (directions do not share capacity) |
| Assisted evacuation of wheelchair users | not modelled: they are reported as awaiting assistance, never as safe (both models); C treats them as ordinary flow |
| Game-theoretic equilibrium routing (user equilibrium vs system optimum) | partial: B − C_B measures the cost of decentralised choice on the same graph, but no equilibrium is computed |
| Calibration to Bailey Hall drills | not done (no data) |

## Assumptions requiring verification

The list from PROGRESS.md still applies: access-stair and door widths, pre-movement parameters,
groups, Crowd Manager compliance and posts, routes behind the stage. The network model adds:

- the 8 m segment length
- node storage defined as ρ_max × half the incident edge area
- Model B's 30 s storage relief
- Model C's single representative speed (1.2 m/s) and 1 s discretisation, which changes shortest
  times by about 0.6 s on average
