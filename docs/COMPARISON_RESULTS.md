# Model comparison results (generated)

Generated 2026-11-07T18:44:31.565Z by `npm run compare` (cli); 15 paired seeds per cell (base seed 2026); models A, B.
A = detailed agent-based simulator, B = network behavioural simulator, C = ideal time-expanded network flow (benchmark).
Values are mean [95% CI]; P(T <= 180 s) with Wilson 95% interval; * = paired difference whose 95% CI excludes 0.

> All numbers are model outputs under the documented assumptions (docs/PARAMETERS.md, docs/NETWORK_MODEL.md); they do not demonstrate regulatory compliance or real-world safety.
> A and B use identical audiences for each seed (shared createPopulation); each engine uses separate random streams for its own dynamics.
> B - A mixes spatial representation, collision rules, queue implementation, geometry simplification, time step and speed model; it is not a pure behavioural effect.
> Model C is an idealised benchmark: perfectly coordinated routing at the representative free walking speed on the same graph and capacities as Model B.

## 1. Baseline: Concert emergency (6 Crowd Managers) (30 paired seeds)

| Metric | Model A | Model B | Model C |
|---|---|---|---|
| Evacuation time T (s) | 299.4 [290.3, 308.4] | 243.1 [235.0, 251.2] | T*: 101 (ready at 0), 176 [161, 190] (sampled pre-movement) |
| Median / SD of T (s) | 300.7 / 24.2 | 244.1 / 21.7 | |
| 95th percentile of T across runs (s) | 336.5 | 276.7 | |
| P(T <= 180 s) | 0% [0, 11] | 0% [0, 11] | 100% [89, 100] (t=0), 67% [49, 81] (pre) |
| p95 individual exit time (s) | 224 [221, 228] | 177 [176, 179] | |
| Mean queue time per person (s) | 20.4 [19.8, 20.9] | 35.6 [35.2, 35.9] | |
| Largest queue (persons), most frequent location | 177 (Access E3 (back aisle)) | 41 (BSDE (door 20002)) | |
| Unresolved runs | 0% | 0% | |
| Exit usage (mean persons) | FOYER 740, PORTICO_W 204, PORTICO_E 201, STAGE_W 49, STAGE_E 47, BAL_NW 44, BAL_NE 43 | FOYER 774, PORTICO_W 197, PORTICO_E 195, STAGE_W 45, STAGE_E 44, BAL_NW 36, BAL_NE 38 | FOYER 489, PORTICO_W 298, PORTICO_E 298, STAGE_W 62, STAGE_E 62, BAL_NW 60, BAL_NE 60 |

Static max flow F* = 17.18 persons/s versus the 7.38 persons/s needed on average to evacuate 1329 people in 180 s; N/F* = 77 s (a rate statement, not an evacuation time). Minimum cut: BNE door (0.96), BNW door (0.96), P1 (1.79), P2 (1.79), P3 (1.79), P4 (1.79), FC1 (2.06), FC2 (2.06), FC3 (2.06), Stage escape door E (0.96), Stage escape door W (0.96).

### Paired decomposition (same seeds)

| Difference | Mean [95% CI] (s) | n |
|---|---|---|
| B - A (model structure + behaviour representation) | -56.2 [-68.3, -44.2] * | 30 |
| A - C_A (decentralised routing/movement in A, same departures) | 100.9 [91.4, 110.5] * | 30 |
| B - C_B (decentralised routing/queuing in B, same graph and departures) | 127.9 [119.7, 136.1] * | 30 |
| C_B - C_pre (social/group/guidance effects on departures) | -60.4 [-75.2, -45.6] * | 30 |
| C_pre - C_imm (cost of sampled pre-movement) | 74.7 [60.0, 89.4] * | 30 |

## 2. Interventions (30 paired seeds per configuration)

