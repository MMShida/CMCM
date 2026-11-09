Build the full Bailey Hall evacuation simulator from scratch in the CURRENT `rebuild-from-scratch` branch of this repository.

Read `AGENTS.md`, `CODEX_TASK.md`, `docs/model/Bailey_Hall_Model_Final_Defensible.tex` and its PDF, and every reference drawing and photograph in `docs/reference/` before implementation.

The mathematical specification is authoritative. There is no old simulator on this branch by design. Do NOT consult, copy, restore, or import code from `bailey-model`, `main`, other CMCM branches, or external Bailey implementations. The existing repository is shared only to keep the project under the same GitHub organization; this is a clean implementation, not a refactor.

Implement the complete building graph and stepped cross-aisle, the 1,329-person population, heterogeneous response and walking, groups, individual decision-making and partial knowledge, finite-storage queue service and counterflow, wheelchair assistance, Crowd Managers, LED guidance, transparent barriers, deterministic batches and comparisons, and a polished interactive React/TypeScript interface using one common simulation engine. Follow the complete functional and validation checklist in `CODEX_TASK.md`.

Write tests and run them, run the application and the headless engine, document any inferred geometry or computational conventions, and report true results. The 180-second objective is not a calibration knob. Complete real code rather than stopping at scaffolding or a plan. Commit to the rebuild branch only; do not modify `bailey-model` or `main`.
