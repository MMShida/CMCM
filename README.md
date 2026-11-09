# Bailey Hall evacuation model

This checkout continues Mateus's **8 November 2026, 04:20:42 EST** commit `3e4bcf0`, on branch **bailey-model**.
**A-Lite+ is the primary comparative model.** It preserves the full 1,329-person audience, including three wheelchair users, and the original building walkways. It adds physical LEDs and barrier bypasses, local information, and explicit execution of accepted guidance. A, B, C and original A-Lite remain available.

<!-- PLUS_RESULT_START -->
Finalized at the user’s request using completed cases only. Supplemental ablations, device-isolation comparisons, Q1/Q3 scenario batches, parameter uncertainty, two planned 100-run numerical replays, and the smaller-step diagnostic were not completed. Closure tests are partial. At the prespecified 100-run 0.0125 s step: refined guidance fine (12 managers), 184.45 s [95% CI 182.39–186.51], 32/100 at or below 180. The 100-run 0.0125 s confirmation does not establish a mean below 180 s with a 95% interval wholly below the target. A-Lite+ with six managers gives 190.58 s (95% CI 188.58–192.58) on 100 fresh audiences; 17/100 clear by 180 s and 0 are unresolved. The original six-manager calibration does not demonstrate a mean below 180 seconds. These are research-grounded model predictions, not empirical Bailey validation. The separately declared 1.4 m/s clipped-normal alternative gives 185.63 s (95% CI 183.06–188.21); 38/100 clear by 180 s. Its mean interval does not demonstrate the sub-180 target. The expanded 12-manager policy at 1.4 m/s averages 183.25 s (95% CI 181.20–185.30); 40/100 clear by 180. Its independent mean interval does not demonstrate the sub-180 target.
<!-- PLUS_RESULT_END -->

The target is the **mean of the last person's building-exit time**, across independent audiences. It is not the mean person's exit time or street-level assisted clearance. Research bounds the assumptions; no observed Bailey evacuation dataset is available to claim venue-specific empirical validation.

## Run it in the UI

From this `mateus-0420` directory:

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Open **http://127.0.0.1:5180/?tab=plus**. Other local checkouts may be running on different ports.

1. Choose **A-Lite+**, then a **Tested/catalogue policy**. `selected-six` loads the original six-manager study at 1.2 m/s; `speed-alternative-1.4` loads its separately declared speed alternative. **Load confirmed retuned guidance** selects the completed twelve-manager, 1.4 m/s, 0.0125 s case. Additional-staff policies are labeled separately; the other planned fine-step confirmations were not completed.
2. Check the **Loaded** policy name, seed, time step and staff count above the controls. Inspect the real staff posts, LED arrows/strips and barrier bypasses on the map. The exported configuration includes every placement and parameter.
3. Click **Reset**, then **Start** in the live view. Read **Evacuation time (last person out)** in Run results. The clock may continue for travel and assistance outside the building. Playback speed does not change the model.
4. Open **Compare identical random audiences → Independent confirmation and question results**. Use **Replay first seed**, or choose another listed seed, to reproduce one stored audience.
5. To reproduce a mean, click **Prepare 100-run reproduction** on that result, then **Run matched comparison**. This loads the exact policy, 100 replications and its recorded seed base. One seed will generally differ from the reported mean.
6. To explore, edit signs, draw strips along existing walkways, change barrier slots or load a staffing/patrol variant. Select **Current editor** in the comparison panel and compare it with a reference using the same random audiences. Export the configuration and results. Invalid physical layouts are rejected.

Changing a physical parameter is a new calibration sensitivity. The concert's original free-speed mean is **1.2 m/s before age adjustment**; **1.35 m/s belongs to the lecture preset**. The declared 1.4 alternative retains the older share/factor, wheelchair speed, row cap, headway, capacities and response. The optional right-skew family matches pre-clipping mean and standard deviation; right skew does not make everyone faster.

## Documents and evidence

- [Technical model, derivations, calibration ledger and UI instructions](docs/research-180/MODEL_GUIDE.pdf)
- [Results, placements, five competition questions, costs and changes from 04:20](docs/research-180/RESULTS_AND_CHANGES.pdf)
- [Implementation prompt for another AI: LaTeX source](docs/research-180/latex/IMPLEMENTATION_PROMPT.tex) and [PDF](docs/research-180/IMPLEMENTATION_PROMPT.pdf)
- [Executive summary](docs/research-180/EXECUTIVE_SUMMARY.md)
- [Original A-Lite transport specification and historical audit](docs/research-180/SIMPLIFICATION_AUDIT.pdf)
- [Problem constraint ledger](docs/research-180/CONSTRAINTS.md)
- [Editable native LaTeX sources](docs/research-180/latex/README.md)
- [A-Lite+ experiment protocol and reproduction](results/plus-study/README.md)
- [Earlier route study](results/route-study/README.md) and [six-manager placement study](results/placement-study/README.md)