| Configuration | A: T (s) | B: T (s) | C: T* t=0 / pre (s) | A: P(T<=180) | B: P(T<=180) | F* (p/s) | T*_imm (s) |
|---|---|---|---|---|---|---|---|
| 1. Concert emergency, no guidance (baseline) | 365 [353, 377] | 263 [254, 272] | 101 / 176 | 0% [0, 11] | 0% [0, 11] | 17.18 | 101 |
| 2. + Crowd Managers (6) | 299 [290, 308] | 243 [235, 251] | 101 / 176 | 0% [0, 11] | 0% [0, 11] | 17.18 | 101 |
| 3. + LED guidance (with CMs) | 293 [282, 303] | 233 [229, 238] | 101 / 176 | 0% [0, 11] | 0% [0, 11] | 17.18 | 101 |
| 4. + corridor barriers W1/E1 (with CMs) | 290 [277, 302] | 238 [230, 245] | 101 / 176 | 0% [0, 11] | 0% [0, 11] | 17.18 | 101 |
| 5. CMs + LED + barriers | 292 [280, 304] | 235 [228, 242] | 101 / 176 | 0% [0, 11] | 0% [0, 11] | 17.18 | 101 |
| 6. One blocked exit (FC2, discovered) | 282 [274, 289] | 251 [244, 259] | 102 / 176 | 0% [0, 11] | 0% [0, 11] | 15.12 | 102 |
| 7. Lecture, no Crowd Managers | 350 [329, 370] | 280 [271, 289] | 105 / 318 | 0% [0, 11] | 0% [0, 11] | 16.07 | 105 |

Paired effects versus configuration 1 (no guidance), negative = faster:

| Configuration | A: delta T | B: delta T | A: delta p95 exit | B: delta p95 exit | A: top bottleneck | B: top bottleneck | min cut (C) |
|---|---|---|---|---|---|---|---|
| 2. + Crowd Managers (6) | -65.6 [-81.5, -49.7] * | -19.7 [-31.2, -8.2] * | -61.1 [-66.4, -55.9] * | -33.0 [-34.8, -31.1] * | Access E3 (back aisle) | BSDE (door 20002) | BNE door, BNW door, P1, P2, P3, P4, FC1, FC2, FC3, Stage escape door E, Stage escape door W |
| 3. + LED guidance (with CMs) | -72.5 [-87.2, -57.7] * | -29.8 [-38.0, -21.6] * | -62.1 [-66.9, -57.3] * | -35.1 [-37.0, -33.3] * | Access E3 (back aisle) | BSDE (door 20002) | BNE door, BNW door, P1, P2, P3, P4, FC1, FC2, FC3, Stage escape door E, Stage escape door W |
| 4. + corridor barriers W1/E1 (with CMs) | -75.1 [-92.4, -57.9] * | -25.3 [-34.8, -15.8] * | -67.7 [-72.0, -63.5] * | -35.1 [-36.9, -33.4] * | Access E3 (back aisle) | BSDW (door 20001) | BNE door, BNW door, FC1, FC2, FC3, D1, D2, D8, D9, Stage escape door E, Stage escape door W |
| 5. CMs + LED + barriers | -73.3 [-90.1, -56.5] * | -27.5 [-37.4, -17.5] * | -65.9 [-70.9, -60.8] * | -37.5 [-39.3, -35.7] * | Access E3 (back aisle) | BSDE (door 20002) | BNE door, BNW door, FC1, FC2, FC3, D1, D2, D8, D9, Stage escape door E, Stage escape door W |
| 6. One blocked exit (FC2, discovered) | -83.4 [-98.3, -68.5] * | -11.4 [-22.7, -0.1] * | -62.6 [-66.6, -58.6] * | 3.5 [1.4, 5.5] * | Access E3 (back aisle) | BSDE (door 20002) | BNE door, BNW door, P1, P2, P3, P4, FC1, FC3, Stage escape door E, Stage escape door W |
| 7. Lecture, no Crowd Managers | -15.3 [-41.5, 11.0] | 17.3 [4.6, 30.1] * | -84.7 [-89.1, -80.4] * | -14.4 [-16.0, -12.9] * | Access E3 (back aisle) | BSDE (door 20002) | BNE door, BNW door, P1, P2, P3, P4, FC1, FC2, FC3, Stage escape door E, Stage escape door W |

## 3. Occupancy, legal Crowd Manager minimum (30 paired seeds per level)

