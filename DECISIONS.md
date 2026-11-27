# Decisions log

The brief said: "Do not ask me questions: choose the most reasonable option, log it in DECISIONS.md, and keep going."
Each entry: what was decided, why, and how to undo it.

## Foundation (24 Nov 2026)

1. **The app runs with zero credentials.** No Supabase, Anthropic or Vercel keys were available. Data comes from
   `/data/*.seed.json` (bundled, edge-cacheable) unless `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   are set; chat uses a deterministic, no-AI answer built from the same rows when `ANTHROPIC_API_KEY` is missing.
   *Why:* "never leave the app broken" + demo safety (venue Wi-Fi, expired keys). *Undo:* set `DATA_SOURCE` / keys.
2. **Next.js 16.4.6 + React 19.3 + Tailwind v4 + Vitest 5**, exact versions pinned. Node 24 types.
3. **Cache Components (`cacheComponents`) is OFF.** The scaffold enabled it by default, but it is new, changes how
   `cookies()`/`searchParams` and `new Date()` behave during prerender, and agents/contributors know the classic model
   better. Pages use ISR (`revalidate`) or dynamic rendering. *Undo:* flip the flag in `next.config.ts` after the hackathon.
4. **One file for styling values: `src/theme.ts`.** `npm run tokens` (auto-run before `dev`/`build`) generates
   `src/app/tokens.css` (Tailwind `@theme` + CSS variables). Tailwind's default colour palette is removed
   (`--color-*: initial`) so only brand tokens can be used. A unit test fails if `tokens.css` drifts from `theme.ts`,
   and another checks every text/badge pair is >= 4.5:1 contrast.
5. **Button fonts:** `--font-button-primary/secondary/danger` plus weight/tracking tokens per variant, all system stacks.
   No web fonts are loaded yet. Headings use a system serif stack (`--font-display`) for character at zero cost.
6. **Facts are JSON objects, confidence is computed.** Every program/country value is
   `{ value, source_url, evidence_snippet, fetched_at, basis?, conflicts? }`. In Postgres each fact is a `jsonb`
   column. Confidence is never stored as truth (`src/lib/confidence.ts`):
   - Verified = value + source URL + verbatim snippet + fetched within 30 days.
   - Likely = has a source but older than 30 days, or `basis: "summary" | "inferred"` (a human summary of an official page).
   - Unverified = no value, or no snippet and no declared basis.
   - Conflict = another source has a different value (both kept, both shown).
7. **Seeded country facts are `basis: "summary"`** (→ Likely) because the brief supplied them as summaries found on
   23 Nov 2026, not verbatim quotes. The "German 3-year fast track ended Oct 2025" fact is `basis: "inferred"` with no URL yet,
   so it shows as Unverified until a source link is added.
8. **Fit uses Verified or Likely minimums only.** Unverified/Conflict minimum → "Competitive range unknown".
   A conversion rule with no official `source_url` also yields "Competitive range unknown" (code computes the range
   but refuses to decide).
9. **German conversion = modified Bavarian formula** with `Nmin` as a RANGE (1.0–2.0) because the lowest passing CGPA
   differs between Pakistani universities. Students can enter their transcript's minimum to narrow it to one value.
   The rule ships with `source_url: null` until an official source is attached.
10. **"Rank by: Fit"** orders Meets minimum → range crosses minimum → Below minimum; programs without a verified minimum
    go to "Not ranked: data missing".
11. **Conflict values are never ranked** (they go to "Not ranked" with reason "Sources conflict").
12. **Money is compared in PKR only through a Verified/Likely exchange-rate row** (`data/fx_rates.seed.json`, all empty for now).
    Without a rate, cost ranking/filters put the program in "Not ranked". Budget = total for the whole degree, in PKR.
13. **"USF" = University of South Florida** (the brief did not say which USF). Change the institution row if you meant the
    University of San Francisco.
14. **Institution homepages** in the seed are domain roots only; the link checker verifies them. Program pages are `null`
    until a contributor adds a verified URL.
15. **Profile storage:** a first-party cookie (`mp_profile`, no PII) so server components can render the shortlist with zero
    client JS, mirrored to localStorage for offline. Query params (`?cgpa=2.5&scale=cgpa_4&field=cs&countries=DE,UK`) override
    it, so shortlists are shareable.
16. **Demo persona A** = CGPA 2.5/4, CS, "Demo Private University (fictional)", budget PKR 6,000,000 total, targets DE/UK/CA/US.
    Persona B adds one fictional preprint + supervisor (P1). The persona's university is fictional on purpose, to avoid
    showing a verdict about a real institution.
17. **Chat model default `claude-opus-5-5`** (override with `ANTHROPIC_MODEL`), low effort (it only explains rows), with the
    server-side refusal fallback enabled.
18. **CSP uses `'unsafe-inline'` for scripts** because nonce-based CSP forces every page to render dynamically (slower LCP).
    Everything else is locked down (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`, HSTS…).
19. **Line endings are LF** (`.gitattributes`) so the token drift test passes on Windows and CI alike.
20. **A dedicated account for this project.** The project uses its own GitHub repository and hosting account, kept separate from any other organisation. The repo is pushed over SSH with a deploy key scoped to that one repository; the history was published as a single clean commit.
21. **CV Tailor (P2) is a roadmap page only** (`/roadmap`), describing the design: code checks first, AI suggests,
    no invented experience, consent + delete after session, never scrape other people's CVs.

## Build wave 1 (24 Nov 2026) — decisions made by each workstream

Each workstream logged its judgement calls; they are kept here verbatim so they can be reviewed or undone.

### Home (screen 1), Onboarding (screen 2), demo persona buttons, University context card (screen 7), About page

