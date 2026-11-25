/**
 * OFFLINE ingestion: proposes program facts from ONE official page. Never runs in the app; never edits seed files.
 *
 *   npx tsx scripts/ingest.ts --program tum-msc-informatics --url https://www.tum.de/... [--fields deadline,tuition]
 *       needs ANTHROPIC_API_KEY (optional ANTHROPIC_MODEL, default claude-opus-5-5)
 *   npx tsx scripts/ingest.ts --verify data/proposals/tum-msc-informatics-20261124-1030.json
 *       no key needed: re-fetches each source_url and re-checks that every snippet is still on the page
 *
 * Pipeline (propose): safe-fetch (allowlisted https host, public IPs only, robots.txt, 10 s, 3 MB)
 *   -> htmlToText -> Claude proposes { field, value, evidence_snippet } (page text in an untrusted block, no tools)
 *   -> code ACCEPTS a proposal only if the snippet appears verbatim on the page AND the value passes the field schema
 *   -> writes accepted + rejected (with reasons) to data/proposals/<id>-<YYYYMMDD-HHmm>.json for human review.
 * Rules live in src/lib/seed/ingest.ts (unit-tested).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { loadSeedDataset } from '../src/lib/data/seed-source';
import { SafeFetchError, safeFetch } from '../src/lib/net/safe-fetch';
import { ingestModel, makeClaudeProposer } from '../src/lib/seed/claude-proposer';
import type { ProgramFactField } from '../src/lib/seed/fields';
import {
  INGEST_USAGE,
  buildExtractionPrompt,
  buildProposalsFile,
  pageTextOf,
  parseIngestArgs,
  parseModelOutput,
  proposalFileName,
  reviewProposals,
  verifyItemsFrom,
  verifySnippets,
} from '../src/lib/seed/ingest';

const PROPOSALS_DIR = resolve(process.cwd(), 'data', 'proposals');

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function describeError(e: unknown): string {
  if (e instanceof SafeFetchError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

async function propose(programId: string, url: string, fields: ProgramFactField[]) {
  if (!process.env.ANTHROPIC_API_KEY) {
    fail('ANTHROPIC_API_KEY is not set. Propose mode needs it; "--verify <file>" works without a key.', 2);
  }
  const ds = loadSeedDataset();
  const program = ds.programs.find((p) => p.id === programId);
  if (!program) fail(`No program with id "${programId}" in data/programs.seed.json.`, 2);
  const institution = ds.institutions.find((i) => i.id === program.institution_id);

  const fetchedAt = new Date();
  console.log(`Fetching ${url} ...`);
  let page;
  try {
    page = await safeFetch(url);
  } catch (e) {
    fail(`Fetch refused or failed: ${describeError(e)}`);
  }
  if (!page.ok) fail(`The page returned HTTP ${page.status}. Nothing proposed.`);
  const pageText = pageTextOf(page.body, page.contentType);
  if (pageText.length < 200) console.warn(`Warning: the page has only ${pageText.length} characters of text (JavaScript-only page?).`);
  if (page.redirects.length) console.log(`Redirected to ${page.url}`);

  const model = ingestModel();
  const prompt = buildExtractionPrompt({
    programName: program.name,
    institutionName: institution?.name ?? program.institution_id,
    sourceUrl: page.url,
    fields,
    pageText,
  });
  console.log(`Asking ${model} for proposals on ${fields.length} field(s) ...`);
  let output: string;
  try {
    output = await makeClaudeProposer({ model })(prompt);
  } catch (e) {
    fail(`Model call failed: ${describeError(e)}`);
  }

  const parsed = parseModelOutput(output);
  const result = reviewProposals(parsed.proposals, {
    pageText,
    sourceUrl: page.url,
    fetchedAt: fetchedAt.toISOString(),
    fields,
  });
  if (parsed.error) result.rejected.push({ field: null, value: null, evidence_snippet: null, reasons: [parsed.error] });

  const file = buildProposalsFile({
    programId,
    requestedUrl: url,
    sourceUrl: page.url,
    fetchedAt: fetchedAt.toISOString(),
    model,
    fields,
    pageChars: pageText.length,
    result,
  });
  mkdirSync(PROPOSALS_DIR, { recursive: true });
  const out = join(PROPOSALS_DIR, proposalFileName(programId, fetchedAt));
  if (!out.startsWith(PROPOSALS_DIR + sep)) fail('Refusing to write outside data/proposals/.');
  if (existsSync(out)) fail(`${relative(process.cwd(), out)} already exists; wait a minute and run again.`);
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n', 'utf8');

  console.log('');
  for (const a of result.accepted) {
    console.log(`ACCEPTED  ${a.field} = ${JSON.stringify(a.value)}`);
    for (const n of a.review_notes) console.log(`          note: ${n}`);
  }
  for (const r of result.rejected) console.log(`REJECTED  ${String(r.field ?? '(none)')}: ${r.reasons.join('; ')}`);
  console.log(`\n${result.accepted.length} accepted, ${result.rejected.length} rejected.`);
  console.log(`Wrote ${relative(process.cwd(), out)}. A human must review it before anything goes into the seed.`);
}

async function verify(file: string) {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
  } catch (e) {
    fail(`Could not read ${file}: ${describeError(e)}`, 2);
  }
  const { items, error } = verifyItemsFrom(data);
  if (error) fail(error, 2);
  if (!items.length) fail('No proposals with source_url and evidence_snippet to verify.', 2);

  const pages = new Map<string, string | Error>();
  for (const url of new Set(items.map((i) => i.source_url))) {
    try {
      const res = await safeFetch(url);
      pages.set(url, res.ok ? pageTextOf(res.body, res.contentType) : new Error(`HTTP ${res.status}`));
    } catch (e) {
      pages.set(url, new Error(describeError(e)));
    }
  }
  const outcomes = verifySnippets(items, pages);
  for (const o of outcomes) {
    const tag = o.status === 'found' ? 'FOUND    ' : o.status === 'not_found' ? 'NOT FOUND' : 'ERROR    ';
    console.log(`${tag}  ${o.item.label}${o.detail ? `: ${o.detail}` : ''}`);
  }
  const found = outcomes.filter((o) => o.status === 'found').length;
  console.log(`\n${found}/${outcomes.length} snippets still appear verbatim on their official pages.`);
  process.exit(found === outcomes.length ? 0 : 1);
}

async function main() {
  const args = parseIngestArgs(process.argv.slice(2));
  switch (args.mode) {
    case 'help':
      console.log(INGEST_USAGE);
      return;
    case 'error':
      fail(`${args.message}\n\n${INGEST_USAGE}`, 2);
    case 'verify':
      await verify(args.file);
      return;
    case 'propose':
      await propose(args.programId, args.url, args.fields);
      return;
  }
}

main().catch((e) => fail(`Unexpected error: ${describeError(e)}`));
