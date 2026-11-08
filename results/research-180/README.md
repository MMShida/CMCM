# Original 180-second intervention study

The final comparisons are in `summary.json` (or its compressed form), `ALL_COMPARISONS.csv`, and `docs/research-180/RESULTS_AND_CHANGES.pdf`. Complete runnable confirmation configurations are retained as readable JSON. Large raw simulation records and optimizer trials are losslessly gzip-compressed. Run `python3 scripts/restore-research-data.py --only results/research-180/` before analysis scripts that expect the original JSON paths.

Exact source snapshots are shared by hash under `../source-snapshots/`. The manifest `../research-artifacts.json` records original paths and SHA-256 checksums. Checkpoints, launch copies and session completion markers are not part of the published evidence.

These are historical experiments. Panel configurations are not installation recommendations. The subsequent no-barrier A-Lite study is in `../lite-study/`.