The PDFs use native LaTeX equations and vector diagrams. Raw experiments are losslessly compressed; source snapshots are deduplicated and indexed in `results/research-artifacts.json`. Runnable policy JSON remains readable. Restore a study's missing raw files without overwriting local reruns:

```sh
python3 scripts/restore-research-data.py --only results/plus-study/
```

## Command-line reproduction and verification

```sh
# One audience: use an individual seed from the results table.
npm run plus -- --config results/plus-study/selected-config.json --seed 42 --out /tmp/plus-one.json

# Original selected policy, exact 100-run confirmation seed base.
npm run plus -- --config results/plus-study/selected-config.json --runs 100 --seed 73101 --workers 4 --out /tmp/plus-confirmation.json

# Declared speed alternative, same confirmation audiences.
npm run plus -- --config results/plus-study/speed-alternative-config.json --runs 100 --seed 73101 --out /tmp/plus-speed.json

# Expanded staffing policy, its independent confirmation audiences.
npm run plus -- --config results/plus-study/staff-expanded-config.json --runs 100 --seed 73403 --out /tmp/plus-staff.json

# Final operational retuning, declared finest step and new confirmation audiences.
npm run plus -- --config results/plus-study/guidance-refined-fine-config.json --runs 100 --seed 73503 --workers 4 --out /tmp/plus-retuned.json

npm test
npm run build
python3 scripts/build-latex-docs.py --compile
python3 scripts/check-research-pdfs.py
```

The PDF build requires Python with PyMuPDF and Tectonic. Browser checks require Chrome and the running Vite server. Local logs, cache files, interrupted prototypes and restored raw duplicates are excluded from GitHub.

## What each model does

| Model | Role | Main limitation |
|---|---|---|
| **A-Lite+** | Primary individual simulation on the detailed graph: finite queues, conservative service, local decisions, physical guidance and barriers | Queue positions and staff bodies are not collision-resolved; transferred parameters need Bailey measurements |
| **A** | Mateus's spatial rows, gaps, lanes and social movement | More detail does not establish local calibration; spatial constraints can prolong the tail |
| **A-Lite** | Original detailed-graph queue transport and inherited decisions | Permanent group pacing and utility-based guidance differ from Plus |
| **B** | Contracted network queue simulation | Optimistic storage relief and omitted spatial interactions can shorten predictions |
| **C** | Static max flow and time-expanded ideal flow benchmark | Optimized representative-speed flow is not attainable human behavior; flow calculation excludes wheelchair users |

A-Lite+ is network-based, but it does not solve a max-flow problem to force people into optimal routes. Individuals use perceived travel/wait costs, knowledge, persistent preferences and guidance. An accepted feasible manager instruction commits a destination; physical turns happen at connected junctions. Public signs carry one message for everyone. Dynamic updates use delayed local/radio information.

Low belts and open rails consume corridor width or close an existing slot. Partial devices leave an explicit accessible bypass and detour. They do not receive a capacity bonus or an arbitrary perceived-time penalty. No model permits crossing seat backs; a person leaves their own seatway before following connected aisles, corridors and stairs.

Additional managers use explicit posts and incur separate costs. Optional patrols follow wide, level, connected links and wait on occupied segments. Their limited information-coverage model does not resolve staff–crowd contact, so it remains an explicitly qualified sensitivity.

## Historical numbers and legacy controls

The earlier **230.1 s A / 194.2 s Lite / 182.6 s B** figures are 40-audience means for a specific six-manager combined policy, not default-seed outputs. The subsequent Lite route study reports separate 60-audience results. These studies used different instruction and rope-barrier semantics and remain in the **Research study** tab.

Load a legacy scenario explicitly before using A/B/C/Lite. The UI prevents silently running an A-Lite+ physical-installation configuration in an incompatible legacy view. The older model specifications remain in [MODEL.md](docs/MODEL.md), [NETWORK_MODEL.md](docs/NETWORK_MODEL.md), [ADAPTIVE.md](docs/ADAPTIVE.md) and [PARAMETERS.md](docs/PARAMETERS.md).

## Code map

| Directory | Contents |
|---|---|
| `src/plus/` | Primary Plus movement, guidance, decisions, physical installations, optional patrols and calibration ledger |
| `src/lite/` | Conservative detailed-graph transport underlying Plus |
| `src/simulation/` | Shared population, response, routing, original A and statistics |
| `src/network/` | B and C |
| `src/geometry/`, `src/data/geometry/` | Reconstructed Bailey geometry and navigation graph |
| `src/components/`, `src/workers/` | Existing React UI, placement editor, live inspector and batch workers |
| `scripts/plus-*.ts`, `scripts/plus-*.py` | Declared study, analyses, maps and reports |
| `tests/` | Physical, behavioral, numerical and legacy regression checks |

No calibrated fire/smoke tenability or injury model is implemented. The evidence supports comparison under stated assumptions, not certification of real-world evacuation safety. Hardware installation and operational plans require venue and Fire Marshal review.
