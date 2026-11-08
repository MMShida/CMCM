# Bail(ey)ing Out: agent-based evacuation simulator for Bailey Hall

An interactive, research-grade simulator for the CMCM 2026 problem *"Bail(ey)ing Out"*
(evacuating Bailey Hall, Cornell University). Every one of the 1,329 occupants is an
individual agent with its own reaction time, walking speed, behavioural type, knowledge,
social group and route. People move on a reconstruction of the real building, and bottlenecks
emerge from capacity-limited doors, stairs, seat rows and aisles. Monte Carlo batches estimate
the distribution of evacuation times, and an experiment mode compares strategies on common
random seeds.

> Simulated times depend on the documented assumptions (see [docs/PARAMETERS.md](docs/PARAMETERS.md)).
> They are not calibrated predictions and do not prove regulatory compliance or real-world safety.

> **New (2026-11-07, second round):**
> - dynamic individual behaviour (beliefs, confidence, urgency, trust, event-triggered rerouting);
> - adaptive Crowd Managers (local observation, radio, coordinated instructions, walls block the voice, five six-manager placements);
> - responsibility / reach / influence / workload per manager;
> - a **Density over time** tab and a **Crowd Managers** tab.
>
> Both adaptive switches default to off, which reproduces the previous model exactly. See
> [docs/ADAPTIVE.md](docs/ADAPTIVE.md) and the generated tables in [docs/ADAPTIVE_RESULTS.md](docs/ADAPTIVE_RESULTS.md).

## Quick start

```bash
npm install
npm run dev          # interactive app at http://localhost:5173
npm run test         # 95 automated tests (vitest)
npm run build        # type-check + production build into dist/
```

Command-line experiments (headless, parallel, reproducible):

```bash
npm run batch -- --scenario concert-emergency --runs 100 --seed 2026 --out results/baseline
npm run batch -- --scenario S4 --runs 200 --set movement.doorFlow=1.6 --set crowdManagers.complianceProb=0.7
npm run experiments -- --runs 40 --seed 2026      # full suite -> docs/RESULTS.md + results/experiments/
npm run geometry                                   # regenerate the geometry JSON from the parametric builder
npx tsx scripts/flow-bound.ts                      # network max-flow / min-cut cross-check
npx tsx scripts/optimise-plan.ts --base concert-emergency --seeds 16   # seat-block exit plan optimisation
npx tsx scripts/requirements-180.ts --runs 40      # what it takes to reach 180 s (interventions + hypothetical geometry)
npx tsx scripts/three-models-180.ts --runs 40      # baseline vs 180 s package in Models A, B and C
npx tsx scripts/occupancy-curve.ts --base package-180 --runs 40   # T(N) and the largest audience meeting 180 s
npx tsx scripts/convergence-check.ts --runs 30     # results at dt and dt/2 (numerical check)
node scripts/ui-check.mjs docs/screenshots         # automated UI check + screenshots (needs npm run dev and Chrome)
```

No API keys, accounts or cloud services are needed. Everything runs locally (Node ≥ 18).

## Three models: A, B and C

| | Model | What it does | Where |
|---|---|---|---|
| **A** | Detailed agent-based simulator (the original one) | individual agents on lanes along every row, aisle, door and stair; collisions, density, counterflow | `src/simulation/`, tab **Live simulation (A)** |
| **B** | Network behavioural simulator (new) | the same people and decision rules on a directed graph derived from A's geometry; capacity-constrained queues, no spatial collisions; about 2x faster | `src/network/NetworkSimulation.ts`, tab **Network model (B/C)** |
| **C** | Ideal network flow (new benchmark) | static max flow / min cut (Dinic) and time-expanded quickest evacuation with earliest-arrival curve, on B's graph | `src/network/StaticFlow.ts`, `TimeExpanded.ts` |

Both engines run independently and share the building topology (stable feature ids such as D3,
OST_FW, FC2, P1, F4), the capacity rules (`src/shared/PhysicalModel.ts`), the scenario definitions
and the population generator. For a seed, A and B simulate the identical audience.

