# Data report (branch scrape/master-2026-11-27)

Generated 27 Nov 2026. Nothing here is pushed, and Supabase was not touched (no Supabase keys in .env.local).

## What ran, and what did not

| Phase | Result |
| --- | --- |
| 0. CI health | Done. Vitest per-test (30 s), hook (60 s) and teardown (15 s) timeouts; step timeouts in ci.yml and reverify.yml; browser tests skip in CI unless RUN_BROWSER_TESTS=1 and Chromium launch has a 15 s limit. Lighthouse: see below. validate:seed warning fixed (LJMU status note set to Not verified: ljmu.ac.uk's robots.txt forbids our bot, so it cannot be sourced). Run reports are git-ignored except latest-<tool>.json. |
| 1. Extractor | Built and tested with a mocked fetch, **not run live: XAI_API_KEY is not set** (also no GROQ/ANTHROPIC key). INGEST_PROVIDER=xai, backoff on 429/5xx with Retry-After, malformed JSON becomes a rejection, token and cost counting, veto-only second-pass reviewer. |
| 2. Existing programs | Partial, by hand (no model key): 3 new admissions_email facts. 90 of 210 priority program facts are still empty. |
| 3. Country and visa | Visa keys added end to end (types, mapper, JSON schema, migration, tests). 5 sourced visa facts (UK fee, UK processing time, UK work rights, Canada work rights, Australia fee). FX re-checked today; the SBP PDF timeout is fixed (30 s for PDFs). |
| 4. New programs | **Skipped**: it needs the extractor key (XAI_API_KEY) to be done at the scale asked. No program was added without verified data. |
| 5. Merge and store | Merged only verified proposals; validate:seed, seed:supabase:check and npm run ci pass. Supabase apply/seed skipped (no keys). |

## Model and cost

- Model: **grok-4.20-0309-non-reasoning** for the first pass ($1.25 in / $2.50 out per 1M tokens), **grok-4.3** for the second-pass review (same prices), chosen from docs.x.ai/models on 27 Nov 2026 (grok-4.7 is the most capable at $2/$6). Override with XAI_MODEL and XAI_REVIEW_MODEL.
- Calls made: **0**. Tokens used: **0**. Cost: **$0**. Acceptance rate: not applicable (no model run). Hand extraction: every item passed `ingest --verify` (FOUND) before merging.

## Before / after (confidence is computed in code, as of 27 Nov 2026)

| | Before (main) | After |
| --- | --- | --- |
| Programs / institutions | 30 / 19 | 30 / 19 |
| Program facts: Verified / Likely / Unverified | 197 / 12 / 391 | 200 / 12 / 388 |
| Institution facts: Verified / Unverified | 0 / 76 | 0 / 76 |
| Country facts: Verified / Unverified | 13 / 24 (37 rows) | 18 / 37 (55 rows) |
| FX rates Verified | 6 of 6 | 6 of 6 |
| Conversion rules with a source | 1 of 1 | 1 of 1 |

The country-fact "Unverified" count rose because 18 new Not-verified-yet rows were added for the visa keys (3 keys x CA, DE, UK, US, CH, AU). 5 of them are now sourced.

## Fields still unverified per program (priority fields)

Priority fields: tuition, min_gpa_rule, language_req, deadline, intake, duration_months, admissions_email.

| Program | Country | Still empty | Why |
| --- | --- | --- | --- |
| tum-msc-informatics | DE | tuition, min_gpa_rule, language_req | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| ethz-msc-cs | CH | min_gpa_rule, intake | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| wuerzburg-msc-cs | DE | min_gpa_rule, intake | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| imperial-msc-computing | UK | min_gpa_rule, deadline | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| cardiff-msc-cs | UK | tuition, min_gpa_rule, language_req, deadline, intake, duration_months, admissions_email | No official page registered yet; needs URL discovery (extractor key). |
| brookes-msc-cs | UK | deadline, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| qmul-premasters-cs | UK | tuition, min_gpa_rule, deadline, duration_months, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| utoronto-mscac | CA | tuition, min_gpa_rule, intake | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| cmu-mscs | US | tuition, min_gpa_rule, language_req, intake, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| uiuc-mscs | US | tuition, min_gpa_rule, intake, duration_months | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| csudh-mscs | US | tuition, min_gpa_rule, language_req, deadline, intake, duration_months, admissions_email | No official page registered yet; needs URL discovery (extractor key). |
| nyit-mscs | US | tuition, deadline, intake, duration_months | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| usf-mscs | US | tuition, intake, duration_months, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| uccs-mscs | US | tuition, duration_months, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| ljmu-msc-cs | UK | tuition, min_gpa_rule, language_req, deadline, intake, duration_months, admissions_email | ljmu.ac.uk disallows our bot in robots.txt (not read). Earlier "not accepting Pakistan" claim is now shown as Not verified. |
| tum-msc-data-engineering-analytics | DE | min_gpa_rule | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| ethz-msc-data-science | CH | min_gpa_rule | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| imperial-msc-artificial-intelligence | UK | min_gpa_rule | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| usf-ms-artificial-intelligence | US | tuition, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| cmu-mse | US | min_gpa_rule, language_req | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| imperial-msc-computing-se | UK | none |  |
| rwth-msc-sse | DE | tuition, language_req, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| utdallas-msse | US | tuition, deadline, duration_months, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| tum-msc-communications-electronics-engineering | DE | tuition, min_gpa_rule | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| ethz-msc-electrical-engineering | CH | min_gpa_rule | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| imperial-msc-future-power-networks | UK | min_gpa_rule | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| utoronto-meng-ece | CA | min_gpa_rule | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| coventry-msc-cs | UK | min_gpa_rule, deadline, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| coventry-msc-data-science | UK | tuition, min_gpa_rule, deadline, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |
| coventry-msc-electrical-electronic-engineering | UK | tuition, min_gpa_rule, deadline, admissions_email | Not on the registered page(s) or needs a page not yet registered; hand extraction only (no model key). |

Typical reasons across the table: the value is not on the registered official page (it lives on a tuition/bursar or international-admissions page that is not registered yet); the page gives a UK degree class without a number (so min_gpa_rule cannot be stored honestly); a date has no year (deadline needs a full date); a range (for example "18 to 24 months") has no single value. Institution facts (HEC, PQR, anabin, recognition lists) need the official registers, several of which are JavaScript databases.

## Pages blocked, forbidden or timing out

- **robots.txt disallows our bot:** ljmu.ac.uk (course and country pages).
- **Bot challenge (reported, not bypassed):** herts.ac.uk (Cloudflare), bridgeport.edu (Cloudflare "Just a moment"), make-it-in-germany.com (Radware, redirects to perfdrive.com).
- **HTTP 403:** travel.state.gov (US visa fee and student pages), migri.fi.
- **Timeouts:** siebelschool.illinois.edu (UIUC; passed on the last run), uni-assist.de, www.ece.utoronto.ca/graduates, ircc.canada.ca/english/information/fees (10 s), catalog.nyit.edu and mse.s3d.cmu.edu (transient in the last run).
- **DNS failure:** courses.essex.ac.uk. **Not found (guessed URLs):** several ministry pages for NL, SE, IE, NZ.
- **ETH (rendered pages):** slow today (20 to 27 s per page); INGEST_RENDER_TIMEOUT_MS raises the 20 s budget.
- Last full `--verify-seed`: 212 of 214 snippets found, 0 NOT FOUND, 2 transient timeouts.

## Lighthouse (/plan-b mobile)

Measured locally against a production build: performance 0.97 to 1.00, TTI 2.7 to 2.85 s, LCP 0.95 s, TBT 60 to 190 ms, 341 KiB transferred. The CI failure (0.86, TTI 3.8 s) is a slower shared runner. Real causes found: a 394 KB client chunk with about 87 KB unused (zod, pulled in by profile-client.ts through profile.ts) and a 178 KB HTML payload. I tried splitting the zod-free constants out of profile.ts, but profile-client.ts still needs the schema, so it gave no gain and I reverted it. The fix that works is to validate stored profiles without zod in the browser or to load zod lazily; that is a UI-side change I did not make. Thresholds were not lowered; Lighthouse CI now takes the median of 5 runs instead of 3.

## UI changes needed to show the new visa fields

The three keys (visa_fee, visa_processing_time, student_work_rights) and proof_of_funds/post_study_work are in the data and chat field table, but no page shows them yet:

1. `/citizenship` country cards and table: add rows for the three keys (reuse the existing evidence disclosure, "Evidence from the official page", and the confidence badge). A fact with no value should read "Not verified yet".
2. Program page and /shortlist: a "Visa" block per country (fee, processing time, money to show, work rights).
3. Chat: add question patterns (visa fee, how long does the visa take, can I work on a student visa) in src/lib/chat/fields.ts; the rows already exist.
4. Countries outside CA, DE, UK, US, CH (for example AU) have facts but no card: add them to SUPPORTED_COUNTRIES only together with programs.
5. Replace the citizenship render test's exclusion list (NOT_ON_THIS_PAGE) once the cards show the new keys.

## Remaining risks and next steps

- **Set XAI_API_KEY** (and optionally XAI_MODEL, XAI_REVIEW_MODEL), set INGEST_PROVIDER=xai, then run: `npx tsx scripts/audit-coverage.ts`, extend data/sources.json with tuition/international-admissions pages per program, `npx tsx scripts/ingest.ts --all`, `npx tsx scripts/ingest.ts --verify <each proposals file>`, and merge with `npm run proposals:merge`. The second-pass reviewer can only veto.
- Visa data for the other 13 destinations (IE, NL, SE, IT, FR, TR, MY, AE, KR, JP, CN, NZ, FI) is not collected: guessed official URLs mostly returned 404/403. Needs the extractor plus a per-country page list. The US page is blocked for bots (travel.state.gov 403).
- The renderer is not DNS-pinned (see DECISIONS.md). Sub-requests to non-allowlisted CDNs are aborted, so some pages render partly.
- ToS/robots: we obey robots.txt and never bypass challenges. LJMU, Cloudflare/Radware sites and travel.state.gov stay unreadable; use their official pages by hand and record them as Not verified.
- Weekly reverify installs Chromium (cached); set INGEST_CONTACT_URL as a repository variable if the workflow's default is not wanted.

## Review and merge commands

```
git log --oneline main..scrape/master-2026-11-27
git diff main..scrape/master-2026-11-27 --stat
npm run validate:seed && npm run seed:supabase:check && npm run ci
# Supabase (when you have the keys): run supabase/migrations/20261127000002_visa_fact_keys.sql first, then
npm run seed:supabase
# Push and open the pull request (yours to run; nothing was pushed):
git push -u origin scrape/master-2026-11-27
gh pr create --base main --head scrape/master-2026-11-27 --title "Data: visa keys, extractor provider, first verified facts" --fill
```
