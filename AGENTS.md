# Codex instructions — Bailey Hall clean rebuild

This is the `rebuild-from-scratch` branch of `MMShida/CMCM`. It is deliberately cleared of the prior simulator so the new implementation starts from the supplied model specification. The existing `bailey-model` branch remains untouched.

Read `CODEX_TASK.md`, `docs/model/Bailey_Hall_Model_Final_Defensible.tex`, and the architectural references before writing code. Treat the LaTeX specification as the mathematical authority. Do not copy, cherry-pick, import, or consult earlier simulator code from `bailey-model`, other Git branches, external repositories, or cached local copies. This is a clean implementation within the same GitHub repository, not a refactor of the previous simulator.

Build and test a complete deterministic simulation engine, interactive visualization, and experiment runner. Distinguish physical and perceived congestion, preserve accessible paths and the 1,329-person population, and document assumptions instead of tuning them to meet 180 seconds. Do not claim unrun tests or experiments passed. Commit work only on the rebuild branch; never push to `bailey-model` or `main`.