```bash
npm run batch -- --scenario concert-emergency --runs 100          # Model A alone (unchanged)
npm run network-batch -- --scenario concert-emergency --runs 100  # Model B alone
npm run flow -- --scenario concert-emergency                      # Model C: max flow, min cut, T*
npm run compare -- --runs 30 --seed 2026                          # paired A/B/C experiments -> docs/COMPARISON_RESULTS.md
npx tsx scripts/feature-probe.ts --seeds 3                        # feature audit by experiment -> docs/feature-probe.json
npx tsx scripts/network-info.ts --json results/network/network.json   # export the graph and its mapping to the detailed geometry
node scripts/ui-check-compare.mjs docs/screenshots                # UI check of the new tabs (needs npm run dev)
```

In the app:

- **Network model (B/C):** watch Model B live, with the graph drawn on the plan and queues
  shown behind doors. Below it is the Model C panel (F*, minimum cut, blocking effects,
  earliest-arrival curves).
- **Compare models:** A and B side by side on one shared simulated clock, with shared controls
  (scenario, seed, occupancy, blocked exit, guidance). Includes cumulative-evacuation curves of
  A, B and the C benchmarks.
- **Model experiments:** paired Monte Carlo (10 / 100 / 500 / custom runs) in Web Workers, for
  the current configuration, the seven interventions, the occupancy sweep or sensitivity factors.
- **Results dashboard:** summary of the latest report, from this session or from `npm run compare`.

Methodology for the paper is in [docs/NETWORK_MODEL.md](docs/NETWORK_MODEL.md); the audit of
what each model really implements is in [docs/AUDIT.md](docs/AUDIT.md).

### Repository layout versus the proposed structure

The existing code was not moved, so Model A keeps working unchanged. The proposed folders map
onto the repository as follows:

| Proposed | In this repository |
|---|---|
| `full-simulator/` | `src/simulation/`, `src/geometry/`, `src/components/` (Live, Monte Carlo, Compare strategies, Sensitivity, Geometry editor) |
| `network-simulator/` | `src/network/` (graph, max flow / min cut, time-expanded flow, behavioural simulation) |
| `shared/` | `src/data/geometry/bailey-hall.json` (topology), `src/shared/PhysicalModel.ts` (capacities), `src/simulation/Params.ts` (one configuration for both models), `src/simulation/Scenarios.ts`, `src/simulation/Population.ts` (paired population), `src/simulation/MonteCarlo.ts` (statistics) |
| `comparison-dashboard/` | `src/compare/` (paired runner, experiments, reports) and `src/components/compare/`, `src/components/network/` |
| `research/` | the two problem PDFs (project root), `docs/PARAMETERS.md`, `docs/NETWORK_MODEL.md` |

A snapshot of the source before this work is in `backup/pre-network-model-2026-11-07.tar.gz`.

## Using the app

**Left panel (configuration).** Pick a scenario preset, then adjust occupancy, behaviour-type
shares, reaction-time distributions, walking speeds, door and stair capacities, urgency and
faster-is-slower, social influence and knowledge, Crowd Managers (count, posts, compliance,
dynamic re-direction), LED guidance, the zone → exit plans (CM and LED; making them differ
simulates contradictory instructions), closed exits (and how people learn about them),
corridor barriers, and environment or stress tests. Every parameter, including the
route-choice weights per type, can be edited as JSON. Hover ⓘ for sources and units.

**Live simulation.** Start, pause, resume, reset, single-step; speeds 1×–50×; first floor,
balcony, or both side by side; zoom (wheel), pan (drag), fit (double click). Options include
the PDF floor-plan or seating-chart overlay with adjustable opacity, a density heatmap
(current or peak), queue markers at doors and stairs, the walkable network and labels. A
replay slider scrubs through one snapshot per simulated second. Click any circle to inspect
that person: speed, reaction times, type, state, chosen exit and why, known exits and
closures, guidance received, utilities of each exit, current link, density, waiting time,
plus their planned route drawn on the map. When the run ends, the result tiles, evacuation
curve, exit utilisation, start/exit histograms and a bottleneck table appear below the map,
with CSV/JSON exports (agents, time series, run + parameters).

