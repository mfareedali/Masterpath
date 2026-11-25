# Contributing to MastersPath

Thank you! The most useful contribution is **verified data**. A student may spend lakhs of rupees based on what this app shows,
so the bar for data is high and simple: **no evidence, no value.**

## Data contributions (programs, country rules, conversion rules, exchange rates)

1. Find the **official** page: the university's own website (program, admissions, fees or international/country page) or a
   government website (e.g. gov.uk, canada.ca, uscis.gov, bundesregierung.de). Not agents, blogs, forums or ranking/aggregator sites.
2. Edit the right file in `data/`:
   - `programs.seed.json` — institutions and programs
   - `country_facts.seed.json` — citizenship, post-study work, PR route, dual nationality, typical costs
   - `conversion_rules.seed.json` — grade conversion rules (e.g. the modified Bavarian formula)
   - `fx_rates.seed.json` — PKR exchange rates (dated, from an official source such as the State Bank of Pakistan)
3. Fill the fact object:

   ```json
   "deadline": {
     "value": "2027-01-15",
     "source_url": "https://www.example-university.ac.uk/msc-computer-science/apply",
     "evidence_snippet": "The application deadline for international students is 15 January 2027.",
     "fetched_at": "2026-11-24"
   }
   ```

   - `value` must match the type in `src/lib/types.ts` (money is `{ "amount": 9500, "currency": "GBP", "period": "year" }`,
     minimum grade is `{ "scale": "cgpa_4", "min": 3.0, "text": "..." }`, dates are `YYYY-MM-DD`).
   - `evidence_snippet` must be copied **word for word** from the page (12–600 characters) and must contain the value.
   - If you are summarising rather than quoting, add `"basis": "summary"` — the app will show it as *Likely*, not *Verified*.
   - Two official pages disagree? Keep the first in the fact and add the other under `"conflicts": [ { …same shape… } ]`.
     The app shows both with a *Conflict* badge. Never pick one silently.
4. Check your snippet appears verbatim on the page:

   ```bash
   npx tsx scripts/verify-snippet.ts "<source_url>" "<evidence_snippet>"
   ```

5. Run `npm run validate:seed` and `npm test`, then open a pull request. CI runs the same checks.

### Never

- Never fill a value from memory, a consultant, a WhatsApp forward or an AI chat.
- Never add admission "chances", probabilities or percentages.
- Never add passport, CNIC or any personal ID numbers.

### Automated proposals

`scripts/ingest.ts` can propose values from an official page using Claude, but it only **accepts** a value when its snippet appears
verbatim in the fetched page, and it writes to `data/proposals/` — never to the seed files. A human reviews proposals before merging.

## Code contributions

- `npm run ci` must pass (tokens, typecheck, lint, tests, seed validation, build).
- Styling values live only in `src/theme.ts` (run `npm run tokens`). Use token classes (`bg-primary`, `text-muted`, …) — the default
  Tailwind palette is disabled on purpose.
- Mobile first (360px). Server components by default; client JS only where interaction needs it.
- Logic that decides anything (fit, ranking, filters, Plan B, claim checks) is plain TypeScript with unit tests. The AI only explains.
- Never render data as HTML (`dangerouslySetInnerHTML` is lint-blocked).
- Log any judgement call in `DECISIONS.md`.

## Reporting wrong data

Use **Report incorrect data** on the program page, or open a GitHub issue with the program, the field, and the official link.
