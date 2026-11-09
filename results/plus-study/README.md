# A-Lite+ reproducible study

**Closed early at the user’s request.** The published snapshot contains 2,430 completed replications; `finalization-status.json` lists every completed case. Supplemental ablations, isolated device comparisons, Q1/Q3 scenario batches, general parameter uncertainty, two additional 100-run fine-step replays and the 0.00625 s diagnostic were not run. Closure batches are partial (7/11 expanded-staff cases and 3/6 retuned cases). The protocol table below is the declared plan, not a claim that all phases finished. The retuned 100-run 0.0125 s result is 184.45 s (95% CI 182.39–186.51); sub-180 is not demonstrated.

This is the primary study accompanying `docs/research-180/MODEL_GUIDE.pdf` and `RESULTS_AND_CHANGES.pdf`. It preserves the full 1,329-person audience, including three wheelchair users, and the reconstructed Bailey walkway geometry. Six managers define the original comparison. Later speed and additional-staff studies are separate, explicitly declared alternatives.

The result is the last audience member's exterior building crossing. All runs, including unresolved audiences, remain in the records. A finite successful mean requires every run to complete. Street-level assistance is a different endpoint. Research transfer and computational checks do not constitute empirical Bailey validation.

## Protocol and seed bases

| Phase | Base | Audiences per policy | Purpose |
|---|---:|---:|---|
| Physical calibration | — | — | `calibration-freeze.json`; descriptive correction in `calibration-errata.json` |
| Staff/device screen | 73001 | 4 | 48 operational layouts |
| Block-instruction optimization | 73003 | 6 | 65 plans; blocks selected from training tail only |
| Independent selection | 73002 | 16 | Select original six-manager and combined-device roles |
| Initial extra-staff selection | 73004 | 16 | Ten/twelve-manager comparison |
| Original confirmation | 73101 | 100 | Frozen roles, no further operational fitting |
| Mechanism ablations | 73201 | 16 | One mechanism at a time |
| Device comparisons | 73202 | 20 | Paired physical LEDs/barriers |
| Obstructions | 73203 | 20 | Unknown closures, messages and matched no-barrier controls |
| Q1 / Q3 scenarios | 73204 | 20 | Ordinary departure / knowledgeable student audience |
| Parameter sensitivities | 73205 | 12 | Uncertain transferred calibration, not winner selection |
| Numerical refinement | 73206 | 20 | Four time steps, frozen operational plan |
| Passive physical audit | 73207 | 2 | Each selected/combined/blocked audit case |
| Speed sensitivity | 73301 | 20 | Matched mean/family comparisons |
| Declared 1.4 m/s confirmation | 73101 | 100 | Same policy and audiences as original confirmation |
| Expanded-staff screen | 73401 | 8 | 25 fixed/adaptive/patrol policies at declared 1.4 m/s |
| Expanded-staff selection | 73402 | 16 | Four training finalists |
| Expanded-staff confirmation | 73403 | 100 | Selected staff policy, its 1.2 counterpart and six-manager control |
| Expanded-staff robustness | 73404 | 20 | Refinement, closures, no barriers and matched stationary posts |
| Staff physical audit | 73407 | 2 | Expanded, patrol and blocked cases |
| Final guidance search | 73501 | 8 | Inherited + four side-zone patterns + one sweep over eight non-side tail blocks |
| Final guidance selection | 73502 | 20 | Three policies; physical calibration unchanged |
| Final guidance confirmation / finest step | 73503 | 100 | Frozen winner at 0.1 and 0.0125 s |
| Final guidance closure / audit | 73504 / 73507 | 12 / 2 | Paired barriers under three closures; passive audits |
| Final 0.0125 s confirmation | 73101 / 73403 | 100 | Declared only; not completed |

Seed bases initialize the repository's seeded generator; they are not the individual audience seeds. Exact seed arrays are stored with every batch. Reuse within a comparison is intentional for paired differences. Operational selection and its confirmation audiences are independent. The finer-step comparison intentionally reuses each policy's original holdout audiences.

## Files and reproduction

- `*-protocol.json`, `selection*.json` and `staff-expansion-selection.json` record decisions made before their subsequent outcomes.
- `selected-config.json`, `speed-alternative-config.json`, `staff-expanded-config.json` and `*-fine-config.json` are complete runnable configurations.
- `*.json.gz` and `opt-Plus-trials.jsonl.gz` retain every raw experiment and optimization trial, losslessly compressed. Local raw copies are ignored by Git.
- `comparisons.csv` provides compact statistics. The UI's `public/results/plus-study.json` is a presentation extract, not the full data archive.
- `physical-audit.json` and `staff-physical-audit.json` check connected paths, storage, service and population conservation. Staff audits also check finite speed and empty-link movement.
- `barrier-criterion.json` / `barrier-assessment.json` state and apply the limited 5 s material-harm closure screen. It is not an engineering safety standard.
- Visibility, optional-extension and final-performance parity records verify unchanged archived outcomes after computational acceleration.
- Source snapshots are deduplicated in `results/source-snapshots`, mapped by `results/research-artifacts.json`. Batch hashes identify the sources used, including earlier numerically equivalent implementations.
- `layouts.json` is an ignored figure-build intermediate, regenerated from the runnable policies by `plus-export.ts`; repeated copies of the full building geometry are not published.

```sh
# Restore raw study records only when needed.
python3 scripts/restore-research-data.py --only results/plus-study/

# One audience; replace 42 with an exact recorded audience seed.
npm run plus -- --config results/plus-study/selected-config.json --seed 42 --out /tmp/plus-replay.json

# Reproduce a complete independent comparison (100 original-calibration audiences).
npm run plus -- --config results/plus-study/selected-config.json --seed 73101 --runs 100 --workers 4 --out /tmp/plus-confirmation.json
```

For the UI, open `http://127.0.0.1:5180/?tab=plus`, load a saved policy, then reset and select a recorded seed. **Prepare 100-run reproduction** restores the saved policy's seed base and batch size. The confirmed fine-step buttons load the final 0.0125 s policies directly. A single seed's live time is not the study mean.

`plus-study.ts`, `plus-next.ts`, `plus-supplement.ts`, `plus-speed-study.ts`, `plus-staff-expansion.ts` `plus-final-resolution.ts` and `plus-refine-guidance.ts` implement the staged experiments. `plus-report.py` refuses incomplete suites and builds the tables, figures and UI extracts. `build-latex-docs.py` produces native LaTeX PDFs. `archive-study.py plus-study` is run only after experiments finish; it verifies compressed bytes and updates the artifact manifest. Historical A/B/Lite studies remain available separately.

To rebuild the finalized partial report and verify every available completed case:

```sh
python3 scripts/check-plus-study.py --available
python3 scripts/plus-report.py --available
python3 scripts/build-latex-docs.py --compile
```