**Monte Carlo.** 1 / 10 / 100 / 500 / custom runs in Web Workers, with progress and cancel.
Shows mean, median, SD, p5–p95, the 95% CI of the mean, P(T ≤ 180 s) with a Wilson CI, and
unresolved and gridlock rates, plus a histogram, mean curve with p5–p95 band, exit
utilisation and queue rankings. Exports CSV/JSON.

**Compare strategies.** Built-in strategies S0–S6 (no guidance; Crowd Managers; + LED;
+ barriers; + both; blocked exit with static or dynamic guidance), the current configuration,
or saved configurations, all run on the same seeds. Gives a side-by-side table, paired
differences with CIs, box plots, benchmark probabilities, mean curves and exit usage. It
flags "faster but denser" strategies.

**Sensitivity.** One-at-a-time low/high sweeps (reaction times, walking speed, door/stair
flow, compliance, habit, headway, groups) with a tornado chart and paired seeds.

**Density over time.** *Run and record* a run (Model A or B, any seed):
- a heat map of persons/m² updates live while it runs, then any second can be replayed;
- a region table, the density timeline of one region (with occupancy, queue and outflow), several regions compared, and the congested area over time;
- time above 1, 2, 3 or 4 p/m² per region, and the distribution of individual exposure ∫max(0, ρ − ρ_ref) dt;
- Monte Carlo distributions of regional peak density and exposure;
- CSV/JSON exports of the time series, region definitions (areas, links) and summaries.

**Crowd Managers.** For the same recorded run:
- per manager: R (formal responsibility), H (people in reach), I (people following its last instruction) and the workload index over time;
- posts and voice rings on the map at any second, and the instruction history with reasons;
- a paired comparison of the previous fixed model with dynamic individuals, adaptive managers and both.

Placement, communication, information level and every adaptive parameter are in the left panel
under *Dynamic behaviour & adaptive Crowd Managers*.

**Geometry editor.** Overlay the scanned plans or seating charts, calibrate the overlay
(offset, scale, rotation), drag nodes, edit door/stair widths, highlight approximate
elements, and import/export the geometry JSON, then apply it to all simulations.

## Scenarios

Core: (1) ordinary concert departure, (2) concert emergency with 6 Crowd Managers,
(3a/b/c) blocked foyer connection FC2 (discovered on approach / announced after 45 s /
known immediately), (4) university lecture, (5) corridor barriers, (6) LED guidance, (6b) LED +
barriers. Additional: LED contradicting Crowd Managers, no guidance, 25/50/75% occupancy
(legal CM minimum), one CM absent, older/younger audience, winter, uneven occupancy.
Stress tests (simplified): darkness, smoke, blocked foyer, fire near the stage, falls on
stairs, separated groups and counterflow, highly competitive crowd (faster-is-slower), alarm
10 s after the declaration, responders entering through the foyer.
Improvement scenarios (docs/IMPROVEMENTS.md): (7) optimised seat-block plan, (8) + pre-assigned
exits, (9) the 180 s operations package; also voice alarm, groups meet outside, Crowd Manager
queue rebalancing. Strategies S7–S9 in the experiment tabs.

## The model in brief

Full specification: [docs/MODEL.md](docs/MODEL.md). Parameters and provenance:
[docs/PARAMETERS.md](docs/PARAMETERS.md).

- **Geometry**: a parametric reconstruction of the first floor and balcony from the PDF plans
  (pages 4–7), stored as editable JSON with 268 nodes, 384 links and 1,329 seats. It includes
  rows, aisles, the 6 access points, the barrier, 9 mezzanine doors, the semicircular
  corridor, 4 portico doors, 3 foyer connections, 5 foyer doors, the monumental and portico
  stairs, two-flight two-lane balcony stairs, stage-side stairwells, stage escape routes,
  3 wheelchair positions and the prohibited elevator. Agents occupy only validated links, so
  they cannot cross walls.
