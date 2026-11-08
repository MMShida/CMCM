# Exactly six managers: devices, constraints and reproduction

This study addresses original problem Questions 2 and 4. Full house remains 1,329 including three wheelchair users; staff count is exactly six. Original geometry, capacities, response, speeds, compliance and groups are fixed within each model. A-Lite retains its documented movement/group simplifications.

The preselected combined plan is `coverage-decision-rope1`: six coverage posts, 24 m of physical floor strips in twelve segments, and W1/E1 ropes. Forty independent audiences give A 230.0875 s, A-Lite 194.2075 s, B 182.6125 s. No under-180 mean is established. The overall training winner, `decision-none-rope1`, uses no LEDs and is also reported, including its poorer confirmation mean. We do not choose a winner by looking at holdout outcomes.

## Evidence and seeds

- `screen-cases.json`, `screen.json.gz`: 84 combinations, 4 training audiences each, base 61006.
- `shortlist-cases.json`, `shortlist.json.gz`: 13 retained representatives plus 4 zone-control variants, 12 training audiences each, base 61007.
- `selection.json`: candidates frozen before holdout; both overall and combined-device roles retained.
- `confirmation-cases.json`, `confirmation.json.gz`: paired controls, 40 audiences each, base 61106.
- `combined-config.json`: current default Lite CLI input. First confirmation seed 1466857514 gives 219.0 s, not the 194.2075 s mean.
- `blocked-cases.json`, `blocked.json.gz`: open/F3 blocked pairs, 12 audiences, base 61206; initially local discovery. `blocked-verification.json` separately checks exact times, 1,329 outside and zero F3 passages for all 36 combined-plan blocked runs across A/B/Lite.
- `visibility-cases.json`, `visibility.json.gz`: 6 m range and 0.60 notice probability, each against an unchanged same-seed control; 12 audiences, base 61306.
- `comparisons.csv`: every new experiment's summary. There are 1,200 new simulation replications, excluding verification reruns.
- `reproduction-audit.json`: all 1,000 previously published main A/B/Lite confirmation runs match numerical outputs; machine-dependent runtime excluded. It preserves the known corrected-A failure rather than dropping it.
- `browser-verification.json`, `browser-placements.json`: actual browser live configuration/seed parity and exact 40-run worker replays (historical A and current Lite).
- `verification.json`: test/build/document checks and hashes.

Device locations and endpoints are in each full configuration. Managers use the unchanged `Placements.ts` coordinates; installed strip polylines lie on existing links. Barriers are only existing corridor slots. Staff-body obstruction, heads/luminance in strip visibility and real installation feasibility remain uncalibrated.

The blocked F3 case speeds the combined plan in Lite while slowing A. Lite's foyer demand falls from 650.6 to 605.6 people. This is a model-dependent routing/queue response, not a capacity increase or a reason to close an exit.

## Reproduce

Run from `mateus-0420`:

```sh
node --import tsx scripts/verify-published-study.ts --workers 4
node --import tsx scripts/verify-placements.ts
npm run lite -- --seed 1466857514 --out /tmp/six-manager-run.json
node --import tsx scripts/lite-study.ts --cases results/placement-study/confirmation-cases.json --out /tmp/six-confirmation.json --runs 40 --seed 61106 --workers 4
python3 scripts/placement-report.py
python3 scripts/build-latex-docs.py --compile
python3 scripts/check-research-pdfs.py
```

To rerun the entire search, generate cases with `placement-cases.ts`, run `lite-study.ts` on those cases with 4 runs and base 61006 into `screen.json`, then run `placement-followup.py`. That script waits for a complete screen, evaluates its shortlist, freezes choices, and runs confirmation and robustness. It does not retune from confirmation results.

Large data are compressed without loss; exact source versions are in `../source-snapshots/`, indexed by `../research-artifacts.json`. `restore-research-data.py --only results/placement-study/` restores only missing raw files. Report builders can read compressed files directly. Restored records, source duplicates, local logs and build intermediates are excluded from GitHub.
