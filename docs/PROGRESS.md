# Progress log

Running record of what was built, what was tested, what failed and how it was fixed.
Newest entries at the bottom of each milestone.

## Milestone 1: Geometry and visualization data
- Read both PDFs. Rendered pages 4-7 to `public/maps/` (page4_raw.png etc., via PyMuPDF).
- Orientation: floor plans have the stage at the top (north), seating charts are rotated 180°.
- Scale calibrated to ~0.08 m per plan pixel (27'-0" centre row, 2,602 sq ft corridor, 18,602 sq ft gross area).
- Parametric builder `src/geometry/BaileyHallBuilder.ts` -> editable JSON `src/data/geometry/bailey-hall.json`
  (268 nodes, 384 links, 1,329 seats, walls with door openings cut automatically).
- Seat pitch solved per level so counts equal 527 / 486 / 316 (+3 wheelchair positions on the mezzanine).
  Resulting pitch ~0.48 m (nominal 0.51 m): the reconstruction is ~6% short, within scale uncertainty.
- Visual check: geometry overlaid on the plans (both floors) lines up closely.

## Milestone 2: Basic movement
- Lane-based link network: agents ordered in lanes, no overlap, capacity-limited gates (token buckets).
- First full run: 1,329 agents evacuated, ~1 s wall time per run.
- **Issue:** stair capacity formula subtracted boundary layers per lane -> fixed (per-lane only for barrier-split stairs).
- **Issue:** counterflow in the 1.1 m orchestra aisles collapsed speeds (opposing density weighted 1.5x) -> weight c=0.5.
- **Issue:** Weidmann's area-density law inside dense queues gave ~0.2 m/s and starved bottlenecks
  (back access stairs at 55% of capacity) -> default speed model is now a 1D time-headway following model
  (v = (h - d_min)/T, T = 0.7 s), Weidmann kept as an option.
- **Issue:** lane rule floor(w/0.6) made 1.1 m aisles single-file -> floor(w/0.6 + 0.2).
- **Issue:** each direction had a full set of lanes, so counterflow overfilled links (9 p/m2) ->
  occupancy cap (4.5 p/m2) + each direction keeps to its own half of the lanes under counterflow;
  head-on deadlocks resolved by a "squeeze past" swap rule.
- **Issue:** exterior doors were bidirectional; a test found agents re-entering -> exterior links are one-way.

## Milestone 3: Psychological model
- Lognormal recognition / response / preparation phases, social clock acceleration, squeeze-past cues.
- Six behaviour types with multinomial-logit weights; per-agent forward Dijkstra search with visible
  queues (tail-of-queue visibility), counterflow penalty, route inertia.
- **Issue:** queue visibility only at the door made people queue 170 deep for one access stair ->
  queue tail visibility + re-planning while waiting.
- **Issue:** agents with no known reachable exit froze and blocked a walkway (blocked-foyer scenario) ->
  lost agents follow visible crowds / look for signs; after 30 s they step aside and are reported TRAPPED.
- Groups wait for each other, adopt the leader's exit, move at the slowest member's pace, can break up.

## Milestone 4: Scenarios
- 26 presets (core 1-6 incl. blocked-exit variants, LED, barriers; additional; stress tests).

## Milestone 5: Monte Carlo and analytics
- Headless batch runner (`MonteCarlo.ts`), browser Web Worker pool (~4 runs/s on this laptop with 8 workers),
  Node CLI (`npm run batch`, worker_threads), statistics (t CI, Wilson, paired differences), exports.
- Network max-flow / min-cut cross-check (`QueueModel.ts`, Dinic).
- Experiment suite `npm run experiments` -> docs/RESULTS.md (scenarios, strategies, T(N), sensitivity,
  barrier positions, staffing, flow bounds).

## Milestone 6: Validation and refinement (issues found by running the model)
- **Long tail (runs up to 515 s):** traced to a U-turn deadlock on a 0.87 m aisle segment (two agents
  re-planned into the link they came from). Fix: routine re-plans may not U-turn; after 20 s blocked an
  agent may squeeze into the lane with most room (gates still enforced). Tail now 268-370 s.
- **Climbing to the balcony to escape:** a loge agent chose the balcony NE stairwell. Fix: storey stairs
  are descend-only for evacuation routing (still climbable for reuniting group members); test added.
- **Route flip-flopping (21 reroutes for one agent):** stronger inertia (max(8 s, 15%)) and fewer
  re-plans while waiting.
- **Density metric artefacts** (short 0.87 m aisle links): peak/exposure exclude links < 1.5 m;
  exposure threshold 3.5 p/m2.
- **UI:** canvas `filter` broke dark-mode overlay drawing and `setTransform` ignored pane offsets ->
  cached inverted image + relative transforms. Automated UI check with puppeteer-core (`scripts/ui-check.mjs`).
- **Barrier presets:** the experiment showed W2/E2 (first guess) does not help while W1/E1 does ->
  presets switched to W1/E1 and sections A/B regenerated.

## Tests
- `npm run test`: 38 tests (geometry, invariants, reproducibility, interventions, statistics, flow bound).

## Final progress report

**Status: all milestones complete; the end-to-end simulator runs.**

Completed features
- Geometry reconstructed from the PDF plans (both floors; overlays for plans and seating charts,
  calibration tool, editable JSON, approximate elements flagged). The 6 access points, 9 doors,
  4 portico doors, 3 foyer connections, 5 foyer doors, all stairs, wheelchair positions and the
  prohibited elevator are all represented.
- 1,329 individual agents with sampled attributes; pre-movement state machine with social
  influence; 6 behaviour types with multinomial-logit choice; local knowledge, discovery,
  word-of-mouth; social groups (waiting, shared exit, pacing, separation, reunite counterflow).
- Lane-based movement with no overlap, row clearance with squeeze-past, zipper merges, counterflow
  lanes, capacity-limited doors and stairs (token buckets), testable faster-is-slower, falls,
  darkness, smoke, winter (simplified).
- 26 scenario presets plus 7 comparison strategies, all editable without code changes.
- Live UI: Canvas rendering, split floors, zoom/pan, 1×–50×, replay slider, density heatmap,
  queues, exit counters, Crowd Managers, barriers, LED strips, agent inspector with planned
  route, post-run charts and exports.
- Monte Carlo in Web Workers; experiment mode with paired seeds; sensitivity tornado; CSV/JSON
  exports; CLI batch and experiment suite; network max-flow cross-check.
- Docs: README, MODEL.md (equations), PARAMETERS.md (source table), RESULTS.md, FINDINGS.md.

Test and build results (final run)
- `npm run test`: 4 files, **38/38 tests passed**.
- `npm run build` (tsc --noEmit + vite build): **success** (main chunk ~640 kB, mostly the geometry JSON).
- `node scripts/ui-check.mjs`: all 14 views rendered, **no page errors**; 16-run browser Monte Carlo
  in 7-15 s.
- Experiment suite: ~1,800 simulations; every full-house configuration completed, with no gridlock.

Remaining issues / not implemented
- Not calibrated against Bailey Hall drills; behavioural weights are assumptions.
- Door, stair and backstage dimensions estimated from scans (±0.3 m widths; scale ±6%).
- Game-theoretic extensions (user equilibrium vs system optimum, price of anarchy) are not
  implemented; the flow bound and the barrier/FC2 experiments are the closest proxies.
- The faster-is-slower relation does not produce clogging at default parameters (documented).
- The "blocked FC2 is faster" result (Braess-like) needs a geometry/merge-rule sensitivity
  check before it is used as an argument.
- Node CLI parallel speed-up is poor on this machine (~1.6 runs/s with 11 workers, versus
  ~2-4 runs/s in browser workers); results are unaffected.
- Main bundle > 500 kB warning (geometry JSON inlined); harmless.

Assumptions requiring verification (highest priority first)
1. Access-stair widths and capacities (front / back access points: 1.2 m assumed).
2. Door clear widths D1-D9, P1-P4, FC1-3, F1-F5 (1.6-1.8 m assumed).
3. Pre-movement distribution parameters (recognition 6 s, response 14 s medians).
4. Share of people in groups and their waiting behaviour.
5. Crowd Manager compliance (0.8), voice range (12 m) and posts.
6. Stage-escape and balcony stairwell routes (schematic backstage geometry).
7. Every PUBLISHED value in PARAMETERS.md against the original papers.

## Milestone 7: second model (network flow) and model comparison (2026-11-07)

Starting point recorded before any change: the project is not a git repository (no status or commit hash
available), so the source tree was archived to `backup/pre-network-model-2026-11-07.tar.gz`. Model A's
code was not moved or rewritten; the only edits to existing files are additive:

- `LiveController.advanceTo(t)`: shared-clock stepping
- `SimulationCanvas` `drawOverlay` hook
- `fmt` accepts `undefined`
- new tabs in `App.tsx`
- new CSS
- new npm scripts

Built:
- **Shared layer:** `src/shared/PhysicalModel.ts` holds the capacity rules (gate C = q·w_eff·…, lane flow
  J = v/(d_min + vT), row-end flow, storage). Both engines read the same `SimConfig`, scenarios and
  population generator.
- **Network** `src/network/NetworkGraph.ts`: derived automatically from the geometry JSON (feature links
  keep their ids, rows become zone supplies, chains contracted at ≤ 8 m, the network ends at the 13
  exterior doors). Size: 145 nodes, 228 edges, 355 arcs. Explicit node/link mapping; JSON export via
  `scripts/network-info.ts`.
- **Model C:** Dinic max flow / min cut (`MaxFlow.ts`, growable typed arrays); static analysis
  (`StaticFlow.ts`: F*, cut, per level, blocking, barriers); time-expanded quickest flow with incremental
  augmentation, giving the whole earliest-arrival curve in one pass (`TimeExpanded.ts`).
- **Model B** `NetworkSimulation.ts`: same people (createPopulation), same pre-movement rules, same logit
  weights, Crowd Managers, LED, blocked-exit knowledge, groups and faster-is-slower; token-bucket arcs,
  node storage, FIFO queues; 0.25 s steps; trapped and gridlock reporting.
- **Comparison** `src/compare/`: paired runs (A, B, C_imm, C_pre, C_A, C_B per seed), statistics and
  paired decompositions, the seven interventions, occupancy sweep, nine sensitivity factors
  (including door and stair width scaling), browser worker pool, CLI `npm run compare` with
  cache and merge, Markdown report.
- **UI:**
  - Network model (B/C): live view, graph overlay, queues, inspector, flow panel with min-cut map
    and earliest-arrival curves
  - Compare models: A and B side by side on one simulated clock, cumulative curves with the C
    benchmarks
  - Model experiments
  - Results dashboard

Issues found by running the new model and fixed:
- Rows shared by two guidance zones only received row-exit edges for the first zone, so one agent
  could never leave its seat. Fix: supplies keyed by (zone, row); test "every seat reaches a source and
  a row end".
- `position()` crashed for an agent between arcs. Fix: guard.
- Social shares were O(N²) per decision, and Crowd Manager hearing was evaluated every 0.25 s
  instead of once per second as in A, which over-counted hearing. Fix: spatial grid rebuilt every
  0.5 s; voice and word of mouth once per second (B run time 1.4 s → 0.5–0.8 s).
- With the foyer blocked, ambulatory agents who only knew the foyer were reported as trapped. Fix:
  lost agents follow others, notice signs, and find the nearest open exit after 10 s; agents
  waiting in a queue of a closed edge leave it.
- Wheelchair users could leave by a portico door in B, but only via the main-entrance assistance
  point in A. Fix: same rule as A.
- Time series were not aligned with A. Fix: sampled at t = 0, every second and at the end.
- The worker pool lost result order on cancellation. Fix: results always in job order.
- Plan door numbers ("20001") were shown as bottleneck names. Fix: labels "BSDW (door 20001)".

Tests after this milestone: 74 (38 Model A + 12 flow + 15 Model B + 9 comparison).

### Final report for milestone 7

Test and build results (final run):
- `npm run test`: 7 files, **74/74 tests passed**.
- `npm run build`: success.
- `node scripts/ui-check.mjs` (Model A tabs) and `node scripts/ui-check-compare.mjs` (new tabs): **no
  page errors**. A paired A/B/C experiment with 4 seeds took 21 s in browser workers.

Experiments actually run:
- `npm run compare`: 30 paired seeds × 13 configurations (baseline, 7 interventions, 5 occupancy
  levels) and 15 seeds × 19 sensitivity levels. That is 675 paired A/B runs, each with 4
  time-expanded benchmarks.
- Feature probe: 13 features × 2 levels × 3 seeds × 2 models.
- Results are in `docs/COMPARISON_RESULTS.md`, `results/comparison/`, `docs/feature-probe.json`;
  the interpretation is in `docs/NETWORK_MODEL.md`.

Remaining issues:
- Model A does not respond reliably to the faster-is-slower clogging parameter (feature probe).
- The A-only "blocked FC2 is faster" effect is not reproduced by B, so it is model-structure
  dependent.
- B and C have no density-speed relation by default and no counterflow interaction.
- C ignores the wheelchair route restriction.
- Sensitivity effects other than stair/access-point width are not significant with 15 seeds; more
  seeds are needed (`npm run compare -- --only sensitivity --runs 40`).
