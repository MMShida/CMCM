# Codex task: Build the Bailey Hall evacuation simulator from scratch

## Objective and source hierarchy

Build an entirely new, working evacuation simulation and visualization application for Bailey Hall. This is a clean rebuild on a new branch of `MMShida/CMCM`. The branch starts with only this task, the mathematical specification and architectural references; the former simulator remains on the separate `bailey-model` branch. **Do not copy, inspect, cherry-pick, or depend on the former implementation or any other previous CMCM simulator code.** Build the application from scratch on the current branch only.

Read all of the following before coding:

1. `docs/model/Bailey_Hall_Model_Final_Defensible.tex` — **authoritative mathematical and behavioural specification**; read all sections, figures, numerical assumptions and bibliography.
2. `docs/model/Bailey_Hall_Model_Final_Defensible.pdf` — visual check for equations and diagrams.
3. `docs/reference/Bailey_Hall_Problem_Statement.pdf` — scenario scope, seat counts, staff requirements, floor plans and official questions.
4. `docs/reference/cross_aisle_01.png` through `cross_aisle_04.png` and `interior_01.png` through `interior_02.png` — reference views to reconstruct the internal circulation and sightlines.

Use these sources rather than assumptions about the simulator on other branches. The LaTeX document specifies the model. Where it intentionally gives a general mechanism but not a computational convention, make the simplest physically and mathematically consistent choice, record it in `docs/implementation-decisions.md`, and make any influential choice configurable. Never pretend a reconstructed dimension is surveyed or a literature-based parameter is calibrated to Bailey Hall.

**Implement the application, not just a plan.** Continue through functional model, meaningful tests, visual interface, runnable scenarios, and a validation report. If some reference dimension cannot be established, preserve it as an explicit, editable assumption rather than inventing precision or blocking all progress.

The 180-second target is a performance criterion, **not** a value to force by adjusting speeds, queues, dimensions or population. Report the results actually produced.

## Technical architecture

Use TypeScript for the simulation and a React + Vite interface, with Node scripts to run the **same core** without a browser. You may use suitable existing open-source libraries for geometry and plotting, but keep the engine deterministic, inspectable and independently testable. Set up a complete `package.json`, lockfile, TypeScript configuration, linting where useful and Vitest. Provide at least:

- `npm run dev` — interactive application.
- `npm test` — automated tests.
- `npm run typecheck` and `npm run build` — type and production builds.
- `npm run simulate -- --config <path> --seed <integer> --out <path>` — a headless simulation.
- `npm run batch -- --config <path> --seed <integer> --runs <integer> --out <path>` — batch results with deterministic seed enumeration.

Organize the project into separate modules for geometry validation, occupant generation, walking/service/queues, perception/routing, guidance/barriers, assisted evacuation, RNG, scheduler, metrics and UI. Do not make the renderer the source of truth for simulation state. A saved JSON configuration must fully identify the parameters and interventions used in a run. Preserve seeds in results and enable exact replay of individual replications.

## Geometry and population

Reconstruct the directed building graph **from the supplied architectural and seating plans**, not from a generic amphitheatre or a convenient circular shape. Represent all actual walkway bends, legal adjacency, floors, stairs, door widths, passage widths, external boundaries, and seven exit groups. Distinguish seat rows (only their occupants enter/exit them) from general-purpose corridors and cross-aisles (available as through-routes). Treat the audience as **1,329 occupants**: 527 orchestra, 486 mezzanine, 316 balcony, including three wheelchair users. Exclude backstage/ground-level populations because the problem statement does so. Maintain the stage escape routes. The emergency elevator is excluded from evacuation.

**Cross-aisle:** Include the middle orchestra transverse cross-aisle connecting the outer seating block to the curved longitudinal aisle and, via the illustrated **stepped connector**, to the adjacent inner circulation. The connector must be a general-purpose traversable route, not a seat row, and stair travel rules apply to its steps. Do not mark the stepped portion wheelchair-accessible. Respect all intervening wall boundaries and aisle ends; it is not permission for arbitrary movement across seats. Reconstruct the corresponding geometry on the opposite side where shown. Use geometry tests and a visible highlighted overlay that demonstrates exactly what was connected. Document widths/risers that remain inferred.

Use photos to ground the open lower-level auditorium and sightlines **within** it. Do not infer visibility of remote corridor queues through the mezzanine walls. Confirm the physical connection of the foyer, porticoes and balcony escape paths and that all intended accessible origins have feasible paths.

The first geometry version must include a visible uncertainty/provenance report for reconstructed lengths, widths, stair dimensions, posts and barrier slots. Avoid silently defaulting an absent width to something that speeds evacuation.

