# Parameters, sources and uncertainty

Status codes:

- **PROBLEM**: stated in the CMCM 2026 problem ("Bail(ey)ing Out").
- **PUBLISHED**: a value reported in the research notes' cited literature. The notes themselves
  warn that every figure must be re-checked against the original reference before it is
  quoted; we have **not** re-verified them against the primary sources.
- **PLAN / DIM**: measured on the scanned floor plans (≈ 0.08 m per pixel) or read from a
  dimension string printed on the seating charts.
- **ASSUMPTION**: our modelling choice. These parameters are exposed in the UI, varied in
  `docs/RESULTS.md` §D, and must not be presented as Bailey Hall facts.

All values can be changed in the UI (left panel or the JSON editor) or with
`npm run batch -- --set path=value`.

## 1. Building and occupancy

| Parameter | Value | Status | Source | Uncertainty |
|---|---|---|---|---|
| Orchestra / mezzanine-loge / balcony seats | 527 / 486 / 316 = 1,329 | PROBLEM | problem text | exact |
| Wheelchair positions | up to 3 (2 shown on the chart behind row EE; third placed next to them) | PROBLEM + ASSUMPTION | problem text; chart p.6 | location of the 3rd |
| Nine auditorium exit doors, all through the mezzanine | D1–D9 | PROBLEM | problem text, plan p.4 | positions ±1 m |
| Six orchestra → mezzanine access points | front corners, mid-side (4'-0"), back aisles | PROBLEM + DIM | problem text, chart p.6 | front/back widths assumed 1.2 m |
| Four corridor → portico side doors | P1–P4 | PROBLEM | problem text | positions ±2 m |
| Three corridor → foyer connections | FC1–FC3, 1.8 m | PROBLEM + PLAN | red arrows p.4 | width ±0.3 m |
| Five foyer exterior doors | F1–F5, 1.8 m | PROBLEM + PLAN | plan p.4 | width ±0.3 m |
| Balcony south stairs | 2 × (2 flights, 2 lanes, 1.7 m, drop 4.2 m) | PROBLEM + ASSUMPTION | problem text, plans p.4–5 | width/rise assumed |
| Balcony stage-side stairwells (to outside) | 1.1 m, 2 storeys | PROBLEM + ASSUMPTION | problem text, plan p.5 | geometry schematic |
| Stage escape routes (first floor) | 1.0 m doors, 1.1 m stairs | PLAN + ASSUMPTION | "Stage Escape Routes" arrows p.4 | schematic |
| Portico stairs | 2 × 1.8 m | PROBLEM + ASSUMPTION | "two narrower staircases" | width ±0.4 m |
| Monumental stair | 5 bands × 3.4 m | PLAN | plan p.4 | not binding |
| Mezzanine doors D1–D9 | 1.6 m clear | ASSUMPTION | door-swing symbols p.4 | ±0.3 m |
| Side doors P1–P4 | 1.6 m clear | ASSUMPTION | door-swing symbols p.4 | ±0.3 m |
| Orchestra aisles / loge cross-aisles / radial aisles | 1.1 / 1.2 / 1.3 m | DIM + ASSUMPTION | chart p.6 ("4'-0"", "4'-5" TYP") | ±0.15 m |
| Row spacing | 0.864 m | DIM | chart p.6 ("2'-10" TYP") | exact |
| Centre orchestra section | 8.23 m (27'-0", 16 × 20" chairs) | DIM | chart p.6 | exact |
| Plan scale | 0.08 m / px (balcony 0.0794) | PLAN | calibrated with 27'-0", 2,602 sq ft corridor, 18,602 sq ft gross area | ±6% |
| Solved seat pitch | 0.48 m (nominal chairs 19–22" = 0.48–0.56 m) | derived | seat counts | reconstruction ~6% short |
| Elevator | present, never usable | PROBLEM | "its use in evacuation scenarios is prohibited" | exact |
| Crowd Managers | ≥ 1 per 250 attendees (6 for 1,329) | PROBLEM | NY State requirement quoted in the problem | minimum |
| Evacuation benchmark | 180 s | PROBLEM | problem text | exact |

## 2. Pre-movement

| Parameter | Concert emergency | Concert departure | Lecture | Status | Source / rationale | Uncertainty |
|---|---|---|---|---|---|---|
| Distribution | lognormal | lognormal | lognormal | PUBLISHED (shape) | Forssberg et al. 2019 (40 unannounced evacuations) | shape well supported |
| Recognition median / σ | 6 s / 0.6 | 2 s / 0.5 | 5 s / 0.6 | ASSUMPTION | house lights, alarm clarity | sweep ×0.5–×2 |
| Response median / σ | 14 s / 0.6 | 10 s / 0.8 | 22 s / 0.7 | ASSUMPTION | longer for students (D'Orazio & Bernardini: high pre-movement, attachment to belongings) | sweep ×0.5–×1.5 |
| Aisle-distance effect β_aisle | 0.04 /m | same | same | ASSUMPTION (direction PUBLISHED) | Galea et al. 2017 (Marlowe theatre) | high |
| Exit-distance effect β_exit | 0.05 per 10 m | same | same | ASSUMPTION (direction PUBLISHED) | Galea et al. 2017 | high |
| Level factor balcony | 1.1 | same | same | ASSUMPTION | - | high |
| Familiarity reduction | 0.15 (log) | same | 0.10 | ASSUMPTION | - | high |
| Belongings / coat probability, median | 0.5, 6 s | 0.9, 20 s | 0.95, 10 s | ASSUMPTION | coats (Ithaca), backpacks/laptops | high |
| Social clock κ | 1.5 | 1.0 | 1.5 | ASSUMPTION (direction PUBLISHED) | Nilsson & Johansson 2009; VR review arXiv 2302.10339 | high |
| Social awareness hazard λ_s | 0.4 /s | same | same | ASSUMPTION | - | high |
| Crowd Manager response factor | 0.5 | - | - | ASSUMPTION | notes: CM announcement shifts the distribution down | high |

## 3. Walking and physical movement

| Parameter | Value | Status | Source | Uncertainty |
|---|---|---|---|---|
| Free walking speed | Normal(1.20, 0.25) m/s truncated [0.5, 2.0]; departure 1.1; students 1.35 (sd 0.2) | ASSUMPTION | typical adult values (Weidmann mean 1.34) | ±0.15 |
| Over-65 share (concert) | 25% (older-audience scenario 60%) | ASSUMPTION | - | wide |
| Over-65 speed factor | 0.78 | PUBLISHED | Thompson, citing Ando et al. 1988 (20–25% slower) | 0.75–0.80 |
| Stair descent ratio | 0.57 adults (≈0.71 m/s), 0.51 elderly (≈0.50 m/s) | PUBLISHED | SFPE Europe, anthropometric data and movement speeds | re-check |
| Seat-row speed | 0.45 m/s | PUBLISHED | Predtechenskii & Milinskii (via lecture-theatre network model) | re-check |
| Squeezing past a seated person | 0.2 m/s | ASSUMPTION | - | ±0.1 |
| Body radius | Normal(0.22, 0.02) m; wheelchair 0.45 m | ASSUMPTION | shoulder width ≈ 0.45 m | ±0.03 |
| Wheelchair speed | 0.8 m/s, no stairs | ASSUMPTION | "Together apart" (arXiv 2311.01236) qualitatively | wide |
| Time headway T_h | 0.7 s (lane capacity ≈ 0.94 p/s) | ASSUMPTION | form of single-file fundamental diagrams | sweep 0.5–1.0 |
| Weidmann γ, ρ_max (optional speed model) | 1.913, 5.4 p/m² | PUBLISHED | Weidmann 1993 | - |
| Counterflow friction c | 0.5 m² | ASSUMPTION | - | wide |
| Lane width / rule | 0.6 m, n = ⌊w/0.6 + 0.2⌋ | ASSUMPTION | - | - |
| Max occupancy of a link | 4.5 p/m² | ASSUMPTION | physical packing limit | - |

## 4. Bottleneck capacities

| Parameter | Value | Status | Source | Uncertainty |
|---|---|---|---|---|
| Door specific flow q | 1.3 p/(s·m) effective width | PUBLISHED | SFPE design value (conservative lower bound, not re-checked); 1.9 normal (Seyfried et al. via Nicolas et al. 2016); 3.3–3.7 competitive (Nicolas et al. arXiv 1610.05909) | sweep 1.0–1.9 |
| Stair specific flow | 1.0 p/(s·m) effective width | ASSUMPTION | order of SFPE stair values | sweep 0.8–1.3 |
| Boundary layer | 0.15 m per side (doors), 0.09 m (handrails) | ASSUMPTION | SFPE effective-width concept | ±0.05 |
| Luggage / coat flow factor | 0.97 emergency, 0.95 departure, 0.92 lecture/winter | ASSUMPTION (direction PUBLISHED) | Deng et al.: 100% suitcases −39%/−47% flow; backpacks/coats assumed much smaller | wide |
| Faster-is-slower g(u, π) | a = 0.15, d = 0.45, θ = 0.35; u = 0.6 emergency, 0 departure, 0.5 lecture | ASSUMPTION (direction PUBLISHED) | Nicolas et al. 2016; Heliövaara et al. 2013 | functional form assumed; testable |
| Impatience by type | 0.85 impatient, 0.10 cooperative, 0.35 others (sd 0.1) | ASSUMPTION | - | - |

## 5. Route choice and knowledge

Multinomial-logit weights per behaviour type (ASSUMPTION; qualitative ordering from the notes:
habit ≈ 71% familiar door (arXiv 2110.11577), familiarity × social interaction (Kinateder &
Warren 2017), queue avoidance at narrow doors only (Kinateder & Warren 2021)):

| Type | w_T time | w_Q queue | w_F familiar | w_S social | w_G guidance | w_I inertia | re-evaluation prob. |
|---|---|---|---|---|---|---|---|
| Shortest-time | 2.4 | 1.2 | 0.3 | 0.3 | 1.0 | 0.8 | 0.8 |
| Habitual | 0.6 | 0.3 | 2.8 | 0.5 | 0.8 | 1.5 | 0.15 |
| Social follower | 0.8 | 0.4 | 0.9 | 2.8 | 1.0 | 1.0 | 0.5 |
| Queue avoider | 1.4 | 2.8 | 0.4 | 0.2 | 1.0 | 0.6 | 0.9 |
| Cooperative | 1.0 | 0.8 | 1.0 | 1.0 | 1.6 | 1.2 | 0.3 |
| Impatient | 2.2 | 0.8 | 0.5 | 0.5 | 0.6 | 0.6 | 0.7 |

| Parameter | Concert | Departure | Lecture | Status | Source |
|---|---|---|---|---|---|
| Type shares (shortest/habitual/follower/queue/coop/impatient) | .20/.35/.25/.10/.05/.05 | .15/.50/.25/.05/.05/0 | .35/.25/.15/.15/.05/.05 | ASSUMPTION | - |
| Knows all emergency exits | 15% | 5% | 90% | ASSUMPTION | students do drills (problem text) |
| Prior knowledge portico / stage / balcony N | 25% / 10% / 35% | 10% / 0% / 5% | 90% / 70% / 90% | ASSUMPTION | - |
| Exit-sign notice probability | 0.38 | 0.05 | 0.38 | PUBLISHED | Galea et al. 2016 (38% perceive conventional signs) |
| Visibility range | 15 m (dark 6 m) | 15 m | 15 m | ASSUMPTION | - |
| Narrow-door queue boost b | 1.5 | same | same | ASSUMPTION (direction PUBLISHED) | Kinateder & Warren 2021 |
| Counterflow route penalty | 3 s per opposing person per lane | same | same | ASSUMPTION | - |
| Obstruction discovery range | 6 m | same | same | ASSUMPTION | J. Stat. Mech. seated-area experiment (qualitative) |
| Word-of-mouth rate | 0.2 /s within 2 m | same | same | ASSUMPTION | - |
| Groups | 50%, sizes 2/3/4 = .7/.2/.1 | 60% | 20% | ASSUMPTION (effects PUBLISHED) | Bode et al. 2015 (groups start later) |

## 6. Guidance

| Parameter | Value | Status | Source | Uncertainty |
|---|---|---|---|---|
| Crowd Manager activation | LogNormal(10 s, 0.5) | ASSUMPTION | - | wide |
| Voice radius / hearing rate | 12 m / 0.35 per s | ASSUMPTION | - | 8–15 m |
| Crowd Manager compliance | 0.80 | ASSUMPTION | calibration data exist (theatre drills, Fire Technology 2018) but were not extracted | sweep 0.5–0.95 |
| Zone → exit plan | balanced by side (stage exits for orchestra front sides, portico for the side zones, foyer for the centre, balcony NW/NE for the straight balcony sides) | ASSUMPTION | - | editable |
| LED perception | 0.9 | ASSUMPTION (PUBLISHED reference) | flashing LED signs detected up to 77% (Filippidis et al. 2021); floor strips assumed more visible | sweep |
| LED compliance | 0.7 (effective redirect 0.63) | PUBLISHED range | Galea et al. improved ADSS trials: 66% redirected; NOT a Bailey Hall value | sweep 0.3–0.9 |
| Conflict hesitation | 4 s | ASSUMPTION | - | wide |

## 7. Stress tests (simplified, not validated)

| Mechanism | Implementation | Status |
|---|---|---|
| Darkness / power failure | speed ×0.85, visibility ×0.4, recognition ×1.3, sign noticing ×0.6 | ASSUMPTION |
| Smoke level s | speed ×(1 − 0.4 s), visibility ×(1 − 0.7 s); Jin / Frantzich–Nilsson relations NOT implemented | ASSUMPTION |
| Winter | coats for everyone, outdoor stairs ×0.7 speed and capacity | ASSUMPTION |
| Falls | per-step probability 0.01 · Δt · max(0, ρ − 0.5) · v on stairs; lane blocked LogNormal(15 s) | ASSUMPTION (direction: Huo et al. 2022; arXiv 2211.08456) |
| Separated groups | 30% of groups have one member in the foyer/corridor | ASSUMPTION |
