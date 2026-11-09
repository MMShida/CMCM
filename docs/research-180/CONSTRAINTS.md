# Constraint audit against the original problem

Source: **CMCM_2026_Bail(ey)ing_Out.pdf**, all seven pages reread on 8 November 2026, including both evacuation plans and seating maps. A-Lite+ addresses **all five questions**: normal concert departure, emergency/obstruction, knowledgeable students without managers, removable barriers/LEDs, and costs. Lecture evacuation is a separate scenario, not a younger-audience shortcut for the concert target.

| Requirement | Original page | Implementation and audit |
|---|---|---|
| Emergency declaration to the last person leaving the building, under 180 s | 1–2 | Record the maximum exterior crossing time, including all wheelchair users; no subtraction of response time. Report mean and fraction of runs meeting 180 separately. |
| Full house of 1,329, including up to three wheelchair users | 2–3 | Exactly 527 + 486 + 316 people, with three wheelchair users retained. Not 1,329 plus three. |
| At least six managers at full-house concerts | 2 | **Exactly six** in the primary comparison. The later user-authorized staffing expansion separately tests 8, 10, 12 and 18 actual posts, with added costs and optional conservative patrols. Staff bodies are absent from the inherited audience model. |
| Barriers are temporary/removable, in the semicircular corridor | 2 | Existing W0/W1/W2 and E0/E1/E2 slots only. Plus belts/open rails reduce usable width and create an explicit bypass, or close the slot. Earlier rope penalties remain historical only. No exit-width or capacity bonus. |
| LEDs are directional strips on floors or walls, assisting managers | 2 | Explicit wall signs and floor polylines with public static or delayed dynamic messages, same-floor visibility and wall/opaque-panel occlusion. Low rails preserve sightlines. They do not replace the six staff. |
| Obstruction of an exit, possibly unknown initially | 2 | Matched open/F3/FC2/D3 cases with local discovery, and a delayed announcement comparison. Static messages can become inappropriate; no perfect hazard information is granted. |
| No major infrastructure/appearance changes | 1 | Unchanged building and full audience. Physical rates and population parameters are frozen during placement searches; the separately declared 1.4 m/s speed alternative is clearly distinguished. Removable devices occupy existing intervention slots. |
| No elevator in an emergency | 3 | Prohibited elevator links remain unavailable; wheelchair routing retains accessible paths to outside assistance points. Building departure is distinct from completed assisted descent. |
| Six orchestra-to-mezzanine access points, nine auditorium doors, four corridor-to-portico doors, three corridor-to-foyer doors, five exterior foyer doors | 3–5 | Preserve the existing reconstruction and capacities; graph reachability is tested for every candidate, including wheelchair routes. Dimensions are approximate, not a surveyed venue model. |
| Balcony stairs, existing lane barriers; ignore backstage/service spaces and ground floor | 3–7 | Preserve the original represented audience, stairs and escape paths. No additional occupants or hidden new routes. |
| Robust to execution error; balance efficiency and simplicity | 2 | Imperfect hearing, notice and acceptance retained; compare strip range and reduced notice as labeled sensitivities. Symmetric and asymmetric barrier placements tested. |
| One-page executive summary for Mr. Timothy Ryan | 2–3 | Included at the start of the updated results PDF, addressed to the University Fire Marshal and Director of Fire Protection and Emergency Services. |
| State questions addressed; include prescribed words | 3 | Questions 1–5 explicit. The manuscript discusses guidance choreography, sign legibility, and why an under-180 claim cannot yet be sanguine. |

The brief says **under 180 seconds**; the user's current optimization objective is an average below 180. A low average does not imply every simulated audience meets the brief. Existing tables retain their explicitly labeled “≤180” statistic. No failed or unresolved audience is omitted from a successful mean.

The original PDF, rather than a current venue webpage or a different checkout, defines this problem. Its statement of staffing is used as a contest constraint, not as a fresh legal interpretation. Paper evidence motivates mechanisms; it does not calibrate Bailey's exact visibility, compliance, body movement or staff reach.