## Population, response and social behaviour

Implement the equations and parameter values from the final specification, particularly the reference ambulatory speed distribution (non-older mean 1.40 m/s, SD 0.18 m/s, clipped 0.5–2.0), older share 20%, older multiplier 0.85, three wheelchair users at 0.8 m/s, and separate stair ratios. Keep body-size and wheelchair-space requirements. Use **independent, named seeded random streams** for fixed audience traits and dynamic choices, so comparing different interventions on the same audience seed does not resample seats/ages/speeds/group membership.

Recognition and response are distinct lognormal delays (reference medians 6 s and 14 s, both log SD 0.6). There is no separate belongings-retrieval state or arbitrary extra delay based on distance to aisle. Social influence applies to nearby original-seat neighbours during initial recognition, not to distant people throughout the building. Model adjacent groups (roughly half the audience, size distribution 70% pairs, 20% trios, 10% quartets) with at most 20 s coordinated waiting, leader destination following and local speed matching within 4 m when members share a link. Ensure group rules do not invent additional doorway flow capacity.

Expose uncertainty cases for slower walking, more older attendees, slower response, reduced exit knowledge, and lower guidance compliance. These are alternative scenarios, not hidden changes to the reference case.

## Physical movement and congestion

Implement a **finite-capacity, finite-storage, multi-lane queue network**. Each occupant has a current link, direction/lane, remaining walking distance, readiness time, destination and state. Preserve walking length on stairs separately from plan length. Use the headway-based service rule, passage storage and gate specific flows exactly as specified in the LaTeX. If lane count is missing use `max(1, floor(width_m / 0.6))` on physically traversable passages, not arbitrary rounding bonuses. Keep a strict check that occupants fit actual widths.

- Passenger flow obeys source service, destination gate service and receiving-link storage **simultaneously**; congested downstream links cause real spillback.
- Service is fractional-credit based across simulation time steps; unused credits cannot accumulate without limit. Blocked transfers must not consume credits.
- FIFO queue discipline applies within lanes, with consistent deterministic tie-breaking. An agent traverses a positive-length link before it can leave that link; no jumping directly through multiple positive-length edges in one tick.
- Counterflow uses shared integer lanes: one active direction may use all lanes; when both directions are active, allocate lane counts consistently without exceeding physical lanes, and apply the specified older-request tie-break for an extra lane. A one-lane passage does not simultaneously admit opposite-direction users. **Never allocate each direction the full physical capacity or duplicate storage.**
- Door flow is based on `specific_flow * max(0, width - 2*boundary_loss) * environmental_factor`: 1.3 people/(m s) for doors and 1.0 for stairs, boundary losses 0.15 m and 0.09 m respectively. A closed/effectively blocked door has **zero** capacity; no artificial minimum gate width.
- Enforce population conservation, nonnegative occupancy, storage ceilings, accessible route restrictions and valid graph transitions at every step.

Keep the physical engine separate from **perceived** delays. Do not inject arbitrary extra walking slowdowns simply to make an entrance look crowded if capacity and queues already create that delay.

## Route choice and information

Implement the specification's perceived travel-time model: feasible path lengths divided by individual expected speed, with a visible-gate waiting-time term only when a gate and its queue are visible from the person’s position (same floor, within 15 m and with clear geometry). Actual queues and closures beyond sight are **not** magically known. Occupants start knowing the signed exits serving their level, not the true state of remote exterior routes. They can discover blocked links through local observation and receive information from managers/signs.

Keep **persistent random utility** rather than deterministic all-knowing optimization: reference 65% time-oriented and 35% foyer-familiarity-oriented, including the exact utility constants and Gumbel construction in the LaTeX. Each person–exit taste draw is stable across reviews. Reconsider routes at reachable junctions or upon relevant new information, using the specified 8-second improvement rule unless an instructed/known route is infeasible. Route changes occur at connected positions, never through walls or back along an already traversed link without a valid return path.

Do not reintroduce the removed urgency formula, arbitrary occupancy penalties for ordinary aisles, six unsupported rigid behavioural categories, or the old exponential memory machinery.

## Crowd Managers, LEDs, barriers and accessibility

Provide scenario-configurable Crowd Managers with actual posts. Six are the concert minimum, **not a maximum**; lecture cases may have zero. Use the specified 12 m same-floor acoustic radius with wall/open-path obstructions, activation timing, hearing probability and 85% persistent compliance draw. Heard and accepted are distinct events. Accepted instructions may commit feasible exit choices; accessibility always wins. Support an optional advance announcement, plus stationary and valid mobile manager patterns.

