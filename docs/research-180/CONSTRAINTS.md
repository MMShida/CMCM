# Constraint audit against the original problem

Source: **CMCM_2026_Bail(ey)ing_Out.pdf**, all seven pages reread on 8 November 2026, including both evacuation plans and seating maps. This study addresses **Question 2 (concert emergency and blocked exit)** and **Question 4 (removable corridor barriers and directional LED strips)**. Lecture evacuation without managers is Question 3 and is a separate population scenario, not a shortcut for the concert target. Questions 1 and 5 are optional extensions.

| Requirement | Original page | Implementation and audit |
|---|---|---|
| Emergency declaration to the last person leaving the building, under 180 s | 1–2 | Record the maximum exterior crossing time, including all wheelchair users; no subtraction of response time. Report mean and fraction of runs meeting 180 separately. |
| Full house of 1,329, including up to three wheelchair users | 2–3 | Exactly 527 + 486 + 316 people, with three wheelchair users retained. Not 1,329 plus three. |
| At least six managers at full-house concerts | 2 | **Exactly six** in the new study, as further required by the user. Earlier 10/18-manager cases are resource sensitivities outside this comparison. Staff bodies are absent from the inherited audience model. |
| Barriers are temporary/removable, in the semicircular corridor | 2 | Existing W0/W1/W2 and E0/E1/E2 slots only. Hard panels restrict traversal; soft ropes add perceived crossing cost. No exit-width or capacity bonus. |
| LEDs are directional strips on floors or walls, assisting managers | 2 | Twelve physical 2 m floor strips per layout, fixed exit messages, same-floor visibility and wall/panel occlusion. They do not replace the six staff. |
| Obstruction of an exit, possibly unknown initially | 2 | Matched open versus blocked exterior-door scenario, with discovery rather than immediate knowledge. Static messages can become inappropriate; no perfect hazard information is granted. |
| No major infrastructure/appearance changes | 1 | Unchanged geometry, all existing exits, physical rates and population parameters. Removable devices occupy existing intervention slots. |
| No elevator in an emergency | 3 | Prohibited elevator links remain unavailable; wheelchair routing retains accessible paths to outside assistance points. Building departure is distinct from completed assisted descent. |
| Six orchestra-to-mezzanine access points, nine auditorium doors, four corridor-to-portico doors, three corridor-to-foyer doors, five exterior foyer doors | 3–5 | Preserve the existing reconstruction and capacities; graph reachability is tested for every candidate, including wheelchair routes. Dimensions are approximate, not a surveyed venue model. |
| Balcony stairs, existing lane barriers; ignore backstage/service spaces and ground floor | 3–7 | Preserve the original represented audience, stairs and escape paths. No additional occupants or hidden new routes. |
| Robust to execution error; balance efficiency and simplicity | 2 | Imperfect hearing, notice and acceptance retained; compare strip range and reduced notice as labeled sensitivities. Symmetric and asymmetric barrier placements tested. |
| One-page executive summary for Mr. Timothy Ryan | 2–3 | Included at the start of the updated results PDF, addressed to the University Fire Marshal and Director of Fire Protection and Emergency Services. |
| State questions addressed; include prescribed words | 3 | Questions 2 and 4 explicit. The manuscript discusses guidance choreography, sign legibility, and why an under-180 claim cannot yet be sanguine. |

The brief says **under 180 seconds**; the user's current optimization objective is an average below 180. A low average does not imply every simulated audience meets the brief. Existing tables retain their explicitly labeled “≤180” statistic. No failed or unresolved audience is omitted from a successful mean.

The original PDF, rather than a current venue webpage or a different checkout, defines this problem. Its statement of staffing is used as a contest constraint, not as a fresh legal interpretation. Paper evidence motivates mechanisms; it does not calibrate Bailey's exact visibility, compliance, body movement or staff reach.
