# Evidence review — 2026-11-27

These values were proposed from official pages, their snippets were checked verbatim against the live page,
and a second reviewer re-checked each one. They are in the seed files now and show as **Verified** (or **Conflict**).
Please tick each row after you open the link and agree. To undo everything: `git checkout -- data/*.seed.json`.

Applied: 3 · Not applied: 0

| ✓ | Change | Target | Field | Value | Evidence (verbatim) | Source | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] | filled | program:nyit-mscs | min_gpa_rule | {"scale":"cgpa_4","min":2.85,"text":"Minimum GPA of 2.85 for your undergraduate… | Minimum GPA of 2.85 for your undergraduate coursework | https://www.nyit.edu/academics/degrees/computer-science-ms/ | Programme page. The catalog (already in the seed as conditional_admission) lets the director admit 2.5-2.84 conditionally. |
| [ ] | filled | program:uccs-mscs | min_gpa_rule | {"scale":"cgpa_4","min":3,"text":"Undergraduate grade point average of at least… | The student should have an undergraduate grade point average of at least 3.0 on a scale of 4.0. | https://eas.uccs.edu/academics/programs/computer-science-ms | Page adds: "Students with an average below 3.0 but above 2.75 will be considered on an individual basis". |
| [ ] | filled | program:uccs-mscs | intake | Fall Semester and Spring Semester | by March 1st for Fall Semester and by October 1st for Spring Semester | https://eas.uccs.edu/academics/programs/computer-science-ms | Two intakes (international deadlines quoted on the same page). |