Use physical wall signs and walkway LED strips with floor, sightline, orientation, range, detection, acceptance, activation and static/dynamic message rules as defined in the specification. Messages are **public**, not individually tailored. Noticing and complying are persistent person–installation tendencies, not new random lotteries at every frame. Conflict precedence favours accepted feasible manager instructions. Dynamic signs use delayed manager observations (2 s sensing + 3 s delivery), the 8 s improvement test and 20 s holding time. Signs communicate information; they do not increase door capacity.

Temporary barriers are only low belts/ropes/open rails that preserve sightlines. They must change geometry by projected span and physical detour; recalculate path length, usable width, lanes, storage/service and allowed directions accordingly. Do not create an arbitrary service multiplier or extra exit. Preserve a minimum 1.1 m partial bypass in the stated screening rule, retain wheelchair connectivity and mark that rule as **not a building-code certification**.

Two assisted-evacuation teams become available after 60 s; descent has lognormal median 60 s and log SD 0.4. Distinguish the time when an occupant crosses the exterior boundary from later street-level arrival. Include wheelchair users in the 1,329 total and in the primary building-clearance endpoint.

## Interface and deliverables

Make a usable UI, not only a terminal script. Include:

1. A reconstructed map with all floors, seating blocks, walkways, cross-aisles, stairs, doors, exit groups and confidence/assumption labels; toggles for graph edges, widths, zones and visibility rays. The map and physics must use **the same geometry**.
2. Scenario controls for audience, response/speed distributions, six or additional managers, placement, announcements, exit closures, static/dynamic LED strips, and low/open barriers. Validate geometry and constraints immediately when settings change.
3. Play/pause/step/reset, a simulated clock independent of animation playback speed, occupancy/queue coloring, and a person inspector showing fixed traits, awareness, information, accepted guidance, current link and destination, route-review events and exit time.
4. A headless batch analysis view with paired-seed comparisons, exit usage, clearance distributions, median/quantiles, queue maxima, congested links, accessible-exit progress, and success fraction by 180 s. Clearly flag unresolved runs.
5. Save/load of a versioned JSON scenario, replay by seed, and export of results plus event logs. UI and CLI **must run the same engine and agree on same seed/config**.

Produce a `README.md` explaining setup, run commands, model scope, reproducibility, and limitations; `docs/implementation-decisions.md` stating every added computational convention absent from the source; and `docs/validation.md` listing test commands, actual outcomes, performance, geometry confidence and unimplemented limitations. Do not edit the mathematical paper to invent results.

## Tests and experimental integrity

Automated tests must check the following before publishing results:

- Exact audience count, section counts and three wheelchair users; every person accounted for exactly once.
- A 1.8 m corridor yields 3 lanes; counterflow never allocates more than 3 total lanes; one-lane opposing requests do not create simultaneous service.
- Zero-capacity gate when width is less than total boundary losses; a 1.2 m door with 0.15 m loss on each side has 1.17 people/s at q=1.3 in the simplified door formula.
- Repeated short time steps converge to the correct saturated throughput without hoarding fractional idle credits or dropping blocked attempts.
- Downstream spillback, conservation and no negative/free extra storage at junctions.
- The stepped cross-aisle is physically connected for ambulatory people, prohibited for wheelchair routes; no unrelated seat row becomes a through-route.
- Invisible/occluded signs do not transmit their messages; persistent compliance and fixed audience traits survive scenario changes.
- Identical seed/config creates identical full event summaries in CLI and browser; small time-step refinement preserves physical logic.
- Unknown blocked exits become known only through legitimate observation/guidance.
- Out-of-building and street-level endpoints remain distinct, including assisted people.

Use a reference integration step of 0.1 s, plus a refinement case at 0.0125 s. Record the actual integrator and event ordering; do not select a step size because it produces the fastest result. Include a 900 s cutoff: an unfinished run is **unresolved with T > 900 s**, never 0 or Infinity, and is counted in the denominator of the <=180 s success fraction. Do not publish a completion-conditioned mean as if all runs completed. Use common audience seeds when comparing policies; report uncertainty and sample sizes transparently.

Implement and run (where feasible) these named configurations: ordinary concert departure; six-manager concert emergency; alternate manager placements and larger manager counts; familiar student lecture without managers; unknown blocked exit; static LED; dynamic LED; transparent low-barrier layouts; accessible evacuation and assistance; slower-response/low-compliance/older-audience sensitivity cases.

**Complete the task through running the application and test suite, not only file scaffolding.** At the end, provide exact commands and an honest checklist of what passed, what was run, and what could not be validated from available geometry or measurements. Never claim a 180-second result unless reproduced by the engine.
