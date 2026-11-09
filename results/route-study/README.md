# Historical original-Lite route study

This study precedes A-Lite+. It keeps six managers and the full 1,329-person audience. Its rope crossing penalties and utility-based instructions are **not** the physical bypass and committed-instruction mechanisms in Plus.

The overall validation-selected policy averaged **186.87 s** in Lite on 60 independent audiences (A 212.39; B 183.41). The separately selected combined-device policy averaged **188.83 s** in Lite (A 214.87; B 179.47). The finest declared 0.0125 s step gives **186.84** and **190.45 s**, respectively. These results do not establish the Lite 180-second target.

- `opt-Lite-trials.jsonl.gz`: all 217 evaluated instruction plans, eight training audiences each.
- `screen.json.gz`: 84 placement/device candidates, eight audiences each.
- `validation.json.gz`: eight candidates, 24 separate validation audiences each.
- `selection.json`, `overall-selection.json`: roles fixed before opening their holdout results.
- `selected-config.json`, `overall-config.json`: complete runnable policies.
- `confirmation.json.gz`, `overall-confirmation.json.gz`: 60-audience model comparisons, base 62106.
- `resolution-protocol.json`, `resolution.json.gz`: finest-step re-evaluation of the same policies and 60 audiences.
- `robustness.json.gz`: paired guidance/device, closure and visibility sensitivities, 20 audiences per case.
- `questions.json.gz`: earlier ordinary/lecture scenarios; the later Plus lecture explicitly implements the brief's complete exit knowledge.
- `walkway-audit.json`: 15 A/Lite audits, 301,722 transitions and 20,333,750 occupied-position checks, zero forbidden transitions.
- `comparisons.csv`: compact summaries; raw records retain failures and exact seeds.

To restore raw records and reproduce a single Lite audience:

```sh
python3 scripts/restore-research-data.py --only results/route-study/
npm run lite -- --config results/route-study/overall-config.json --seed 42 --out /tmp/lite-replay.json
```

`route-followup.ts`, `route-overall.ts` and `route-report.py` contain the original search/analysis. The historical report builder writes this study’s own `REPORT.md` and historical UI extract. Source versions are deduplicated under `results/source-snapshots`, indexed by `results/research-artifacts.json`. Raw local copies, logs and intermediate checkpoints are not published.

The [historical narrative and full comparison tables](REPORT.md) preserve this stage’s interpretation. `scripts/route-report.py` regenerates this archive and the historical UI extract; it does not overwrite the current A-Lite+ report or executive summary.
