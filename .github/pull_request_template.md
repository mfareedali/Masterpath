## What does this change?

<!-- One or two sentences. Link the issue if there is one. -->

## Type

- [ ] Data (seed JSON: programs, country facts, conversion rules, exchange rates)
- [ ] Code
- [ ] Docs

## Data changes: evidence checklist

Every new or changed value needs evidence. A value without it shows as "Not verified yet", which is fine. A guessed value is not.

- [ ] Each value has a `source_url` on the **official** site (university, government or recognition body), using `https://`
- [ ] Each value has an `evidence_snippet` copied **word for word** from that page (12-600 characters, plain text, no HTML)
- [ ] `fetched_at` is the date I opened the page (`YYYY-MM-DD`)
- [ ] I did not write a `confidence` value (confidence is computed in code)
- [ ] If two official pages disagree, I kept both (one in `conflicts`) instead of choosing
- [ ] Nothing about admission chances or probabilities, and no passport or ID numbers
- [ ] `npm run validate:seed` passes (optional: `npx tsx scripts/verify-snippet.ts <url> "<snippet>"` finds the snippet)

## Code changes: checklist

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass
- [ ] No `dangerouslySetInnerHTML`; links from data go through `safeHref()` / `SourceLink`
- [ ] Works at 360px wide; tap targets are at least 44px; only theme tokens for colours
- [ ] No invented numbers, deadlines, fees, requirements or URLs in code or copy
