# MastersPath

**An open-source, evidence-first guide for Pakistani students applying to Masters programs abroad — without a paid consultant.**

Every number on screen links to the official page it came from, with the exact sentence quoted and the date it was checked.
When we don't have evidence, MastersPath says **"Not verified yet"** and links you to the official page. It never guesses,
never shows admission "chances" as percentages, and the AI chat refuses to answer what the data can't support.

> Not legal or immigration advice. Always check the official website before you apply or pay anyone.

## Watch the 2-minute demo

[![MastersPath demo video](docs/video-thumbnail.jpg)](https://youtu.be/bm-QA92K8MQ)

**Video:** https://youtu.be/bm-QA92K8MQ (1:46, recorded from the real app at phone size)

## What it does

| Screen | What you get |
| --- | --- |
| **Home / Onboarding** | Enter CGPA, scale, field, budget and target countries in under a minute. No account needed. |
| **Shortlist** | Programs with a fit label (*Meets minimum*, *Below minimum*, *Competitive range unknown*), deadline, tuition, citizenship rule, confidence badge and source link. **Rank by** fit, tuition, total cost, citizenship rule, study time or deadline. Rows without verified data sit in a separate *Not ranked: data missing* group — missing is never treated as zero. |
| **Program detail** | Every field with its evidence snippet, source link and checked date. Conflicting sources are shown side by side with a *Copy email to admissions* button. Requirements checklist that works offline. |
| **Plan B** | For "Below minimum": lower-floor direct programs, conditional admission, pre-master's/pathways, score-based and research-led routes, plus *Improve and reapply* — with time and cost versus going direct. An **integrity gate** hard-blocks institutions not on the destination's official recognition list and warns about non-guaranteed progression, high cost and unverified recognition. Ranked by feasibility + quality + cost, never by ease alone. |
| **Citizenship & cost** | Countries ranked by citizenship rule, post-study work, tuition or total cost, each with the exact rule, how the clock starts, a confidence badge and the official link. "Earliest rule, not a guarantee." |
| **Consultant Check** | Paste what an agent told you ("guaranteed admission, no IELTS, total cost 25 lakh"). Each claim is compared with official pages: *matches*, *differs*, or *can't verify* — plus questions to ask them in writing and a WhatsApp share button. It compares claims; it never accuses anyone. |
| **Chat** | Answers only from rows already in the database, cites sources and confidence, and refuses when the data isn't there (e.g. an unverified deadline). |

## How it works

```
official page ──► ingestion script ──► verbatim-snippet check ──► proposal ──► human review ──► seed / database
                    (offline, AI proposes)   (code, not AI)                                         │
                                                                                                    ▼
                         fit · ranking · filters · Plan B · Consultant Check  ◄── plain TypeScript over rows
                                                                                                    │
                                                                       chat: Claude explains the retrieved rows only
```

* **Evidence first.** Each fact is stored as `{ value, source_url, evidence_snippet, fetched_at }` (+ optional `basis`, `conflicts`).
* **Code decides.** Confidence is computed in code (`src/lib/confidence.ts`): *Verified* = verbatim snippet + source + checked within 30 days;
  *Likely* = older, or a summary of an official page; *Unverified* = no evidence; *Conflict* = sources disagree.
  Fit (`src/lib/fit`), ranking (`src/lib/rank.ts`), cost (`src/lib/cost.ts`) and Plan B are deterministic and unit-tested.
* **The model explains.** Claude is used only (a) offline, to propose rows that a validator accepts only if the snippet appears verbatim
  on the official page, and (b) in chat, to explain rows already retrieved. No AI call per search.
* **No data, no answer.** The chat's guard runs before any model call and refuses when the asked field is missing or unverified.

## Run it locally

Requirements: Node 20.9+ (Node 24 recommended).

```bash
npm install
npm run dev          # http://localhost:3000 — works with no keys at all (seed JSON + no-AI chat fallback)
npm test             # unit tests (fit engine, ranking, confidence, chat refusal, Plan B, …)
npm run validate:seed
npm run build && npm start
```

Optional environment variables (copy `.env.example` to `.env.local`):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Read data from Supabase instead of the bundled seed; enable optional accounts. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only: seed script, report storage, hard-delete account. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Server-only: chat explanations via Groq (free tier; default model `openai/gpt-oss-20b`). Used first when set. A `gsk_` key saved as `XAI_API_KEY` also works. |
| `XAI_API_KEY`, `XAI_MODEL` | Server-only: chat explanations with xAI Grok (default model `grok-4`), used when no Groq key is set. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Server-only: chat explanations with Claude (default model `claude-opus-5-5`), used when no xAI key is set. Without any key the chat still answers from rows and still refuses. |
| `CHAT_DAILY_TOKEN_BUDGET`, `CHAT_GLOBAL_DAILY_TOKEN_CAP` | Per-user and global daily spend caps for chat. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile on sign-in and chat. |
| `INGEST_CONTACT_URL` | Contact URL added to the scraper's User-Agent (`+https://...`), so site owners can reach the project. Never invented: without it the User-Agent says it is not configured. |
| `INGEST_RENDER` | Set to `0` to turn off the automatic Playwright fallback for JavaScript-only official pages (a machine without Chromium). |
| `MASTERSPATH_NOW` | Pin "today" for a recorded demo so confidence ages don't change. |

The scripts (`ingest`, `add-programs`, `verify-snippet`, `check-links`, `peek-page`, `seed-supabase`) load `.env.local` (then `.env`) automatically through Node's built-in `process.loadEnvFile`. A real environment variable always overrides the file, a missing file is skipped silently, and no value is ever printed.

### JavaScript-only official pages (Playwright)

Most official pages are plain HTML and are read with `safeFetch`. A few only show their text after JavaScript runs.
`src/lib/net/render-fetch.ts` reads those with Playwright + Chromium under the **same safety policy** as `safeFetch`:
the allowlist, https only, no private addresses, `robots.txt` and the per-host throttle apply, and every redirect hop and
every sub-request is checked again (anything off the allowlist is aborted); there is a 20 s limit, a 3 MB text cap, no
images/fonts/media, and a fresh browser context per run. There is **no stealth and no workaround for bot challenges**: a
Radware/Cloudflare/CAPTCHA page stops the fetch with `BLOCKED_BY_CHALLENGE`.

- Install the browser once on your machine: `npx playwright install chromium`. Normal CI never downloads it (the
  browser tests skip themselves when Chromium is missing); the weekly re-verify workflow installs and caches it.
- It is a fallback: used when `safeFetch` returns under 200 characters of text, or when a page in `data/sources.json`
  has `"render": true`. `INGEST_RENDER=0` switches the automatic fallback off.
- The text is the page's **visible text** (collapsed accordions and tabs are expanded), normalised like `htmlToText`, so
  the verbatim-snippet check works the same way. Proposals record `"fetch_method": "static" | "render"`, and
  `--verify` re-reads a page the same way it was read first (a fact read with the renderer needs its page registered
  with `"render": true`, so `--verify-seed` can do the same).
- `npx tsx scripts/peek-page.ts <url> "<regex>" --render` shows what the renderer sees.

### Supabase

1. Create a project at supabase.com and apply every file in `supabase/migrations/` in name order (`supabase db push`,
   or paste them into the SQL editor one by one):
   * `20261124000000_init.sql`: tables (one jsonb column per fact), CHECK constraints, row level security.
   * `20261125000001_schema.sql`: `program_facts` (every fact as rows, with its evidence), confidence computed on read,
     and the `program_fact_conflicts` view.
   * `20261125000002_rls.sql`: read-only access to those views; explicit deny-all on the service-only tables.
   * `20261125000003_functions.sql`: indexes, `rank_programs` and `rank_countries` (missing data is always listed last).
   * `20261125000004_seed.sql`: the reviewed seed data, generated from `data/*.seed.json` by `npm run seed:sql` (idempotent).
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (in `.env.local` and on Vercel).
3. After editing `data/*.seed.json`, push the changes with `npm run seed:supabase` (upsert by id; safe to re-run;
   `npm run seed:supabase:check` validates without writing).
4. In **Supabase → Auth → URL Configuration**, set the Site URL and add `https://<your-domain>/auth/callback` and
   `http://localhost:3000/auth/callback` to Redirect URLs (without this, magic links never reach the app).
5. Optional: add `{{ .Token }}` to the Magic Link email template so people can type the code when a link opens in another browser.
6. After changing data in the database, pages refresh within an hour (or call `revalidateTag('masterspath-data')`).

Row-level security is on for every table. Users can read and write only their own profile; public data is read-only;
data reports are written only by the server, after `/api/report` has validated them. No passport or ID numbers are
stored anywhere. "Delete my account" is a hard delete. Server code talks to the database through typed helpers in
`src/lib/queries.ts` (types generated into `src/types/supabase.ts`).

### Deploy (Vercel)

Import the repo in Vercel, set the env vars above (none are required), deploy. Program pages are statically generated and
revalidated hourly, so they are served from the edge.

## Contribute data (the most valuable thing you can do)

Read [CONTRIBUTING.md](./CONTRIBUTING.md). In short: every value needs an **official** `source_url` and an `evidence_snippet`
copied **word for word** from that page. Check it with:

```bash
npx tsx scripts/verify-snippet.ts "https://official.page/url" "exact sentence from the page"
```

CI rejects data PRs where a value that would count as Verified lacks its source or snippet.

## Project layout

```
data/                    seed JSON (+ JSON schemas, proposals awaiting review)
src/theme.ts             ALL colours, fonts, radii — change the look in one edit
src/lib/                 confidence, fit, rank, cost, shortlist, planb, citizenship, consultant, chat, data access
src/components/ui/       badges, buttons, chips, cards, evidence rows
src/app/                 screens (App Router) and API routes
scripts/                 seed validator, ingestion, link checker, snippet verifier, Supabase seeding
supabase/migrations/     schema, RLS, evidence views, ranking functions, seed
src/lib/queries.ts       typed Supabase queries (rankings, program + facts, profile, strengths, reports)
src/types/supabase.ts    generated database types
DECISIONS.md             every judgement call made while building, and how to undo it
```

## Licence

MIT (see `LICENSE`). We may move to AGPL-3.0 for code and CC BY 4.0 for data later, so that improvements and data stay open.
