# Scrape progress log (branch scrape/2026-11-27)

Resume rule: re-run `npm run ingest -- --all --fetch-only` (skips unchanged pages), then continue at the first batch below not marked done.
Extraction is done by hand (no ANTHROPIC_API_KEY): read the page text with `npx tsx scripts/peek-page.ts <url> "<regex>"`,
write a proposals file in data/proposals/verified/ (merge format), run `npm run ingest -- --verify <file>`, merge only FOUND items.

## Done
- 2026-11-27 PDF support (unpdf 2.2.3, pinned; user-approved) in page-text.ts, used by ingest/verify.
- 2026-11-27 FX: SBP mark-to-market sheet 27-Nov-26, EUR GBP USD CAD CHF AUD (6/6 verified, merged). New merge target `fx_rate`.
- 2026-11-27 Country facts: ca-post-study-work, de-post-study-work. Conversion rule: Bavarian formula source (KIT page).
- Registry: 24 existing programs registered (data/sources.json). Fetch-only run: 23 ok, UIUC timed out.

## Blocked / skipped (one retry each)
- make-it-in-germany.com: bot challenge (Radware). Not bypassed.
- bamf.de: robots.txt unreachable (connection reset).
- uni-assist.de: timeout.
- siebelschool.illinois.edu (UIUC): timeout.
- uni-wuerzburg.de/robots.txt: timeout in the verify-seed run (2 snippets unconfirmed, not NOT FOUND).
- ethz.ch programme page: text has no tuition/deadline (content is rendered elsewhere).

## Next
- Batch 1: priority fields for existing programs (see below), then grow registry.