- Home quick-start merges the new grade into the student's own saved profile (keeping target countries, budget, university and the transcript minimum if it is on the same scale and not above the grade). It does NOT merge a demo persona's fictional values: typing a real grade starts a clean profile, and persona B's fictional strengths are cleared whenever they are still on the device. To undo: change validateQuickStart in src/lib/onboarding/profile-form.ts.
- Saving the onboarding form always clears the demo persona marker (persona: null). When a demo persona is loaded, a callout says 'You are editing a demo persona. Saving makes them your own profile on this device' and offers 'Clear the form and start fresh'.
- Grade inputs ship without a max attribute so the plain no-JavaScript GET form works for the Percentage scale. With JavaScript, the max is set for the chosen scale and validation runs in code with profileSchema; the server re-checks through profileFromSearchParams.
- Shareable shortlist links (shortlistHref) contain only cgpa, scale, field, min_pass, budget and countries, matching what profileFromSearchParams reads. University name and degree are never put in a URL.
- With JavaScript off, the demo section shows a link to persona A's shortlist built from PERSONA_A. Persona B needs device storage for its strengths, so it has no no-JavaScript link.
- The onboarding page loads the list of home universities for the datalist at build time and refreshes it hourly (revalidate = 3600). A typed name is linked to a university id only on an exact match that ignores case, spacing and accents; otherwise the name is kept without an id.
- The University context card treats the destination recognition list as a fact to check: Listed or Not listed is shown only from data rows, with no verdict. Its HEC and anabin rows, and the checklist, link only to the domain roots https://www.hec.gov.pk and https://anabin.kmk.org.
- Strengths are cleaned before saving: control characters removed, whitespace collapsed and trimmed, length limits applied (title 300, venue 200, free text 2000, up to 10 rows, up to 20 one-per-line items), empty rows dropped, and only http(s) links kept (a bare domain gets https:// added; links with a username or password are dropped). Strengths never feed the fit label.

### Shortlist (screen 3)

- The 'Within my budget' filter uses the URL param inbudget=1, not budget, because shareable profile links already use budget for the PKR amount (profileFromSearchParams).
- Fit filter: a program whose fit is decided (Meets or Below minimum) and not selected is hidden and counted. An undecided fit (minimum not verified, sources conflict, conversion rule has no source, or the grade range crosses the minimum) goes to 'Can't check: data missing' with the reason, unless 'Competitive range unknown' is selected.
- Country is always a known property of a program, so the country filter hides and counts programs instead of using 'Can't check'. A note says how many are hidden, with 'Clear filters', or 'Show all countries' when the profile's own countries are what hides them. Ruled-out programs follow the country filter only.
- Citizenship rule on cards and in the table is the data row's own text, unchanged. Code never paraphrases sort_months into a rule. The months number appears only as 'Ranked on: N months (the number this rule is compared by)' when ranking by citizenship rule.
- Ranked rows show the value they were ordered by, with its confidence badge: on cards for tuition and citizenship rule (other keys already have a card row), and as a desktop table column for tuition, citizenship rule and study time.
- Coverage counts active programs in the profile's field; ruled-out programs are excluded. A program counts as verified only when min_gpa_rule, deadline, tuition and language_req are all Verified. Per-field counts appear in a 'By field' disclosure when more than one field has programs.
- The UniversityContextCard sits below the results on the shortlist so programs come first on phones.
- Mobile filters are an inline details panel styled like a bottom sheet (drag handle, shadow-sheet), not a fixed overlay, so they work without JS. The URL param panel=filters keeps it open after a chip tap, and 'Show N programs' closes it.
- Switching the 'Rank by' key resets the order to ascending. The order chip uses plain words for each key (e.g. 'Cheapest first', 'Earliest first').
- Total cost shows PKR only through a usable exchange rate. Without one, the card shows the total in the program's own currency plus 'No verified PKR rate yet', and the program is not ranked or filtered by cost.
- Saved programs: localStorage key 'mp_saved' holds a JSON array of ids, newest first, capped at 200, junk ids dropped. A custom 'mp-saved-change' event keeps Save buttons in sync within one tab. /saved is ISR (revalidate 3600) and sends compact summaries; the client shows the saved ones after hydration and a skeleton before.

### Program detail page (screen 4) + "Report incorrect data" (P1)

- Program page is static + ISR (revalidate 3600, generateStaticParams) and never reads cookies/searchParams. Fit, checklist ticks, report form and chat are client islands; FitPanel reads the profile from localStorage/cookie in the browser and runs computeFit there (via buildFitView). If MASTERSPATH_NOW is set, the pinned time is passed to the island so client and server confidence agree in demos.
- The coverage line counts APPLICABLE fact fields only: progression fields only for pre_masters/pathway/conditional, status_note only when the program is ruled out or has a note. So a direct, active program shows 'X of 14 fields verified', not 'of 17'. Confidence is always computed with computeConfidence(fact, now).
- 'Not verified yet' links go to program.official_url, falling back to the university homepage until a program page is verified. Country and recognition facts link to their own source_url when the value is missing.
- 'Where your research may matter' appears only when research_considered is Verified or Likely (per the brief). The field is still counted in coverage and can be reported.
- The 'Transcript and degree documents' checklist item has no data row behind it yet, so it is always Unverified and its text says to check the official page. LOR count comes from data only; otherwise 'Number of LORs not verified yet'.
- /api/report: JSON only (415 otherwise). Bodies over 4096 bytes get 413 (Content-Length plus a streaming cap). 5 reports/minute per instance, keyed by sha256(REPORT_IP_SALT|ip) truncated; raw IPs are never stored or logged. Message length is counted in Unicode code points to match Postgres char_length in the reports table check. Replies are fixed JSON strings and never echo the message. With Supabase it inserts via a service-role client (persistSession false) and returns 201; otherwise 202 { stored: false, message }.
- Value renderers live in src/lib/program/render.ts as pure plain-text functions returning string lines (no JSX, no HTML); React escapes them.

### Citizenship and cost (screen 6)

- Citizenship screen rank keys: 'citizenship' = citizenship_rule.sort_months (default ascending); 'psw' = post_study_work.sort_months (default DESCENDING, longest work permit first; the toggle still works); 'tuition' = tuition_typical yearly in PKR; 'total' = tuition_typical + living_cost_typical yearly in PKR, both required. Canonical URLs leave out default values (/citizenship, /citizenship?rank=psw, /citizenship?rank=psw&dir=asc). Bad query values fall back to the defaults.
- Country money is made yearly the same way as src/lib/cost.ts: year x1, semester x2, month x12. An amount with period 'total' is not ranked ('Typical tuition is not given per year') because there is no honest way to make it yearly without a duration.
- A typical tuition of exactly 0 is ranked as PKR 0 even when there is no exchange rate (zero is zero in any currency). Any non-zero amount needs a Verified or Likely fx row, otherwise the reason is 'No verified XXX→PKR exchange rate yet'.
- Country-fact conflicts: there is no admissions office, so instead of 'Copy email to admissions' the card shows both values, both links and a 'Copy question: <fact>' button. It builds a plain-text question for the official office, and its 'To:' line is a placeholder (no invented address).
- An Unverified value that has text (today only DE citizenship_update, from a news report) is shown with the Unverified badge plus 'Not from an official page yet. Do not rely on it.' and the data note. It is never ranked.
- Layout: country cards below md, a 6-column table from md up. Post-study work and PR route are stacked under 'Work and residence', and 'Recent change' sits under the citizenship rule. Every country always shows every fact key, with 'Not verified yet' when there is no row, so the UI looks the same with empty and full data.
- Countries in the student's profile target_countries get an 'In your plan' pill (getRequestProfile). Nothing else on this screen uses the profile.
- The Pakistan dual-nationality card is always shown. pakistanDualNationality() returns an empty Unverified stub when the data has no PK row, and the card links out only if the data row has a source_url.

### Plan B + integrity gate (screen 5)

- Plan B route score = feasibility (meets 6 / range unknown or minimum not verified 3 / below 0) + quality (recognition 'listed' 2, not verified 1, minus 1 per soft warning) + cost (known and within budget or no budget set 2 / known but no exchange rate, or cost unknown 1 / over budget 0); maximum 10. Ties are ordered by institution + program name. Every card shows the breakdown under 'Why this order'.
- A route is ranked when at least one of its three score parts rests on Verified/Likely data. Its rank confidence is the strongest known part, so a route with one verified fact can be ranked while its unknown parts score in the middle. Routes with nothing verified go to 'Not ranked: data missing'. Unknown data cannot score as the best: a fully unknown route reaches at most 3, a known-good route 10.
- Hard block only when the institution's recognition_list_status is a usable (Verified/Likely) 'not_listed'. An Unverified or Conflict value gives the soft warning 'Check the institution is on the official recognition list before you pay anything'. It never blocks.
- Progression warning for pre_masters, pathway and conditional routes unless progression_guaranteed is a usable true. If it is a usable false, the progression_requirement text is shown when it is verified.
- A pre-master's or pathway route counts the Masters it leads to as an active direct program at the same institution in the same field (the chosen target is preferred). If none is in the data, total time and cost are 'Not verified yet' with the reason 'The Masters this route leads to is not in our data yet'.
- The direct target is ?target=<id> only when that program is a direct Masters. A non-direct program, or an unknown id, falls back to the first Below-minimum target, or to 'All my targets', with a plain notice. ?target=all compares with no single target.
- A direct program becomes a 'research_led' route when it is not a 'Meets minimum' route and its research_considered value is usable. The chosen target itself is kept as a research-led route when its official page says research is considered.
- Strengths: on the server, persona B gets PERSONA_B_STRENGTHS. In the browser, a small island (research-hint.tsx, useSyncExternalStore + loadStrengths) shows 'Your research may matter here' on research-considered routes. Strengths never change fit labels or route order, and tests check this.
- Cost is compared with the budget in PKR only through a verified exchange rate. If the cost is known only in another currency, the card says 'Cannot check against your budget yet: no verified exchange rate' and the cost scores in the middle (1).

### Chat that answers ONLY from database rows and refuses otherwise (screen 9)

- Chat refusals are decided by plain code (guard.ts) before any model call. Refusal answers are fixed templates built from data rows and say 'No AI was used'. The model is only called when at least one Verified or Likely row exists.
- Unverified values and their snippets are kept out of both the model input and the browser payload (meta rows). The model and the UI can only say 'Not verified yet' plus the official link.
- Safety net on the model's answer: every number must appear in what the model was shown, and every date must match a whole date in the rows. If not, the partial text is replaced by the plain fact list (a 'reset' event). Reason: an invented '20 March 2027' passed a digits-only check because 20 and 2027 appeared in timestamps.
- NDJSON protocol: meta (mode, reason, rows, pointers) -> text deltas -> done. Two events beyond the brief: 'reset' (drop the streamed text and show the fact list) and 'error'. The meta with rows is sent BEFORE the model call so 'Sources used' shows at once on slow 4G.
- In-memory limits per server instance: 8 requests/minute per client, CHAT_DAILY_TOKEN_BUDGET (20000) per client, CHAT_GLOBAL_DAILY_TOKEN_CAP (500000) global, reset at 00:00 UTC. Client id = SHA-256 of (random per-instance salt + IP + user agent), first 32 hex characters. Raw IPs are never stored. On serverless, each instance and cold start has its own counters.
- Model call: client.beta.messages.stream with model ANTHROPIC_MODEL or 'claude-opus-5-5', output_config.effort 'low', max_tokens 1024, betas ['server-side-fallback-2026-07-01'], fallbacks 'default'. No temperature, top_p, top_k or thinking, and no assistant prefill. 30s timeout and 1 retry, then the plain fact list. SDK 1.13 types accept every field natively, so no casts.
- The prediction/legal/dishonest detector is deliberately narrow so honest questions get data. 'Can I get a scholarship/PR?' asks about rules; 'What percentage do I need?' means marks (Pakistani usage); 'Is this consultant fake?' is honest. 'Will I get…', chances/odds/acceptance rate, 'guarantee' (except programme progression), 'is it legal', 'should I lie' and 'fake/forged documents' are refused. Refusal wording makes no real-world claims and never accuses the student.
- Topics with no data column (application fee, visa fee, health surcharge, blocked account, proof of funds, rankings, salaries) are matched first. So 'application fee' is never misread as tuition; it gets a named 'no data on application fee yet' refusal.
- A cost question that names a country but no program also returns that country's tuition_typical and living_cost_typical rows.
- ChatPanel keeps its props and adds an optional headingLevel (1 on /ask = page style with h1; default 2 = card style). Suggestions are wrapping chips (not a hidden-scrollbar row) so all examples are visible at 360px; one tap sends.
- The chat's Turnstile widget reads window.turnstile through a local cast instead of 'declare global', because src/app/account/turnstile.tsx already augments Window.turnstile with a different type and two augmentations do not compile.

### Consultant Check (screen 8)

- Consultant Check uses a GET form (next/form, /check?claims=<text>) instead of a POST server action: works without JS with no client code beyond the shared CopyButton, back/reload work, loading.tsx shows during client navigation. Example chips are plain links /check?example=<id> that only prefill the textarea. Trade-off: the pasted text is in the URL (logs/history), mitigated by removing CNIC/passport/phone-like numbers and emails before display or checking (the page says when it did), a hint asking users to leave them out, and robots noindex on pages with ?claims=. Undo: switch CheckForm to a server action with useActionState.
- After a submission the page shows results first and the form second ('Check something else'), so mobile users see the answer without scrolling.
- Cost claims: 'Differs' when the claimed whole-programme cost is below 80% or above 125% of the usable official cost (COST_LOWER_TOLERANCE / COST_UPPER_TOLERANCE in compare.ts). These are code thresholds, not real-world facts. Comparison only in the same currency or through usable FX rows; otherwise 'Can't verify'.
- Guarantees: visa promises are always 'Can't verify' (no visa data model). Guaranteed admission matches only an explicit usable progression_guaranteed=true row on a pre_masters/pathway/conditional programme, and is explained as progression; progression_guaranteed=false gives 'Differs'. Scholarship promises match only when usable scholarship_info text says guaranteed/automatic.
- PR/citizenship facts (pr_route, citizenship_rule sort_months) are treated as minimum waits: a shorter claimed time differs. post_study_work sort_months is treated as a maximum: a longer claim differs.
- Claim context: institution from the same clause, else the same sentence, else the whole text. Short all-capital names (TUM, USF, ETH...) match only in capitals because 'tum'/'us' are Roman Urdu words; lower-case 'pr' counts as PR only before a time phrase. INSTITUTION_ALIASES are names only, not facts.
- A bare '$' is read as CAD when the claim is about Canada, otherwise USD. 25 lakh = PKR 2,500,000; 1.2 crore = PKR 12,000,000.
- University rankings are never checked ('We don't track university rankings'); the card asks which ranking and which year.
- Limits: 2,000 input characters, 20 claims, 3 questions per claim, 8 collected questions. The WhatsApp text is at most 1,500 characters and drops questions first, then claim lines; the footer 'Checked with MastersPath (free, open source). Not legal advice.' is always kept. When served over https, the text ends with a link to /check built from the request host (no claims in that link).
- Verdict badges reuse status colours (conflict = Differs, unverified = Can't verify, verified = Matches) and also differ by label, glyph (!, ?, check mark) and border style (solid / dashed / none), plus a coloured left stripe on each card.

### Supabase schema + RLS + seed loader + Supabase data source + account/auth + hard delete + Privacy and Disclaimer pages

- Accounts are offered only when NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are all set (accountsEnabled()), so every account can always be hard-deleted. With public keys only, Supabase serves read-only data and /account says accounts are not turned on.
- Sign-in is passwordless email OTP: signInWithOtp sends a magic link to /auth/callback (PKCE exchangeCodeForSession, or token_hash via verifyOtp), plus a typed-code fallback because PKCE links fail when opened in another browser (e.g. an email app's in-app browser). Status reaches /account as a fixed code (?auth=signed_in etc.), never as free text.
- src/proxy.ts exists only to refresh Supabase sessions, because Server Components cannot write refreshed cookies. Its matcher is limited to /account, /auth and /api/account, and it skips all work when no sb- cookie is present.
- Turnstile appears on sign-in only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. If TURNSTILE_SECRET_KEY is set, our server verifies the token (without sending the user's IP); otherwise the token is passed to Supabase's own captcha check.
- The Supabase data source reads the five public tables with the anon key and no cookies, via fetch with cache: 'force-cache', revalidate 3600 and tag 'masterspath-data' (call revalidateTag after a data update). It pages 1000 rows at a time. A structurally broken row is logged and skipped; a query error or an empty programs table throws, so the data layer falls back to the seed JSON.
- Mappers never invent or default a value: a wrong-shaped value becomes null (Not verified yet) and is reported, non-http(s) links are removed, and an unknown status, pathway, formula or bad conversion params throw so the row is skipped. Midnight-UTC timestamps from timestamptz come back as plain dates, so seed data round-trips deep-equal.
- Each fact is one jsonb column with CHECK fact_is_well_formed(): a value key must exist, a snippet needs a source URL, URLs must be http(s), fetched_at must be date-like, and basis must be a known value. A JS mirror (factIsWellFormed / validateSeedRows) lets the seed script fail fast with readable messages.
- country_facts.confidence is a cache only: the seed script fills it with computeConfidence(fact, now) for SQL dashboards, and the app never reads it (a test checks this).
- reports: anon/authenticated may INSERT only (program_id, field, message, status), the policy forces status = 'open', and there is no SELECT policy. /api/report inserts with the service role. chat_usage has no policies; add_chat_usage() is an atomic upsert executable only by service_role.
- The migration grants table privileges to service_role explicitly, because newer Supabase projects may not grant them automatically on new tables.
- Hard delete: POST /api/account/delete checks Origin against Host (CSRF), requires the body {confirm:'DELETE'} (max 1 KB), verifies the user server-side with getUser, deletes profile_strengths and profiles rows, calls auth.admin.deleteUser(id, false) (cascade as a second guarantee), signs out and clears sb-* cookies, and returns 200.
- 'Save my profile to my account' also saves strengths; if the device has no strengths, the account copy of strengths is deleted. The demo persona marker is never stored. 'Copy my saved profile to this device' restores it.
- 'Delete my data on this device' runs clearLocalData() and also removes mp_* sessionStorage keys and Cache Storage (offline page copies), behind a two-step confirmation. Deleting the account does not touch device data, and the page says so.
- No GitHub URL is hard-coded (the repo does not exist yet, DECISIONS #20). Privacy and Disclaimer name GitHub issues and link them only when NEXT_PUBLIC_REPO_URL is a valid https://github.com/owner/repo URL.
- scripts/seed-supabase.ts reads .env.local or .env, upserts by id in foreign-key order in batches of 500 and never deletes rows. --dry-run validates the seed files with no keys or network.

### Seed JSON schemas + validator (CI), offline ingestion (SSRF-safe), link checker, CI workflows, PWA, lint rules

- Confidence is never trusted from data. A hand-written "confidence": "Verified" without both source_url and evidence_snippet is a validator ERROR; any other hand-written confidence key is a warning (ignored). The schemas allow the key only so the validator can give that message.
- Validator severity: errors for schema violations, evidence_snippet without source_url, non-https or invalid URLs, invalid or future dates (1 day tolerance for time zones ahead of UTC), snippet length outside 12-600, HTML in any string, admission-probability wording in any key or string, duplicate ids, duplicate (country, key), duplicate fx currency, unknown country keys, missing institution_id, reversed [low, high] ranges. Warnings only: 'Unverified value present' (verbatim/default basis without a snippet, or summary/inferred without a URL), evidence without a value, source host not on the allowlist, a usable deadline already passed, program country different from its institution's.
- Coverage counts a program as 'fully verified' when intake, deadline, min_gpa_rule, language_req, tuition and duration_months are all Verified (PROGRAM_CORE_FIELDS). Ruled-out programs are excluded.
- Ajv runs strict except strictRequired (factBase requires 'value' and each fact_* type defines it).
- Ingestion: the model proposes and code accepts. Acceptance = snippet verbatim on the fetched page (snippetAppearsIn) + value passes $defs/value_<kind> + no HTML or probability wording. Numbers in the value that are not traceable to the snippet, and multiple values for one field, only add review_notes; they never auto-reject or auto-pick. status_note is never proposed by default because a human decides when a program is ruled out.
- Structured output sends each value as a JSON-encoded string (value_json) to keep the output schema simple. If the model returns HTTP 400 on output_config.format, the proposer retries once without it.
- Proposal file timestamps are UTC (<id>-<YYYYMMDD-HHmm>.json). The script refuses to overwrite an existing file or to write outside data/proposals/.
- robots.txt policy is conservative: Disallow for '*' is honoured even when our own group exists; an explicit Allow in our own group wins. A 4xx robots.txt means allow-all, a 5xx or unreachable robots.txt means disallow-all. TLS verification always stays on.
- The link checker never fetches hosts outside the allowlist (warning only). Robots refusals and 401/403/429 are warnings; only real failures count as broken. --strict fails on broken only.
- Service worker: precaches '/', '/offline', '/saved', the manifest and icons, plus the /_next/static files referenced in those pages' HTML, so /saved can hydrate offline. Navigations are network-first, falling back to the cached copy of the same URL after 6 s on a slow network. It never stores redirected, no-store or private responses, or /account and /auth pages, and never intercepts /api. Caches are prefixed 'masterspath-' and bumping VERSION drops them. Posting {type: 'CLEAR_PAGES'} to the worker clears stored pages.
- The icon is olive-700 with a yellow-400 bar and a white 'M' drawn from rectangles. Regular icons have rounded transparent corners; the maskable icon is full-bleed with the artwork inside the safe zone. Colours come from src/theme.ts; regenerate with `npx tsx scripts/make-icons.ts` (a test fails if the PNG pixels drift from the generator).
- ESLint bans dangerouslySetInnerHTML (react/no-danger plus a no-restricted-syntax rule), innerHTML/outerHTML assignment, insertAdjacentHTML and document.write across the codebase.
- CI uses actions/checkout@v5 and setup-node@v5 (Node 24), with Dependabot keeping actions current. Lighthouse runs 3 times per URL with the default mobile emulation and --no-sandbox Chrome.

## Integration (24 Nov 2026)

- **Evidence merge.** 84 proposals from three researchers passed a second, adversarial reviewer; every snippet was re-checked word for word against the live page on 24 Nov (curl used only where Node could not complete TLS). 74 were merged by `scripts/merge-proposals.ts`; the human checklist is `data/proposals/REVIEW.md` (undo: `git checkout -- data/*.seed.json`).
- **robots.txt is respected for data, not only for the ingestion script.** www.csudh.edu and www.ljmu.ac.uk disallow all bots, so their 9 facts (and a possible CSUDH TOEFL 80 vs 90 Conflict) are NOT auto-merged. They wait in `data/proposals/needs-human/` until a person confirms them in a browser. Bot challenges are never bypassed.
- **An unsourced placeholder is not a second source.** When a sourced proposal meets a value with no source_url, it replaces it instead of creating a fake Conflict (the LJMU note).
- **`review_note` vs `note`.** Reviewer provenance and caveats go to `review_note` (stored, never rendered; added to the JSON schemas, the TS type, the Supabase mappers and a country_facts column). `note` is student-facing only; stale "re-verify" notes are cleared once a verbatim snippet exists.
- **No admission-chance wording in data, even when quoting.** The validator rejected a researcher note quoting an official page ("low chance of admission"); it was rephrased.
- **Tests no longer depend on how much data exists.** Tests about behaviour with empty data use a frozen copy of the original seed (`tests/fixtures/seed-empty`, `loadEmptySeedDataset()`); `tests/live-seed-demo.test.ts` pins the demo story on today's real data (persona A Below minimum at Oxford Brookes and USF, QMUL progression warning, Imperial deadline refusal, Brookes Pakistan notice).
- **Chat refusal demo** uses the Imperial MSc Computing deadline (deliberately not in the database). The TUM deadline is now Likely, so it answers with its source.
- **auswaertiges-amt.de** (German Federal Foreign Office) added to the ingest allowlist.

## Review fixes (24 Nov 2026, evening)

An independent five-lens review (rules, security, chat, demo flow, data fidelity) ran read-only; each medium+ finding was attacked by one or two skeptics. 24 findings survived (9 high), 6 were refuted. Data fixes were made by hand from official pages (verbatim, robots.txt respected); code fixes by seven area owners. These entries SUPERSEDE earlier ones where they conflict.

### Data and contract

- **New field `eligibility_note`** (who the course is for, as the official page states). Verified notes on imperial-msc-computing and qmul-premasters-cs (conversion courses for non-computing graduates). It is a WARNING (program page callout, shortlist row, Plan B ELIGIBILITY warning, chat and Consultant Check source) and never decides fit — we do not know the student's degree subject for sure.
- **Oxford Brookes** renamed to its real course, MSc Advanced Computer Science. £20,800 is the 2027/28 fee (snippet now includes the year headers). Its 2.7 minimum is **Likely** (basis inferred): the page says "GPA 2.7" without naming the scale.
- **Quoted text = verbatim only.** Values' display text was trimmed to what each snippet says (TUM, CMU, UIUC, USF, UCCS, NYIT, Imperial). Team summaries are shown as "In short:" without quotation marks everywhere.
- **UK PR** now cites the gov.uk earned-settlement response page with a verbatim snippet (starting point for settlement moves to 10 years); its clock note quotes the same page (temporary-route time does not count). **US OPT** says "up to 12 months" with the USCIS sentence; ranking assumes a STEM degree.
- **sort_months is a ranking key, not the law** (types.ts comment updated). The UK Graduate visa ranks at 18 months because a 2027 Masters ends after 1 Jan 2027; the rule text (2 years until 31 Dec 2026) is what students see and what claims are compared with.
- Deadline cut-off times (ETH noon CET, CMU 3 p.m. EST, Toronto 11:59 p.m. ET), the USF priority date and the Würzburg semester contribution are shown as student-facing notes, each backed by its snippet.
- **Report and chat rate limits** take the client IP from platform headers (x-vercel-forwarded-for, x-real-ip, rightmost XFF), never the client-controlled leftmost XFF or the User-Agent.

### Security and infra

- The CSP builder lives in src/lib/csp.ts with no imports, and next.config.ts imports it with './src/lib/csp'. I verified that Next 16.4.6's legacy SWC require-hook resolves the extensionless .ts import. The CSP is built inside headers(), so the env is read when Next asks for it (build time) and tests can stub env.
- upgrade-insecure-requests is never sent in development, even when the flags are set; dev was always plain-HTTP localhost. CSP_UPGRADE_INSECURE must be exactly '1'. VERCEL counts as set when it is non-empty and not '0' or 'false'.
- HSTS is left as is: browsers ignore Strict-Transport-Security on plain-HTTP responses, so it does not affect the laptop fallback. A comment in next.config.ts says so.
- safeNextPath uses an allowlist and also re-checks after normalisation. Dot segments that stay inside an allowed page are normalised, not rejected ('/account/../shortlist' gives '/shortlist'). '/program/' alone is rejected because it needs an id. The only next the app sets today is /account (src/app/account/actions.ts), which is still allowed.
- The reports change is an in-place edit of the init migration, not a new migration file. There is no .env and no linked project, and README tells people to run that single file. The file stays re-runnable and now drops the old policy itself.
- The /api/report bad-origin message is a local constant in route.ts ('We could not accept this report. Please reload the page and try again.') because report-constants.ts belongs to the program area. The report form already shows body.error, so users see it.

### Citizenship & cost (src/lib/citizenship/**, src/components/citizenship/**, src/app/citizenship/**)

- The months display is '<N> months (the number this rule is ranked by)', always in months and never converted to years, with the singular '1 month'. It carries no confidence badge (CountryRankKey.showBadge=false). Converted PKR tuition/total lines keep their computed weakest-input badge (showBadge=true), because they are sourced amounts converted through a sourced fx row, not paraphrases of a rule.
- German-language evidence is detected from the source URL only: the first path segment is 'breg-de' or 'de', case-insensitive, which covers bundesregierung.de/breg-de, bamf.de/DE and auswaertiges-amt.de/de. Only the first segment counts, to avoid false positives such as /countries/de/. No text heuristic is used. The blockquote gets lang="de" for screen readers.
- A student note that only repeats 'Not verified yet' is not shown, because the UI already says it. Any other note on an empty fact is still shown.
- The 'How this ranking works' section moved into its own server component (HowRankingWorks) so its copy can be regression-tested without mocking the page's data and cookie loaders.
- In table cells, the evidence toggle reads 'Evidence' (or 'Evidence (original German)') and the note uses text-xs, to keep the narrow columns readable.

### Plan B (src/lib/planb/**, src/components/planb/**, src/app/plan-b/**)

- ELIGIBILITY is a soft RouteWarning listed first; it is never a GateBlock, because we do not know the student's degree subject for sure. Like every soft warning it lowers quality by one step (per the existing score rule), and it never touches fit.
- Only a usable (Verified/Likely) eligibility_note warns; Unverified or Conflict notes do not, following the rule that only usable values may decide or filter. RouteWarning gained an optional `confidence` so a warning that quotes a data value shows its computed badge.
- The eligibility note is checked on the route's program AND on its follow-on Masters (when that is in the data). A note from the follow-on says 'From the official page for <name>.' Identical texts are de-duplicated.
- The warning detail is fixed, neutral text (ELIGIBILITY_DETAIL): 'This is who the course is for, as its official page states it. We cannot check your degree subject against it, so we do not hide this route. Read the official page before you apply or pay anything.' It accuses no one and promises no outcome. A student-facing fact.note is appended; review_note never is.
- The status note label is decided in code (statusNoteLabel): 'Note for Pakistan applicants' only when the official note text mentions Pakistan, else 'Note from the official page'. The row is shown on the target card and also on route cards (program's own note), so a note on an active program is never hidden in Plan B.
- The not-ranked reason is now built from the unknown score parts ('Not ranked yet: ...') instead of one fixed string. Ranking logic, score points and the 'Why this order' condition are unchanged.
- DirectSection now requires a `now: Date` prop (needed to compute the status note's confidence). Both callers, page.tsx and render.test.tsx, are Plan B files and are updated.
- Warning list items use the key `${code}-${index}` (the same code can now repeat) and a data-warning attribute, which tests use to check order.

### Program detail page (src/app/program/**, src/components/program/**, src/lib/program/**)

- The 'Who this course is for' callout sits after the header and status-note callouts and before the jump links and Your fit. It shows only for Verified/Likely notes; a Conflict appears only in Entry requirements, where both sources are shown.
- Reading the URL profile is pure logic in src/lib/program/fit-profile.ts (resolveFitProfile, readFitProfileJson, shortlistBackHref). The islands pass in location.search, so the logic is testable in the node test environment and the page never reads its query on the server. I did not use useSearchParams because it would need Suspense boundaries on a static page, and I cannot verify that with next build.
- FitPanel is split into FitPanel (the hook) and an exported FitPanelView (presentation), so the loaded states can be render-tested without a DOM. page.tsx still imports only FitPanel.
- The back link reuses profileQueryString from src/lib/shortlist/query.ts, so the param set stays the same as the shortlist's. It keeps the query only when the URL profile is valid, otherwise it links to plain /shortlist.
- gpaRuleLines removes only a quote pair that wraps the whole text. Quote characters inside the text that come from the source, like the curly quotes around B in the USF text, are kept.
- programForFitPanel removes review_note from min_gpa_rule as well, on top of stripInternal in the data layer. The student note is kept and shown in the fit panel.
- I did not add tuition/living/duration notes to CostSummary. Those notes already show on the Key facts rows, and the total-cost caveats belong to src/lib/cost.ts (finding 5, another area).

### Shortlist (src/lib/shortlist/**, src/components/shortlist/**, src/app/shortlist/**, src/app/saved/**)

- Intake terms come in three kinds (month, semester, season), and code never converts between kinds. 'Winter semester' is not read as October, and 'Fall' is not read as September. Comparing across kinds gives unknown (Can't check), never fail, because that conversion would be an inference that is not in the evidence.
- Matching is three-valued, OR across the selected chips: pass if any term matches; fail only if the text was read in full and, for every selected term, names other terms of that kind; otherwise unknown. So October + Winter semester against Brookes is unknown, not fail, and Brookes is not hidden.
- Parsing is conservative. Any unknown word makes the parse incomplete, which turns a would-be fail into unknown. A term found in partly-read text can still pass. 'May' counts as a month only next to a year, so the verb 'may' never creates a match.
- Chips carry no year ('September', not 'September 2027'); years are read but not kept. Chip URLs use term ids (intake=september&intake=winter-semester). Old links with raw intake text are read into terms instead of being dropped.
- Notes on cards appear only when the value is Verified or Likely. A Conflict is shown with both values and both links. Unverified notes are left out of shortlist cards; the program page still has them. A status_note shows as 'Note' only on ACTIVE programs, because RuledOutCard already shows its own.
- The eligibility warning sits right under the fit badge so it is read before the numbers. It is visually distinct (left bar in Conflict colours, '!' glyph and the words 'Who it's for:'), and it says it does not change the fit result. The desktop table uses compact <details> markers that work without JS.
- Student-facing fact.note is now shown under deadline, tuition and study time in the shortlist, as on the program page. review_note is never read by any shortlist component.

### Chat (src/lib/chat/**, src/app/api/chat/**, src/components/chat/**, src/app/ask/**)

- Dates in the safety net come from row VALUES only, which include the student-facing note and conflict-source values. Evidence snippets, fetched_at/checked_on and the question are excluded, as instructed; a date the model takes only from a snippet now falls back to the plain fact list. A fetch date is still accepted when the answer itself says 'checked/fetched/as of/verified on <date>', so a model citing its check date doesn't trigger a needless fallback. Numbers still use everything the model saw plus the question, so the model can refute a number the student typed.
- unsupportedDates(answer, rows) no longer takes a question argument, so a typed date can never support an answer.
- eligibility_note is a 'secondary' chat field: it only appears when the program has a value, never as an empty 'not verified' row, so it can never cause a refusal on its own. Its keyword patterns are WEAK, so 'Am I eligible for scholarships/PR?' stays a scholarship/PR question and the Imperial deadline refusal demo is unchanged. It is never attached to unrelated questions, so it never decides anything.
- A note is appended to the row value as '<value> Note: <note>'. For country facts, clock_note and note share one 'Note:'. Only the `note` field is read; review_note is never touched.
- The prompt (rule 6) now also says: a date or number in the question is not evidence; checked_on is never a deadline or start date; include a value's 'Note:'.
- 'Can I get a Graduate/work/post-study visa?' is NOT a prediction, because it asks about the work-after-study rule we hold data on. 'Can I get a UK student visa?' and every 'Will I get <described> visa/admission/offer/...' are predictions.
- Roman Urdu future markers count as a prediction only next to an outcome word (visa, admission/dakhla, offer, scholarship, PR, job/naukri, ...), so 'TUM ka deadline kahan milega?' is still answered. 'mil sakta/sakti' (can get) is a prediction only for visa/admission/offer, matching the English rule that 'Can I get a scholarship/PR?' asks about rules.
- isJsonContentType is defined in src/lib/chat/request.ts instead of importing it from src/lib/program/report.ts, so the two areas aren't coupled while being edited in parallel. It is stricter than report's: only a charset parameter is allowed.
- isCrossOrigin also accepts x-forwarded-host as a match, for proxies. This doesn't weaken CSRF protection because a cross-site page can't set that header without a preflight. A missing Origin is allowed and still rate-limited.
- clientIpFrom uses the rightmost entry even for x-vercel-forwarded-for and x-real-ip. That equals the platform's value when it sets one IP, and is still safe if a proxy appends.
- The /ask suggestions moved to src/app/ask/suggestions.ts because Next page files may only export page-related names, and the test needs to import the list.

### Consultant Check (src/lib/consultant/**, src/components/check/**, src/app/check/**)

- Work after study: when the rule names more than one length or has a date condition, the answer is always cant_verify, even when the claimed length appears in the rule. The explanation then says the claimed length is one of the lengths in the rule. I chose this over a green 'matches' because, for example, a 2027 Masters graduate would get 18 months, not 2 years.
- PR and citizenship: a time equal to or longer than the minimum is always cant_verify, whether or not study time is mentioned. Detecting study time (from the clause plus the sentence) only changes the wording. A shorter time is 'conflict' only if it is also shorter than every length the rule text names.
- A finding counts as 'quoted' when its deciding rows have snippets. When a comparator does not say so explicitly, this means every source of the finding has a snippet. A verdict is 'official page' when at least one deciding finding is quoted. Cost results therefore get the official-page label only if tuition, living costs, length and the exchange rate all have exact words.
- Programme notes (status_note and eligibility_note, usable or Conflict only) are added to every non-country claim that names the programme. They come first for admission promises and last otherwise. They are never added to PR, work or visa claims.
- The summary tiles use short category names ('Differs', 'Can't verify', 'Matches'), and the summary sentence says 'against the official information we hold'. A count can include summary-based verdicts, so it must not claim 'official page'.
- The ClaimCard source heading is now 'What the official sources we hold say'. The verdict badge takes an optional label and wraps labels over 30 characters, so it does not overflow at phone width.
- German snippets reuse evidenceLanguage() from '@/lib/citizenship' (read-only import, no edit to that file).

- **No loading.tsx on /program/[id], /shortlist and /check.** On a fully server-rendered page, the loading boundary makes the browser paint the skeleton first and swap in the real content only after parsing the whole document, which pushed mobile LCP to 3–3.6 s (Lighthouse 78–89). Without it: LCP 0.9–1.1 s, performance 93–100. The server answers in 20–180 ms, so in-app navigation barely needs a skeleton. /plan-b and /citizenship keep theirs (they score 100 with it).

## Restyle (24 Nov 2026, night) — styling only, no feature/data/logic/route changes

- **Palette from the brief, all in `src/theme.ts`.** forest-950 bars and hero, bark-900 headings, olive-600 fills (primary hover, active chips, rank badges, "Meets minimum"), olive-100 tint, stone-100→#DDD7CC page gradient, stone-50 cards, stone-300 dividers, sky-700/sky-100 for official evidence.
- **Contrast-safe text variants** (the brief also requires ≥4.5:1 everywhere, and a few exact pairings fall short):
  olive text uses **olive-700 #4C5B19** (olive-600 is 4.1:1 at the bottom of the page gradient); source-link text uses
  **sky-800 #275C8D** (sky-700 is 4.4:1 on stone-100 and on sky-100); form controls use a **#6E675B** border (stone-300 is too
  faint for an input edge); muted text on the dark bars is **#B9B2A6** (8.5:1). The brief's hex values are kept for fills,
  bars and borders. `src/theme.test.ts` checks every text colour against every light surface, both gradient ends, the dark
  bars, all badges and fit labels.
- **Likely badge background nudged from #F6E7B0 to #F8EBBB**: at the brief's value its lightness is almost identical to the
  Verified badge, which breaks the brief's own "differ by lightness" rule. Badges also carry icons (check, ~, ?, warning).
- **Blue means "verified by an official source", nothing else.** Every data link (they all carry `rel="nofollow"`) is blue via
  one CSS rule; internal links are olive. Evidence toggles, evidence quotes, coverage bars for verified facts and the Verified
  badge are blue. A test fails if any other semantic token is blue.
- **Display font**: Outfit Light (300) via `next/font` (self-hosted, Latin subset, 14 KB, `display: swap`, size-adjusted
  fallback), loaded on Home only, used only for the 52px+ hero wordmark. Headings and UI use the system stack at 600;
  Tailwind's bold weights are capped at 600 in the theme. Swap fonts in `src/components/home/hero.tsx` + `fonts.display`.
- **Buttons**: primary = forest-950 pill, 52px, stone-100 text, CSS-mask arrow, olive-600 on hover/press; secondary =
  transparent with a 1.5px olive border; accent = olive-100 fill; warning = Conflict colours. Inputs keep 16px corners.
- **No backdrop blur** (the old translucent header is now solid forest-950). Soft shadows only.
- Result: Lighthouse mobile 100/100/100 on Home, Shortlist, Program, Plan B, Citizenship and Check; CLS 0. 360px screenshots
  are in `docs/screenshots/`.

## Feasibility wave (24–25 Nov 2026): deep audit → data → fixes

An audit walked the live app as six kinds of students and probed every engine; 41 proposals with evidence
(`deep-audit-proposals`), plus official-data research checked by adversarial verifiers. Data decisions:

- **New fields.** `conditional_admission` (an official route below the regular minimum: NYIT GPA 2.5–2.84, UCCS
  provisional, Würzburg aptitude test), `language_waiver` (whether a Pakistani degree can skip the English test, per
  university), `GpaRule.alternatives` (another minimum printed in the SAME snippet, e.g. Brookes "60% or GPA 2.7"), and
  the country fact `proof_of_funds` (money to show for the student visa: UK, DE, CA, US; CH not verified). None of these
  ever changes a fit label.
- **Visa money is shown, never ranked**: the four rules are not comparable (UK monthly × 9 plus fees; CA excludes
  tuition; DE blocked account; US set by the school's I-20).
- **Trimmed to the snippets**: researcher summaries that said more than their quotes were cut (UK family members,
  DE deed of obligation, NYIT GRE line, CA Quebec inference, US interview line). Companion quotes from the same page are
  shown as "The same page says: …" or kept in `review_note`.
- **Intake notes** for TUM, Würzburg, Toronto, UIUC and UCCS reword only their existing deadline snippets.
- **Exchange rates remain a human step**: the State Bank of Pakistan publishes rates only as PDFs or behind a bot wall,
  which we respect. Until a person enters them (needs-human path), PKR totals and the budget filter say so explicitly.
- `dhs.gov` and `diplo.de` (German missions) were added to the ingest allowlist.

### Feasibility wave — code decisions by area

#### offline banner + glossary

- The banner is a strip in the normal page flow under the sticky header, not a sticky or fixed overlay. At 360px the wording takes about 3–4 lines, and pinning it would cover content. Being in the flow means it only moves content while the browser is actually offline. While online it adds nothing, so CLS is 0.
- The banner's server snapshot is 'online' and only navigator.onLine === false counts as offline, because onLine being true only means the browser may be online. The strip uses the olive-100 accent-soft colours. It does not use the Conflict or Likely colours, because those carry status meanings, or blue, which is reserved for official sources.
- The banner may also appear on the /offline fallback page. I did not hide it by pathname, because when the service worker serves /offline for another URL the pathname is wrong. The wording says 'may be seeing', so it stays accurate there.
- Glossary definitions are meanings only. They contain no digits, number words, months, currencies, URLs, scores, durations or amounts, and a test enforces this. Statements about rules stay generic and point to the country or university as the decider (for example 'Each country sets its own amount'). The conditional-admission entry repeats the product rule that a conditional route never changes the fit result.
- The glossary is grouped by stage (grades and documents, tests and credits, offers and routes, visas and money, after your studies) with 5 tap-sized jump chips, not 24 alphabetical chips, to keep it short on a phone. Each term has its own anchor id for deep links. Group anchor ids are distinct from term ids (tested).
- Suggested DECISIONS.md entry, since that file is not mine: 'Offline banner (#39): client leaf, inline under the header, empty role=status while online; no SW change; slow-network fallback not detected. Glossary (#40): /glossary is static, meanings only (tested: no digits, numbers, dates, money, URLs or chance wording); no Roman Urdu or official links until a human signs them off; link to terms with glossaryHref(id).'

#### Citizenship & cost

- proof_of_funds was added to ROW_FACT_KEYS with the label 'Money to show for the student visa'. It is kept out of COST_FACT_KEYS and CITIZENSHIP_RANK_KEYS, so 'Typical cost per year' and every ranking are unchanged. A test checks that rankings are identical with or without visa-money rows.
- The block is built from a pure view, visaFundsView(fact, fx, now). Code decides every line (state, amount, PKR line, how it is checked), and the components only render it.
- A PKR equivalent appears only when both the amount and the exchange rate are Verified/Likely. Its badge is the weaker of the two, and it shows the rate's checked date and the words 'The official amount is the one in <currency>'. An Unverified amount is never converted, even when a good rate exists.
- Copy for the no-rate case is exactly 'No verified PKR rate yet'.
- The 'not comparable' explanation is written in general terms, with no numbers and no country names ('per month or per year, with or without tuition, or worked out by your university'). Each country's specifics stay in its own sourced rule text, so the explanation cannot go out of date when the data changes.
- 'How it is checked' (the clock_note) is shown only when the row has one. It does not say 'Not verified yet' when missing, because UK/DE/CA have one and the US rule text already explains the I-20 check.
- In the table, the block sits in a full-width sub-row under each country (colSpan 6, indented under the country column, max-w-3xl) instead of the narrow 15% cost column. The label includes the country name for screen readers only.
- CountryCard and CountryTable now require an fx prop. If a caller forgets it, the type check fails, so PKR lines cannot disappear silently.
- fact-parts now exports NoteLine, ConflictSources, ValueDetails (with a new optional clockLabel; the label stays one text node so 'Details: </span>' markup is unchanged) and EmptyFactDetails, which was moved out of FactSummary with no change in behaviour.
- The page subtitle and metadata description now mention the money to show for the student visa.

#### Shortlist

- Passed deadlines: only a usable (Verified/Likely), readable date that code has compared with now goes to 'Not ranked' with 'Deadline has passed (<date>). The next deadline is not verified yet.' Today counts as open. An Unverified past date keeps 'Deadline not verified yet', because code never computes with unusable dates. No next-cycle date is invented.
- Days are UTC calendar days, the same count isoToDays and deadlinePassed use. Days left is computed and shown only for usable dates, so an Unverified or Conflict date never gets a countdown. 'Closes today' and 'Date has passed' use the conflict colour; other countdowns use ink.
- The 'Deadlines in the next 30 days' window (CLOSING_SOON_DAYS=30, 0..30 inclusive) is a UI constant, not a fact. The strip only re-shows rows already listed, so country, fit, intake and budget filters apply, and 'Can't check' rows are included. It never ranks, filters or changes fit.
- The conditional-route row is hidden when the fit is MEETS_MIN, because the regular route already applies and the row would only add clutter. It shows for Below minimum, a range that crosses the minimum, and undecided fits. Only usable values show; a Conflict is left to the program page. Code never compares the student's grade with the route's min. The row says 'It does not change the fit result.'
- The Plan B link appears only for pathway_type 'direct' with BELOW_MIN or STRADDLES_MIN. Its href keeps the profile query from the URL; when the profile came from the cookie, /plan-b?target=<id> reads the cookie the same way.
- The budget explanation appears when no exchange-rate row passes pkrRate (cost.ts), so it automatically respects FX_MAX_AGE_DAYS. Behaviour is unchanged: programs still go to 'Can't check' with per-program reasons.
- Share link = onboarding shortlistHref(profile) (cgpa, scale, field, min_pass, budget, countries), plus rank and dir when not the defaults. It is built on the server so the client leaf stays tiny (no zod in the client bundle). navigator.share gets the text with the URL inside it to avoid a doubled URL. The WhatsApp link carries no rel=nofollow, so it is not blue (blue = official sources only).
- Total-cost caveats show only when a total (PKR or native) is shown. Without a total, the tuition and living notes already appear under Tuition, so they are not repeated.
- The empty-field card was extracted to a component so it can be render-tested. The fallback field is 'cs' only when the dataset has active CS programs. This is navigation only; no program is relabelled.

#### Program page

- Entry requirements order: eligibility_note, min_gpa_rule, conditional_admission, language_req, language_waiver, tests_required; PROGRAM_FACT_KEYS uses the same page order, so the report form lists them there too.
- conditional_admission.text is a team summary, so it is shown as 'In short: …' (never quoted); the floor line "This route's minimum: …" appears only when min is not null.
- Countdown ('N days left') and the calendar button appear only for usable (Verified/Likely) deadlines; Conflict sources and Unverified values show the date only (previously each conflict source got a countdown too).
- The route-below-the-minimum block shows whenever the program is active, the route is usable, and the fit is not 'Meets minimum' (BELOW_MIN, STRADDLES_MIN, MIN_NOT_VERIFIED, MIN_CONFLICT, NO_CONVERSION_RULE, CONVERSION_RULE_UNSOURCED). In live data the routes (NYIT, UCCS, Wuerzburg) sit on programs with no verified minimum, so limiting it to BELOW_MIN would never show it. It never compares the student's grade with the route floor and never changes the label.
- Plan B link is built from the profile actually used (link or device) with the same param keys as shortlist links (cgpa, scale, min_pass, field, budget, countries); university, degree and persona never go into a URL.
- Ask the university: questions only for applicable Unverified fields (Conflicts keep their own both-sources email), status_note and admissions_email never asked, a transcripts question always appended (the checklist item is always 'not verified yet'), so the card shows on every program. The email builder lives in src/lib/program/ask-university.ts instead of src/lib/email.ts (not my file). mailto only when the admissions email is usable AND email-shaped.
- Calendar: all-day event on the stated date with no time-zone inference; cut-off times stay in the note text. Two VALARMs (-P7D, -P1D). The server only passes events that had not passed at render time; the client re-checks with its own clock and builds the .ics (DTSTAMP) at click time, so nothing time-relative is baked into the static page. Button lives in src/components/program (not ui) because I own only days-left.tsx in ui.
- CostSummary reads cost.caveats defensively (strings or {text}) because CostResult does not have the field yet; renders as 'Note: …' list items.
- The FitPanel full-panel HTML legitimately contains 'It is not a chance of admission', so the route-block copy is checked separately for banned wording in tests.

#### core engines + profile + Supabase mapping

- min_pass is kept when 0 <= min_pass <= cgpa and min_pass < scale max. This follows proposal #18 and the existing validateOnboarding/validateQuickStart rule (a pass exactly at the minimum is real). It differs from the task text's strict 'min_pass < cgpa'. An impossible min_pass is dropped to null and the profile is kept.
- Unknown country codes in links are kept, normalised, not dropped, so a link never silently widens to 'All countries'. Only GB is mapped to UK, and duplicates are removed.
- A junk or negative budget, or a junk CGPA, rejects the link (profileLinkStatus 'rejected', getRequestProfileState.linkRejected). A junk or impossible min_pass is only dropped, because it is optional.
- Budget 0 means 'no budget set' (null). This is decided once in profileSchema, so Shortlist, Plan B, the profile summary, cookies, Supabase rows and onboarding all agree.
- Whole-term totals apply to tuition and living cost alike: per-year needs months % 12 === 0, per-semester needs months % 6 === 0, per-month needs whole months, and 0 or negative months never total. Fees are charged per term, so a pro-rated figure would be a number no official page states.
- FX_MAX_AGE_DAYS = 45. An FX row with no fetched_at, or in Conflict, gets its own explicit reason rather than a generic one.
- Unsourced alternatives (blank source_url) never create a Conflict, but stay in allSources() for display. A sourced alternative without a snippet still creates a Conflict.
- Percentage fit messages say 'N out of 100' (never a '%' sign), so the existing no-%/no-probability guard still holds.
- mentionsNumber is shared from seed/text-rules.ts and now treats '4.0' and '4,0' as 4. Without that, Würzburg's conditional minimum 4 would wrongly fail against its snippet. Ingest review notes become slightly more lenient for whole numbers printed with '.0'.
- Country-fact round-trip tests normalise only note/review_note null to absent: a flat nullable column cannot tell the two apart, and both mean 'no note'. Every other key is still compared deep-equal.
- validateSeedRows now also applies PROGRAM_FACT_GUARDS, so the seed script and the Supabase reader share one value contract (a deadline that is not YYYY-MM-DD, or 0 months, is refused before writing).

#### Plan B

- A conditional route is scored against its OWN lower limit: SCORE_POINTS.feasibility.conditional = 3 (the middle value, the same as 'range crosses the minimum'), known=true because it rests on a Verified/Likely fact. Without this NYIT and UCCS could not be ranked, since their regular minimum, cost and recognition are all unverified. It never scores as the best, and the fit label is untouched.
- For conditional routes built from conditional_admission data, CONDITIONAL replaces the generic PROGRESSION_NOT_GUARANTEED. That warning talks about 'progression to the Masters', which is misleading when the route is the Masters itself. CONDITIONAL is always present and a verified progression guarantee cannot remove it. pathway_type 'conditional' programmes without data keep the old progression warning.
- No conditional route is added when the student already 'Meets minimum' (the lower-floor direct route covers it). ConditionalAdmission has no upper bound, and we never parse one out of the text.
- Plan B shows the VERBATIM evidence_snippet as the official text of a conditional route and falls back to 'In short:' + value.text only when no snippet exists. Reason: DECISIONS says 'quoted text = verbatim only', and NYIT's value.text says 'you may be given the chance to qualify', which hits our banned 'chance' wording.
- The not-decided list covers direct Masters in the student's field and countries whose regular fit has no sort value (MIN_NOT_VERIFIED, MIN_CONFLICT, NO_CONVERSION_RULE, CONVERSION_RULE_UNSOURCED, INVALID_INPUT), plus programs whose conditional route is undecided. STRADDLES is decided (it is rankable) and is not listed. Programs that also appear as routes are listed with an 'Also shown above as a route' pill, and the target with 'Your target'.
- DEADLINE_PASSED is listed right after ELIGIBILITY (order: ELIGIBILITY, DEADLINE_PASSED, CONDITIONAL, CONDITIONAL_NO_FLOOR, PROGRESSION..., then cost and recognition). A deadline dated today has not passed (days are UTC calendar days). The target card shows its deadline row but gets no warning, because it is the comparison and not a route.
- daysUntil is a local copy in src/lib/planb/deadline.ts, not imported from src/lib/program/render.ts, so the two areas stay independent while being edited in parallel (same reasoning as chat's isJsonContentType).
- ?target= checks run in this order: not found → ruled out → outside field or countries → not direct. Every notice names '<program> at <institution>'.

#### Chat

- The deadline status sits between the date and the 'Note:' ('30 Nov 2026 (6 days left) Note: …'), so the model, the fallback list and 'Sources used' all repeat it. Days are UTC calendar days, the same as program/render.ts daysUntil and shortlist isoToDays. I wrote my own small helper instead of importing render.ts, so the chat is not coupled to an area being edited in parallel (same reasoning as isJsonContentType). The passed text never names a next date.
- Companion rows attach only next to an asked row that is USABLE. Otherwise a sourced waiver or conditional row would flip a 'not verified yet' refusal into a model answer (seen with the CMU IELTS question and the NYIT minimum).
- language_waiver and conditional_admission are normal fields when asked directly, so a named program with no data gets an explicit 'not verified yet' row ('Can I apply to TUM without IELTS?' is a code refusal). They are listOnlyKnown in listings across programs, so a list is not padded with empty rows.
- The conditional route value is the official text plus the structured minimum: 'Lowest grade this route names: X (scale)'. On the German scale it says 'Weakest'. A null minimum adds nothing, so no floor is ever invented. The chat never computes or shows a fit label, and rule 11 forbids saying a route or waiver qualifies the student.
- The fuzzy matching uses a hand-picked word list (FUZZY_NAME_WORDS in retrieve.ts), not the alias lists. Acronyms are excluded, and so are words shared with other universities or common English (oxford, munich, zurich, florida, colorado, liverpool, urbana, queen, south), so a near miss never points to the wrong university (e.g. 'Oxford' is never suggested as Brookes).
- A near miss takes precedence over the page's programId scope and retrieves no rows. The corrected question swaps only the misspelled word (with original-word lookup that handles accents and apostrophes) and is capped at MAX_QUESTION_CHARS. The new RefusalReason 'unknown_name' shows the title 'Name not found'.
- 'oxford brooks' (two words) is an exact alias because it is unambiguous; 'Brooks' alone gets the 'Did you mean' suggestion instead of a silent match.
- Sperrkonto / blocked account are DE country hints and GIC is a CA hint: each term belongs to one country. I-20 was rejected as a hint because its normalised form 'i 20' collides with ordinary sentences.
- Switzerland's missing proof_of_funds row gets the existing 'not_verified' refusal (code-built, model never called, official-website pointer) rather than a new 'no_data' text. It is the same 'no data = no answer' behaviour and keeps one refusal wording.

#### Consultant Check

- New ClaimTypes: 'tests' (label 'GRE / GMAT'), 'language_score' ('English test score'), 'visa_money' ('Visa money'). Claim gains score, scoreMode, fundsKind, fundsItem; test is reused for GRE/GMAT.
- GRE conflict rule is conservative: any 'if' in the row counts as a condition, so NYIT ('required if you are a graduate of a foreign university') is cant_verify, not conflict.
- Language scores: lower -> conflict with the official number; equal -> matches; higher -> matches only for 'is enough'-type claims, cant_verify for a stated higher minimum. TOEFL <= 6 is treated as the new 1-6 scale and never compared with old-scale minimums.
- The usable language_waiver row decides 'no IELTS / MOI' claims before language_req. The 'not exempt' test reads the waiver VALUE (our verified wording), because snippets are partial country lists. Wuerzburg moved from 'matches' (language_req.waiver) to cant_verify (conditions).
- Conditional routes never produce 'matches' and only replace a non-matching finding. Wording uses 'programme' (page convention) instead of the brief's 'program': 'This programme publishes a route below its minimum: <text>'. Our wording of the route is unquoted; its exact words are in the source.
- GpaRule.alternatives are read directly in compareGpa before computeFit (same-scale minimum, no conversion), so core's computeFit support will not double-count.
- Visa money is never 'matches' (showing money is a condition, not a promise). Same currency: any lower amount differs; via fx: under 98% differs. A claim with no period is compared with the row's own period; month<->year are converted, other periods are not compared.
- Pakistan restriction applies to every intake of the programme (the code does not parse which intake a notice covers) and to ruled_out programmes; it only turns 'matches' into cant_verify, and an existing 'conflict' stays.
- After the official deadline has passed, a claim with no year is treated as possibly the next intake (cant_verify) unless its day/month equals the official one.
- Text-fallback context: when a clause/sentence names a country, institutions borrowed from elsewhere in the text are limited to that country.
- Suggestions: diacritics are stripped before fuzzy matching (so 'Zürich' is not a misspelling of 'Zurich'), and a suggestion is shown only when the rerun link would match the institution exactly.

#### Integration

- The NYIT conditional route text says "the opportunity to demonstrate qualifications" (the snippet's words), not "chance".
- Shortlist and Plan B say "We could not read the profile in this link, so we show the profile saved on this device" when a shared link is malformed.
- Tuition ranking reasons come from the cost engine (stale rate, undated rate, conflicting rates, non-whole terms).
- Chat minimum-grade rows include the percentage alternative printed in the same snippet.

- **No loading.tsx on /citizenship either** (it grew with the visa-money blocks): Lighthouse 81 → 97–98, LCP 3.7 s → 1.1 s.

## Supabase backend on the dev project (25 Nov 2026)

Live on the dev project (`dvgcmskrjlqxauqbsipg`, the only project in the account, empty before this). Migrations applied
with the Supabase MCP and saved in `supabase/migrations/`; the applied SQL was checked against the files (md5).

- **Kept the init schema; ported the "program_facts" design on top of it (product owner's choice).** The pasted design
  (uuid ids, country names, `'4.0'` scales, USD budgets, a `program_facts` table, signed-in report inserts) reused the
  same table names as `20261124000000_init.sql` but not its shape, and ~2,000 lines of mappers, account code and tests
  depend on the init shape. Its ideas are added as views and functions instead: `program_facts` unpivots the jsonb
  fact columns (one row per source), `computed_confidence()` + `program_facts_computed` / `country_facts_computed`
  compute confidence on read, `program_fact_conflicts`, `rank_programs` / `rank_countries`. Undo: drop the 20261125
  views/functions; nothing in the init schema changed except one CHECK (below).
- **Confidence labels keep the app's casing** (`Verified`/`Likely`/`Unverified`/`Conflict`), and the SQL rule mirrors
  `src/lib/confidence.ts` (basis summary/inferred = Likely at best; Conflict wins). A live check confirmed SQL and app
  agree. New CHECK `country_facts_verified_needs_evidence`: the confidence cache can never say Verified without
  source, snippet and date (the pasted `verified_needs_evidence` rule, applied to the one stored confidence column).
- **Ranking units.** Money is normalised to USD as asked (tuition/living per year, total for the whole programme),
  through `fx_rates` (PKR per unit, usable and at most 45 days old, like `cost.ts`). Every rate is still "Not verified
  yet", so today only USD fees can rank by money; CHF/EUR/GBP rows say which rate is missing. Deadline = days since
  1970-01-01, and a deadline that has passed is not ranked (same as the shortlist). Country rules rank by
  `value.sort_months` (months, the existing contract), not days. Ruled-out programmes are not returned by
  `rank_programs`. Fit is never ranked in SQL.
- **Migration file names** are `20261125000001_schema.sql` … `20261125000004_seed.sql`, not `20261125_001_schema.sql`:
  the Supabase CLI takes the digits before the first `_` as the version, so four files would all be version
  `20261125` and `supabase db push` would fail on the duplicate. Order and names are otherwise as asked.
- **Seed = the reviewed `data/*.seed.json`, not the hand-typed seed rows from the request.** The JSON already holds the
  same 15 programmes and the same country rules, mostly from more official pages. Differences in the pasted rows that
  were NOT applied: UK `citizenship_rule` = 10 years (that is the settlement/ILR rule from a law-firm summary; the JSON
  has it as UK `pr_route` = 120 months from gov.uk, and UK citizenship stays "Not verified yet"); DE dual nationality
  from asylumineurope.org (JSON: Federal Foreign Office); UK Graduate visa from gla.ac.uk (JSON: gov.uk); DE citizenship
  from a bundesregierung.de URL that now redirects to a login page (JSON: Federal Foreign Office); pathway types
  Würzburg `score_based`, CSUDH and NYIT `conditional` (JSON: `direct`; their conditional routes are facts instead);
  shorter programme/institution names. LJMU matches (ruled out, unverified note). `004_seed.sql` is generated by
  `npm run seed:sql` and was applied in four parts (the MCP call size limit); the database rows were checked
  byte-for-byte against the JSON (per-row md5 of the jsonb text). It is a snapshot: later JSON edits go in with
  `npm run seed:supabase`, not by regenerating an applied migration.
- **Reports stay service-role only.** `createReport` in `src/lib/queries.ts` inserts with the service role after
  `/api/report` has validated, origin-checked and rate-limited the report (not with the user's session as the request
  suggested: anonymous reporting is a feature, and a direct PostgREST insert would skip those checks). `reports` and
  `chat_usage` got RESTRICTIVE deny-all policies for anon/authenticated: no behaviour change, but the intent is now in
  the database and the "RLS enabled, no policy" notice is gone. `tests/supabase/migration.test.ts` now allows only
  such deny-all policies there.
- **Pages.** All pages already read Supabase through the data layer (`src/lib/data`: one cached query per table,
  revalidated hourly, no N+1) as soon as the env vars are set. Shortlist and citizenship ranking stay in the tested
  TypeScript engines (fit, intake and budget filters, PKR totals); `rank_programs` was checked to give the same order
  as the app for study time and deadline. The account Server Functions and `/api/report` now go through
  `src/lib/queries.ts`. `addStrength` / `deleteStrength` exist for a per-item UI; the current UI saves the whole list.
- **Typed clients**: server, browser and admin clients use the generated `Database` type (`src/types/supabase.ts`).
- **Advisors**: security 0 findings. Performance: only "unused index" (INFO) on a 15-row database; kept.
- **Keys**: `.env.local` holds the URL and the legacy anon key only. The service-role key must be pasted in by the
  owner (needed for accounts, stored reports and `seed:supabase`); it is never used in browser code.
- **Fields without programs are labelled in the pickers (25 Nov).** Only Computer Science has programs, but the
  home and profile pickers offered Data Science / AI, Software Engineering, Electrical Engineering and Other with no
  warning, and choosing one led to an empty shortlist headed "0 of 0 ... fully verified". The pickers now say
  "Electrical Engineering (no programs yet)" (from the dataset: `getFieldsWithPrograms`), the fields stay selectable
  (the empty page explains how to add programs and links to the closest field), and the coverage meter is hidden
  when a field has no programs. The home page now reads the dataset, so it is refreshed hourly instead of fully static.

## Redesign: Home, shortlist, program page (27 Nov 2026)

- **21st.dev components, ported, not installed.** The "Bento Grid" (karaui) and "Scroll Spy" (ddoemonn) components
  were the references; both depend on `motion/react` and `lucide-react`. They are rebuilt on Tailwind + theme tokens
  (`src/components/ui/bento.tsx`, `scroll-spy.tsx`) with CSS animation, so no new dependency, no new colours, and
  the strict CSP is unchanged. The stat tiles (`ui/stat.tsx`) follow the 21st.dev "Data Card" pattern.
- **Works without JS.** Bento tiles are server-rendered links (stretched CTA, one tab stop); the cursor spotlight is
  decorative (CSS variables set by a tiny client listener, mouse only). The scroll-spy bar is plain `#anchor` links
  until hydration. Load-in animations end visible and are off under reduced motion.
- **Home**: hero numbers (programs, countries, verified facts) come from `homeStats` over the dataset (tested), never
  copy. New FAQ is a native `<details>` accordion; answers restate existing product rules. No FAQPage JSON-LD,
  because it needs `dangerouslySetInnerHTML` (product rule 9 / lint).
- **Shortlist**: counts became stat tiles; the original sentence stays as the `role="status"` live region (sr-only).
- **Theme**: new shadow tokens (`button`, `button-soft`, `lift`, `dock`) in `src/theme.ts`; buttons and chips get
  fills, borders and a press state; the mobile bottom nav is a floating dock with the active tab on an olive-100 pill.
- **Home hero is typography only (owner's request, 27 Nov).** After the 21st.dev "Animated Hero" / "Text Cycle"
  pattern: pill badge, large centred headline whose last line cycles "honestly. / for free. / with sources. /
  no guessing." with a per-letter blur (`src/components/home/text-cycle.tsx`, no motion library), one paragraph,
  two buttons, live dataset numbers. The h1 carries the full sentence for screen readers; the cycling text is
  aria-hidden and stops under reduced motion. The quick-start form moved to its own "Start here" card (#start).
- **Chat can use xAI Grok (owner's request, 27 Nov).** `src/lib/chat/xai.ts` implements the same `ChatModelClient`
  over xAI's OpenAI-compatible streaming API with plain fetch (no new dependency). Provider choice is one function
  (`src/lib/chat/provider.ts`): `XAI_API_KEY` wins, then `ANTHROPIC_API_KEY`, else the no-AI answer. Grok's
  `content_filter` maps to `refusal` and `length` to `max_tokens`, so the existing fallback and "…" handling apply;
  the same rate limits and daily token budgets apply. The privacy page names the provider actually in use.
  Default model `grok-4` (override with `XAI_MODEL`): sources disagreed on the newest model id.
- **Groq added; the connector is shared (27 Nov).** The owner's key was from Groq (groq.com, `gsk_…`), not xAI
  Grok, so the xAI client became `src/lib/chat/openai-compat.ts` (any OpenAI-compatible API) and Groq is the first
  choice (`GROQ_API_KEY`, default model `openai/gpt-oss-20b` from Groq's production list, `reasoning_effort: low`).
  Because the names are easy to confuse, a key's prefix wins over the variable it was saved under (`gsk_` = Groq,
  `xai-` = xAI). Only `delta.content` is shown; reasoning deltas are ignored. Errors log the provider's short reason.
- **Chat answers everything (owner's decision, 27 Nov; supersedes "no data means no answer" for the live site).**
  When the rows cannot answer (no data, not verified, conflict, unknown name, prediction, legal, greeting), the model
  answers from general knowledge (`mode: 'general'`, `GENERAL_SYSTEM_PROMPT`), shown under a yellow "AI answer from
  general knowledge" label with "may be wrong or out of date; confirm on the official page". Reference rows (e.g. a
  not-verified deadline's official page) are passed so it can cite them. Fraud help ('dishonest') never reaches the
  model. Data answers may add a "General advice:" paragraph (rule 12), still under the number/date post-check. If the
  call fails, the rules' reply replaces the partial text (`reset` to refusal). Off switch: `CHAT_GENERAL_KNOWLEDGE=0`
  (the strict data-only mode stays the default inside `answerQuestion` and keeps its tests). The owner was told the
  trade-off: answers outside the data can be confidently wrong.

## Playwright for JavaScript-only official pages (27 Nov 2026)

- **Why.** Some official pages only have their text after JavaScript runs (and some facts, like the ETH programme
  contact e-mail, sit in the rendered page only). `src/lib/net/render-fetch.ts` reads them with Playwright 1.65.1
  (pinned, devDependency) and Chromium. Same return shape as `safeFetch`, so ingest and the verifiers use either.
- **Same policy, enforced by us.** Allowlist/https/credentials/IP-literal checks and a public-address DNS check run for
  the first URL and for **every sub-request** (`page.route`); robots.txt (same parser, same User-Agent with the contact
  URL, same cache) and the shared per-host throttle run for every page navigation (sub-requests are not throttled: they
  are part of one page view). Images, media, fonts, pings and websockets are blocked. 20 s budget, 3 MB of text,
  fresh browser and context per call, no cookies carried over, no downloads, pop-ups or service workers.
- **Redirects are followed by our code, not by Chromium.** Chromium does not route redirect hops through
  `page.route`, so a redirect to another host would have skipped every check (found by a test). Sub-requests are
  fetched through `route.fetch(maxRedirects: 0)` and each hop is validated; a main-page redirect aborts the hop and
  navigates to the validated target.
- **Known limit.** Chromium resolves DNS itself, so unlike `safeFetch` the connection is not pinned to the addresses
  we checked; a DNS rebind between our check and Chromium's lookup is possible in theory. The renderer is an offline
  tool with an allowlist of official domains, and it is used only as a fallback, which is why this was accepted.
  Sub-requests to CDNs that are not on the allowlist are aborted on purpose; a page that needs one will render partly
  or not at all, and we report that instead of widening the list.
- **No bot-challenge workarounds.** No stealth plugin, no fingerprint changes, the honest User-Agent stays. A challenge
  page, a Cloudflare `cf-mitigated` header or a redirect to a challenge service (for example Radware's
  `perfdrive.com`) stops the fetch with `BLOCKED_BY_CHALLENGE` and the page goes on the blocked list.
- **Text = visible text.** `innerText` after network idle + a short settle, `<details>` opened, collapsed
  `aria-expanded` buttons clicked (never links) and each tab panel read, then normalised like `htmlToText`
  (one trimmed line per block). The result is `text/plain`, so `pageTextOf` uses it as is. Visible text is not a
  superset of the static text (hidden menus are dropped), which is why rendering is a fallback and not the default.
- **Method is recorded.** Accepted proposals carry `fetch_method: "static" | "render"`; `--verify` re-reads with the
  recorded method. The seed has no such field, so a page that is read with the renderer must be registered with
  `"render": true` in `data/sources.json`; `--verify-seed` uses that flag (otherwise: static, then render only when the
  static page has under 200 characters).
- **CI stays light.** Browsers are installed only in the weekly re-verify workflow (cached); the browser tests skip
  themselves when Chromium is missing, and the policy helpers are tested without a browser.

## UI conventions (2026-11-27 UI pass)

- **One page layout** (`PageHeader`): where you are (journey cue) → title → one-line purpose → primary action → content.
  The cue (`src/components/ui/journey.tsx`) runs Profile → Shortlist → Check → Plan B → Costs and names the next step.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 px only (`gap-1`…`gap-6`, `space-y-3` inside cards, `space-y-6` between page sections).
- **Type scale:** page title `text-2xl` (`md:text-3xl`), section `text-xl`, card title `text-lg`, body `text-base`, small `text-sm`, meta `text-xs`.
- **Unknown values are a next action, not an admission.** A missing fit shows no pill, only a link to the official page
  ("Check the minimum grade on the official page"). Missing details collapse to one "N details not on file yet" line per row.
  The honesty rules are unchanged: no unverified value is shown as verified and no admission chance is ever shown.
- **Reliability sits at the point of use:** each value shows "Source: <domain> · checked <date>" linking to the official page.
  The old "How much is verified" box on the shortlist was removed for that reason.
- **One list, no jargon:** programs that can be put in order are numbered ("Sorted by Fit"); the rest sit under "More programs
  to explore". Nothing is hidden and nothing is mixed into the numbered order.
- Screenshots for review: `node scripts/shoot.mjs docs/screenshots/<dir>` (needs a running `next start -p 3055`).