- **Pre-movement**: lognormal recognition, response and preparation phases whose medians
  depend on aisle and door distance, level and familiarity. A social clock dc/dt = 1 + κφ and
  an awareness hazard model neighbours, and Crowd Manager instructions shorten the response.
- **Route choice**: per-agent forward Dijkstra over the links the agent believes open, with
  visible queue delays (narrow doors weigh more) and opposing-flow penalties. A multinomial
  logit over the exit groups it knows uses time, habit (main entrance), visible neighbours'
  choices, accepted guidance and inertia. Six behaviour types differ in their weights.
  Knowledge is local: signs, staff, neighbours, discovery.
- **Movement**: lanes with no overlap and a time-headway following model. Seat rows are
  limited to 0.45 m/s, squeezing past seated people is slower, entrants merge zipper-style at
  junctions, and counterflow keeps each direction to its own side.
- **Bottlenecks**: doors and stairs are token buckets, C = q · w_eff · factors · g(u, π), with a
  testable faster-is-slower term. The throughput limit is verified by the tests.
- **Monte Carlo**: seeded, reproducible, with common random numbers across strategies,
  t-based CIs, Wilson intervals and paired differences. Unfinished runs count as failures.
- **Cross-check**: network max-flow / min-cut bound on the same graph (`QueueModel.ts`).

## Validation and tests

`npm run test` runs 74 tests. The 38 Model A tests cover:

- **Occupancy and seating:** occupancy equals the selected value, capacities are respected
  per floor, and each seat is used once.
- **Reproducibility:** the same seed gives identical results, different seeds vary, and the
  audience is identical across interventions.
- **Physical validity:** no link crosses a wall; no teleporting (only adjacent links); stairs
  connect only valid levels and storey stairs are never climbed; nobody uses the elevator.
- **Exits and capacities:** blocked exits never discharge, barriers are never crossed, and
  door/stair throughput never exceeds the capacity rule in any 10 s window.
- **Conservation:** no one is counted as evacuated twice, occupancy is conserved at every
  second, and evacuated counts are monotone.
- **Behaviour and batches:** guidance compliance changes behaviour, and batched runs equal
  individual runs.
- **Explicit failure reporting:** stopped or trapped runs are reported as unresolved, and
  wheelchair users are never counted as safe.
- **Statistics:** t-quantiles, CI coverage, Wilson intervals, paired differences.
- **Flow bound:** the simulated outflow never exceeds the max-flow bound.

The 36 network and comparison tests (`tests/network-flow.test.ts`, `tests/network-sim.test.ts`, `tests/compare.test.ts`) cover:

- **Flow algorithms on small networks with known answers:** max flow = min cut (CLRS example and
  40 random graphs), corridor and parallel-route quickest flows, release delays, closed edges, the
  incremental earliest-arrival curve against fresh computations, and discretisation bounds.
- **Mapping:** every official connection is exactly one network edge with the same feature id;
  network nodes are real nodes; chain lengths match.
- **Model B invariants:** paired population identical to A's, conservation, no double counting,
  adjacency, capacity in every 10 s window, the static bound, no run beating the ideal bound,
  reproducibility, closures and barriers, unfinished/trapped reporting, guidance effects.
- **Framework:** ordering of the C benchmarks, shared-clock synchronisation of the two live
  engines, door-width sensitivity direction, paired statistics and report assembly.

`tests/improvements.test.ts` (21 tests) covers the first improvement round, and `tests/adaptive.test.ts` (29 tests) covers dynamic behaviour, adaptive managers, scope, placements and density over time; see [docs/ADAPTIVE.md](docs/ADAPTIVE.md) §7. The suite has **124 tests**. `npx tsx scripts/legacy-reference.ts` checks that the fixed model is unchanged, and `node scripts/ui-check-dynamics.mjs <url>` checks the new tabs in headless Chrome.

