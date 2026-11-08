# Historical A-Lite staffing/simplification study evidence

The current exactly-six-manager LED/barrier comparison is in [../placement-study](../placement-study/README.md). Its combined configuration is now the default Lite CLI input. The eighteen-staff files here preserve the earlier study unchanged.

Reference: Mateus's commit `3e4bcf0`; original A remains the default engine. The final technical report is `docs/research-180/SIMPLIFICATION_AUDIT.pdf`.

## Retained data

- `best-config.json`, `selection.json`: complete no-barrier eighteen-staff policy frozen before holdout inspection; training base 9001.
- `confirmation.json.gz`: all nine A/B/Lite configuration rows on forty independent audiences, base 20261109. Includes corrected A's unresolved run. `comparisons.csv` provides readable statistics and paired differences.
- `blocked.json.gz`, `blocked-open.json.gz`: twelve matched fresh audiences, base 20261110, F3 closed versus open.
- `calibration.json.gz`: six headway/row-speed cells, twelve matched training audiences in A and Lite. `best-calibration.json` (or its `.gz` form) varies headway under the selected policy. These are calibration hypotheses, not guidance gains.
- `convergence.json.gz`, `fine-step.json.gz`: three-seed A/corrected-A/Lite step checks and forty-audience Lite confirmation at 0.05 and 0.025 s. The policy was not reselected.
- `runtime.json`: single-process warm-up and rotating-order runtime comparison.
- `lane-screen`, `refine`, `staff`, `shortlist`, `final-shortlist`, and final lane/manager/staff18 optimization records: supporting training comparisons. Every final-formulation optimizer evaluation is retained in compressed JSONL.
- `../mechanism-audit/`: numerical fixtures, A ablations, corrected-A failure state, final A/Lite and historical refined-A traces, and final test/build logs.
- `verification.json`, `pdf-validation.json`, and `../research-180/browser-validation.json`: source/geometry hashes and verification evidence.

Repeated source snapshots are consolidated by their recorded hash in `../source-snapshots/`. `../research-artifacts.json` lists compressed datasets, original paths, byte counts and SHA-256 hashes. Compression preserves the exact data bytes.

## Restore and reproduce

```
python3 scripts/restore-research-data.py
```

Run from the repository root. The command restores missing original JSON/JSONL paths and preserves existing reruns. Restored files are ignored by Git. Use `--only results/lite-study/` to limit restoration. Python report builders read compressed data directly. The simulation CLI accepts the retained readable configuration JSONs without restoration.

Rejected prototypes, obsolete single-FIFO development outputs, checkpoints, completion markers, duplicate summaries, screenshots and browser-print wrappers are excluded from GitHub. They are not used as final-model evidence. The earlier correction batch contains a Lite row from the single-FIFO development variant; the report uses its A rows only.

## Outcome

Nominal-step Lite: 191.44 s [188.3,194.6], 6/40 by 180. Finer 0.025 s step: 188.72 s [186.2,191.2]. Neither establishes the target. Same-policy A: 259.04 s; B: 166.44 s. Corrected instant-acceleration A: 211.01 s, explicitly a structural sensitivity.

Rebuild native LaTeX PDFs with `python3 scripts/build-latex-docs.py --compile`; validate with `python3 scripts/check-research-pdfs.py`. Editable sources and vector figures are under `docs/research-180/latex/`.