| Occupancy | N | A: T (s) | B: T (s) | B - A (s) | C: T*_imm | C: T*_pre | A: P(T<=180) | B: P(T<=180) |
|---|---|---|---|---|---|---|---|---|
| 10% | 134 | 143 [134, 153] | 138 [129, 148] | -5.0 [-19.1, 9.0] | 45 | 130 [121, 139] | 87% [70, 95] | 90% [74, 97] |
| 25% | 333 | 154 [144, 164] | 144 [137, 151] | -10.1 [-20.4, 0.2] | 48 | 147 [133, 161] | 83% [66, 93] | 93% [79, 98] |
| 50% | 665 | 191 [181, 201] | 172 [163, 182] | -18.9 [-30.4, -7.4] * | 63 | 155 [143, 166] | 40% [25, 58] | 80% [63, 90] |
| 75% | 997 | 238 [231, 245] | 201 [194, 208] | -36.9 [-45.8, -28.0] * | 81 | 180 [159, 200] | 0% [0, 11] | 13% [5, 30] |
| 100% | 1329 | 299 [290, 308] | 243 [235, 251] | -56.2 [-68.3, -44.2] * | 101 | 176 [161, 190] | 0% [0, 11] | 0% [0, 11] |

## 4. Sensitivity, one factor at a time, paired with the baseline (15 seeds per level)

| Factor | Level | A: delta T (s) | B: delta T (s) | C: F* (p/s) | C: T*_imm (s) |
|---|---|---|---|---|---|
| baseline | base | 300 [285, 314] (T) | 240 [227, 253] (T) | 17.18 | 101 |
| Door clear widths (all doors) | x0.8 | -5.9 [-30.2, 18.3] | 20.5 [6.0, 35.1] * | 12.84 | 118 |
| Door clear widths (all doors) | x1.2 | -4.0 [-20.0, 11.9] | 2.1 [-14.4, 18.5] | 20.47 | 101 |
| Stair / access-point widths | x0.8 | 43.8 [21.9, 65.7] * | 15.2 [0.3, 30.1] * | 16.29 | 126 |
| Stair / access-point widths | x1.2 | -17.8 [-34.7, -0.9] * | 7.2 [-5.0, 19.3] | 17.18 | 92 |
| Door specific flow (p/(s m)) | 1.0 | 0.2 [-15.8, 16.3] | 16.1 [-1.2, 33.4] | 13.22 | 115 |
| Door specific flow (p/(s m)) | 1.6 | -0.8 [-23.7, 22.1] | -4.0 [-14.2, 6.2] | 20.30 | 101 |
| Stair specific flow (p/(s m)) | 0.8 | 5.1 [-10.1, 20.3] | 15.9 [0.4, 31.5] * | 16.45 | 122 |
| Stair specific flow (p/(s m)) | 1.3 | -22.2 [-41.8, -2.6] * | -13.9 [-29.5, 1.6] | 17.18 | 92 |
| Reaction times (recognition + response medians) | x0.5 | 3.5 [-20.4, 27.3] | -0.7 [-22.5, 21.1] | 17.18 | 101 |
| Reaction times (recognition + response medians) | x1.5 | -2.3 [-22.6, 18.0] | 11.2 [-7.4, 29.7] | 17.18 | 101 |
| Exit preference (share of habitual decision makers) | 0.15 | -13.9 [-32.4, 4.5] | 1.2 [-15.7, 18.1] | 17.18 | 101 |
| Exit preference (share of habitual decision makers) | 0.55 | -0.8 [-16.2, 14.7] | -2.1 [-17.6, 13.3] | 17.18 | 101 |
| Crowd Manager compliance | 0.5 | 8.6 [-14.7, 31.9] | 6.6 [-12.6, 25.7] | 17.18 | 101 |
| Crowd Manager compliance | 0.95 | -16.1 [-34.7, 2.6] | 5.0 [-8.6, 18.6] | 17.18 | 101 |
| Mean walking speed (m/s) | 1.0 | 4.4 [-15.4, 24.3] | 12.2 [-0.5, 24.9] | 17.18 | 104 |
| Mean walking speed (m/s) | 1.4 | -18.9 [-47.7, 9.9] | -3.7 [-25.4, 18.0] | 17.18 | 99 |
| Crowd Manager effectiveness (voice range, response factor) | weak | 18.5 [-1.2, 38.3] | -2.7 [-17.4, 12.1] | 17.18 | 101 |
| Crowd Manager effectiveness (voice range, response factor) | strong | -2.1 [-18.6, 14.3] | -4.5 [-34.6, 25.7] | 17.18 | 101 |