The development log with the problems found and fixed is in [docs/PROGRESS.md](docs/PROGRESS.md).

## Results

- [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md): the 2026-11-07 model improvements and the 180 s analysis (what it takes, three models, largest audience).
- [docs/FINDINGS.md](docs/FINDINGS.md): interpretation of the example experiments (key findings and caveats).
- [docs/RESULTS.md](docs/RESULTS.md): all tables, generated by `npm run experiments` (raw CSV/JSON in `results/experiments/`).
- [docs/COMPARISON_RESULTS.md](docs/COMPARISON_RESULTS.md) and [docs/NETWORK_MODEL.md](docs/NETWORK_MODEL.md) (results section): Model A vs B vs C, interventions, occupancy, sensitivity.
- [docs/screenshots/](docs/screenshots/): UI screenshots produced by `scripts/ui-check.mjs` and `scripts/ui-check-compare.mjs`.

Headline after the 2026-11-07 improvements (40 paired seeds, full house, docs/IMPROVEMENTS.md):

- **Concert emergency:** Model A T = 264 s [260, 268].
- **180 s operations package:** 227 s in A and 195 s in B (5% of B runs ≤ 180 s).
- **Ideal flow (Model C):** 143–163 s, so 180 s is physically feasible.
- **Largest audience meeting 180 s with ≥ 95% probability:** about 560 today and about 750 (A) to 930 (B) with the package.

Earlier headline, before the improvements (kept for reference): concert emergency with 6 Crowd
Managers T = 299 s [291, 306]; without Crowd Managers 366 s; ordinary departure 466 s;
lecture 341 s.
The internal orchestra access points (≤ 5.8 p/s) and balcony stairs, not the exterior doors, bind.
Corridor barriers at W1/E1 cut high-density exposure by 57% with a non-significant 9 s time gain;
LED strips add little on top of compliant Crowd Managers.

## Project structure

```text
src/
  geometry/      types.ts, BaileyHallBuilder.ts (parametric reconstruction), NavigationGraph.ts, BaileyHall.ts
  simulation/    Agent, Population, Behavior, Routing, Movement, QueueSystem, Congestion, Guidance,
                 Metrics, SimulationEngine (headless, deterministic), MonteCarlo, QueueModel, Scenarios,
                 Params (all parameters + provenance), Random (seeded xoshiro128**), WorkerPool
  network/       NetworkGraph (graph + mapping), MaxFlow (Dinic), StaticFlow, TimeExpanded, NetworkSimulation (Model B)
  shared/        PhysicalModel (capacity rules shared by both models)
  compare/       Comparison (paired A/B/C runs), Experiments, ComparePool (workers), ReportMarkdown
  workers/       MonteCarloWorker.ts, CompareWorker.ts
  components/    React UI: SimulationCanvas, MapRenderer, LiveController, ControlPanel, StatisticsPanel,
                 AgentInspector, MonteCarloPanel, ExperimentComparison, SensitivityPanel, GeometryEditor, Charts
  data/geometry/ bailey-hall.json (generated, editable)
tests/           vitest suites
scripts/         generate-geometry, batch, run-experiments, flow-bound, ui-check, diagnostics
public/maps/     plan and seating-chart images rendered from the problem PDF
docs/            MODEL.md, PARAMETERS.md, RESULTS.md, PROGRESS.md, screenshots/
results/         CLI and experiment outputs (CSV / JSON)
```

## Limitations (summary)

The geometry comes from scans: about ±6% scale, door widths estimated, backstage routes
schematic. Behaviour is not calibrated to Bailey Hall. The 1D lane model does not represent
contact forces or crush. Smoke, darkness, winter and falls are simplified stress tests.
Assisted evacuation of wheelchair users is not modelled; they are reported as awaiting
assistance, never as safe. The ground level and service spaces are ignored, as the problem
instructs. Read results comparatively, as strategy A versus B under the same assumptions.
