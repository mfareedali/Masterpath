# Evidence review — 2026-11-27

These values were proposed from official pages, their snippets were checked verbatim against the live page,
and a second reviewer re-checked each one. They are in the seed files now and show as **Verified** (or **Conflict**).
Please tick each row after you open the link and agree. To undo everything: `git checkout -- data/*.seed.json`.

Applied: 3 · Not applied: 0

| ✓ | Change | Target | Field | Value | Evidence (verbatim) | Source | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ ] | filled | conversion_rule:pk-cgpa4-to-german-modified-bavarian | source | modified_bavarian | The Conference of Ministers of Education and Cultural Affairs recommends the modified Bavarian formula as a practical basis for converting … | https://www.intl.kit.edu/ostudies/13602.php | KIT (a German university) page describing the KMK-recommended formula. Variables: Nmax = maximum grade, Nd = grade to convert, Nmin = lowest passing grade. Rounding rule not confirmed from an official HTML page (KMK pri… |
| [ ] | filled | country_fact:ca-post-study-work | value | {"text":"A master's graduate can apply for a 3-year post-graduation work permit… | You can apply for a 3-year PGWP, even if your master’s program was less than 2 years, as long as your program was at least 8 months (or 900… | https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/work/after-graduation/about.html | IRCC page 'About the PGWP'. Snippet lines are joined from consecutive list lines on the page. |
| [ ] | filled | country_fact:de-post-study-work | value | {"text":"After graduating in Germany you can apply for a residence permit for j… | you must apply for a residence permit for jobseekers (go to “Staying in Germany after graduation”). It is issued for up to 18 months as a m… | https://www.daad.de/en/studying-in-germany/work-career/career-planning/ | DAAD (official German academic exchange service). The Make it in Germany portal sits behind a bot challenge so it was not read. |
