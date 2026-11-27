/**
 * OFFLINE ingestion: proposes program facts from official pages. Never runs in the app; never edits seed files.
 *
 *   npx tsx scripts/ingest.ts --program tum-msc-informatics --url https://www.tum.de/... [--fields deadline,tuition]
 *       one page, one program. Needs a model: INGEST_PROVIDER=xai + XAI_API_KEY (XAI_MODEL, XAI_REVIEW_MODEL) or ANTHROPIC_API_KEY
 *   npx tsx scripts/ingest.ts --all [--stale-days 7] [--country DE] [--only page-id,...] [--force] [--fetch-only]
 *       walks data/sources.json, one proposals file per program; pages whose content hash is unchanged are skipped
 *   npx tsx scripts/ingest.ts --verify data/proposals/tum-msc-informatics-20261124-1030.json
 *   npx tsx scripts/ingest.ts --verify-seed
 *       no key needed: re-fetches each source_url and re-checks that every snippet is still on the page
 *
 * Pipeline (propose): safeFetch (allowlisted https host, public IPs only, robots.txt, per-host throttle, 10 s, 3 MB)
 *   -> htmlToText -> Claude proposes { field, value, evidence_snippet } (page text in an untrusted block, no tools)
 *   -> code ACCEPTS a proposal only if the snippet appears verbatim on the page AND the value passes the field schema
 *   -> writes accepted + rejected (with reasons) to data/proposals/<id>-<YYYYMMDD-HHmm>.json for human review.
 * Every run also writes a JSON report to data/proposals/reports/ (scripts/report-io.ts).
 * Rules live in src/lib/seed/ingest.ts (unit-tested).
 */
import './load-env';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadSeedDataset } from '../src/lib/data/seed-source';
import { USER_AGENT, type SafeResponse } from '../src/lib/net/safe-fetch';
import { estimateCostUsd, resolveProposer, type Proposer } from '../src/lib/seed/proposer';
import { reviewAccepted } from '../src/lib/seed/review-pass';
import { isProgramFactField, type ProgramFactField } from '../src/lib/seed/fields';
import {
  INGEST_USAGE,
  buildExtractionPrompt,
  buildProposalsFile,
  parseIngestArgs,
  parseModelOutput,
  proposalFileName,
  reviewProposals,
  verifyItemsFrom,
  verifyItemsFromSeed,
  verifySnippets,
  type ProposalsFile,
  type ReviewResult,
} from '../src/lib/seed/ingest';
import { describeFetchError, fetchPage, type FetchMethod } from '../src/lib/seed/page-text';
import { RunRecorder, outcomeOfError, outcomeOfStatus } from '../src/lib/seed/run-report';
import {
  emptyState,
  groupByTarget,
  hashText,
  selectPages,
  validateSources,
  type SeedIds,
  type SourcesFile,
  type StateFile,
} from '../src/lib/seed/sources';
import { INGEST_ALLOWLIST } from '../src/lib/net/hosts';
import { writeRunReport } from './report-io';

const ROOT = process.cwd();
const PROPOSALS_DIR = resolve(ROOT, 'data', 'proposals');
const STATE_FILE = join(PROPOSALS_DIR, 'state', 'page-hashes.json');

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function seedIds(): SeedIds {
  const ds = loadSeedDataset();
  const countries = new Set<string>(ds.countryFacts.map((f) => f.country));
  return {
    programs: new Map(ds.programs.map((p) => [p.id, { country: p.country, institution_id: p.institution_id }])),
    institutions: new Map(ds.institutions.map((i) => [i.id, { country: i.country }])),
    conversionRules: new Set(ds.conversionRules.map((r) => r.id)),
    fxCurrencies: new Set(ds.fxRates.map((r) => r.currency)),
    countries,
  };
}

function loadState(): StateFile {
  if (!existsSync(STATE_FILE)) return emptyState();
  try {
    const s = readJson<StateFile>(STATE_FILE);
    return s && s.version === 1 && s.pages ? s : emptyState();
  } catch {
    return emptyState();
  }
}

function saveState(state: StateFile): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function writeProposals(programId: string, file: ProposalsFile, now: Date): string {
  mkdirSync(PROPOSALS_DIR, { recursive: true });
  const out = join(PROPOSALS_DIR, proposalFileName(programId, now));
  if (!out.startsWith(PROPOSALS_DIR + sep)) fail('Refusing to write outside data/proposals/.');
  if (existsSync(out)) fail(`${relative(ROOT, out)} already exists; wait a minute and run again.`);
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n', 'utf8');
  return out;
}

function printResult(result: ReviewResult): void {
  for (const a of result.accepted) {
    console.log(`ACCEPTED  ${a.field} = ${JSON.stringify(a.value)}`);
    for (const n of a.review_notes) console.log(`          note: ${n}`);
    for (const f of a.flags) console.log(`          FLAG: ${f}`);
  }
  for (const r of result.rejected) console.log(`REJECTED  ${String(r.field ?? '(none)')}: ${r.reasons.join('; ')}`);
}

/* ---------------- --program / --url (one page) ---------------- */

async function propose(programId: string, url: string, fields: ProgramFactField[], argv: string[]) {
  const choice = resolveProposer();
  if (!choice.ok) {
    fail(`${choice.reason} Propose mode needs a model; "--verify <file>" works without a key.`, 2);
  }
  const ds = loadSeedDataset();
  const program = ds.programs.find((p) => p.id === programId);
  if (!program) fail(`No program with id "${programId}" in data/programs.seed.json.`, 2);
  const institution = ds.institutions.find((i) => i.id === program.institution_id);
  const rec = new RunRecorder('ingest', 'single', argv, USER_AGENT);

  const fetchedAt = new Date();
  console.log(`Fetching ${url} ...`);
  const t0 = Date.now();
  let page: SafeResponse;
  let pageText = '';
  let fetchMethod: FetchMethod = 'static';
  try {
    const f = await fetchPage(url);
    page = f.res;
    pageText = f.text;
    fetchMethod = f.method;
    if (f.renderNote) console.warn(`Render fallback not used: ${f.renderNote}`);
  } catch (e) {
    const o = outcomeOfError(e);
    rec.entry({ kind: 'page', ref: programId, url, ...o, duration_ms: Date.now() - t0 });
    writeRunReport(rec.finish());
    fail(`Fetch refused or failed: ${describeFetchError(e)}`);
  }
  if (!page.ok) {
    rec.entry({ kind: 'page', ref: programId, url, ...outcomeOfStatus(page.status), duration_ms: Date.now() - t0 });
    writeRunReport(rec.finish());
    fail(`The page returned HTTP ${page.status}. Nothing proposed.`);
  }
  if (pageText.length < 200) console.warn(`Warning: the page has only ${pageText.length} characters of text.`);
  if (fetchMethod === 'render') console.log('Read with the browser renderer (the page needs JavaScript).');
  if (page.redirects.length) console.log(`Redirected to ${page.url}`);

  const model = choice.proposer.model;
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
    output = await choice.proposer.propose(prompt);
  } catch (e) {
    rec.entry({ kind: 'page', ref: programId, url, outcome: 'error', http_status: page.status, detail: `model call failed: ${describeFetchError(e)}`, duration_ms: Date.now() - t0 });
    writeRunReport(rec.finish());
    fail(`Model call failed: ${describeFetchError(e)}`);
  }

  const parsed = parseModelOutput(output);
  const result = reviewProposals(parsed.proposals, { pageText, fetchMethod, sourceUrl: page.url, fetchedAt: fetchedAt.toISOString(), fields });
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
  const out = writeProposals(programId, file, fetchedAt);
  rec.entry({ kind: 'page', ref: programId, url, outcome: 'ok', http_status: page.status, detail: `${result.accepted.length} accepted, ${result.rejected.length} rejected`, duration_ms: Date.now() - t0 });
  for (const a of result.accepted) rec.accepted.push({ ref: programId, field: a.field, source_url: a.source_url });
  for (const r of result.rejected) rec.rejections.push({ ref: programId, field: typeof r.field === 'string' ? r.field : null, reasons: r.reasons });

  console.log('');
  printResult(result);
  console.log(`\n${result.accepted.length} accepted, ${result.rejected.length} rejected.`);
  console.log(`Wrote ${relative(ROOT, out)}. A human must review it before anything goes into the seed.`);
  writeRunReport(rec.finish());
}

/* ---------------- --all (source registry) ---------------- */

async function runAll(args: Extract<ReturnType<typeof parseIngestArgs>, { mode: 'all' }>, argv: string[]) {
  const sourcesPath = join(ROOT, 'data', 'sources.json');
  if (!existsSync(sourcesPath)) fail('data/sources.json does not exist.', 2);
  const sources = readJson<SourcesFile>(sourcesPath);
  const seed = seedIds();
  const problems = validateSources(sources, seed, INGEST_ALLOWLIST).filter((i) => i.severity === 'error');
  if (problems.length) fail(`data/sources.json has ${problems.length} error(s); run npm run validate:seed.\n${problems.slice(0, 5).map((p) => `  ${p.path}: ${p.message}`).join('\n')}`, 2);

  const useModel = !args.fetchOnly;
  const choice = useModel ? resolveProposer() : null;
  if (useModel && choice && !choice.ok) fail(`${choice.reason} Use --fetch-only to fetch and hash pages without a model.`, 2);
  const proposer: Proposer | null = choice && choice.ok ? choice.proposer : null;
  const reviewer: Proposer | null = choice && choice.ok ? choice.reviewer : null;

  const now = new Date();
  const state = loadState();
  const pages = selectPages(sources, state, seed, { country: args.country, staleDays: args.staleDays, only: args.only, now });
  const groups = groupByTarget(pages);
  const ds = loadSeedDataset();
  const model = proposer ? `${proposer.provider}:${proposer.model}${reviewer ? ` (second pass ${reviewer.model})` : ''}` : 'none';
  const propose = proposer ? proposer.propose : null;
  const rec = new RunRecorder('ingest', args.fetchOnly ? 'all-fetch-only' : 'all', argv, USER_AGENT);
  rec.notes.push(`${pages.length} page(s) selected of ${sources.pages.length} in the registry; model: ${model}`);
  console.log(`${pages.length} page(s) in ${groups.size} target(s). Model: ${model}.`);

  for (const [key, group] of groups) {
    const target = group[0].target;
    const accepted: ReviewResult['accepted'] = [];
    const rejected: ReviewResult['rejected'] = [];
    const fieldsSeen = new Set<ProgramFactField>();
    const pagesInfo: { url: string; final_url: string; chars: number; hash: string; fetch_method?: FetchMethod }[] = [];
    let chars = 0;

    for (const page of group) {
      const t0 = Date.now();
      const st = state.pages[page.url];
      const conditional = !args.force && st && (st.extracted || args.fetchOnly) ? { etag: st.etag, lastModified: st.last_modified } : undefined;
      let res: SafeResponse;
      let text = '';
      let method: FetchMethod = 'static';
      try {
        const f = await fetchPage(page.url, { conditional, render: page.render === true });
        res = f.res;
        text = f.text;
        method = f.method;
      } catch (e) {
        rec.entry({ kind: 'page', ref: page.id, url: page.url, ...outcomeOfError(e), duration_ms: Date.now() - t0 });
        console.log(`  ${page.id}: ${outcomeOfError(e).outcome} (${describeFetchError(e)})`);
        continue;
      }
      if (res.notModified && st) {
        state.pages[page.url] = { ...st, checked_at: now.toISOString() };
        rec.entry({ kind: 'page', ref: page.id, url: page.url, outcome: 'not_modified', http_status: 304, detail: null, duration_ms: Date.now() - t0 });
        console.log(`  ${page.id}: not modified`);
        continue;
      }
      if (!res.ok) {
        rec.entry({ kind: 'page', ref: page.id, url: page.url, ...outcomeOfStatus(res.status), duration_ms: Date.now() - t0 });
        console.log(`  ${page.id}: HTTP ${res.status}`);
        continue;
      }
      const hash = hashText(text);
      const unchanged = !args.force && st?.hash === hash && (st.extracted || args.fetchOnly);
      const nextState = { hash, etag: res.etag, last_modified: res.lastModified, checked_at: now.toISOString(), final_url: res.url, chars: text.length };
      if (unchanged) {
        state.pages[page.url] = { ...st!, ...nextState, extracted: st!.extracted };
        rec.entry({ kind: 'page', ref: page.id, url: page.url, outcome: 'unchanged', http_status: res.status, detail: 'content hash equal to the last run', duration_ms: Date.now() - t0 });
        console.log(`  ${page.id}: unchanged, skipped`);
        continue;
      }
      if (text.length < 200) rec.notes.push(`${page.id}: only ${text.length} characters of text`);
      if (method === 'render') rec.notes.push(`${page.id}: read with the browser renderer`);

      const fields = page.fields.filter(isProgramFactField);
      if (!propose || target.type !== 'program' || fields.length === 0) {
        state.pages[page.url] = { ...nextState, extracted: false };
        const why = args.fetchOnly ? 'fetch-only run' : `${target.type} pages are extracted by hand (no model prompt for them yet)`;
        rec.entry({ kind: 'page', ref: page.id, url: page.url, outcome: 'ok', http_status: res.status, detail: `hash recorded; ${why}`, duration_ms: Date.now() - t0 });
        console.log(`  ${page.id}: fetched (${text.length} chars), ${why}`);
        continue;
      }

      const program = ds.programs.find((p) => p.id === (target as { id: string }).id)!;
      const institution = ds.institutions.find((i) => i.id === program.institution_id);
      const prompt = buildExtractionPrompt({ programName: program.name, institutionName: institution?.name ?? program.institution_id, sourceUrl: res.url, fields, pageText: text });
      let output: string;
      try {
        output = await propose(prompt);
      } catch (e) {
        rec.entry({ kind: 'page', ref: page.id, url: page.url, outcome: 'error', http_status: res.status, detail: `model call failed: ${describeFetchError(e)}`, duration_ms: Date.now() - t0 });
        console.log(`  ${page.id}: model call failed (${describeFetchError(e)})`);
        continue;
      }
      const parsed = parseModelOutput(output);
      const result = reviewProposals(parsed.proposals, { pageText: text, fetchMethod: method, sourceUrl: res.url, fetchedAt: now.toISOString(), fields });
      if (parsed.error) result.rejected.push({ field: null, value: null, evidence_snippet: null, reasons: [parsed.error] });
      if (reviewer && result.accepted.length > 0) {
        const second = await reviewAccepted({ programName: program.name, institutionName: institution?.name ?? program.institution_id, accepted: result.accepted }, reviewer.propose, reviewer.model);
        result.accepted = second.kept;
        result.rejected.push(...second.vetoed);
      }
      accepted.push(...result.accepted);
      rejected.push(...result.rejected);
      fields.forEach((f) => fieldsSeen.add(f));
      chars += text.length;
      pagesInfo.push({ url: page.url, final_url: res.url, chars: text.length, hash, fetch_method: method });
      state.pages[page.url] = { ...nextState, extracted: true };
      rec.entry({ kind: 'page', ref: page.id, url: page.url, outcome: 'ok', http_status: res.status, detail: `${result.accepted.length} accepted, ${result.rejected.length} rejected`, duration_ms: Date.now() - t0 });
      for (const a of result.accepted) rec.accepted.push({ ref: page.id, field: a.field, source_url: a.source_url });
      for (const r of result.rejected) rec.rejections.push({ ref: page.id, field: typeof r.field === 'string' ? r.field : null, reasons: r.reasons });
      console.log(`  ${page.id}: ${result.accepted.length} accepted, ${result.rejected.length} rejected`);
    }

    if (target.type === 'program' && (accepted.length > 0 || rejected.length > 0)) {
      const file = buildProposalsFile({
        programId: target.id,
        requestedUrl: group[0].url,
        sourceUrl: pagesInfo[0]?.final_url ?? group[0].url,
        fetchedAt: now.toISOString(),
        model,
        fields: [...fieldsSeen],
        pageChars: chars,
        result: { accepted, rejected },
      });
      const out = writeProposals(target.id, { ...file, pages: pagesInfo }, now);
      console.log(`${key}: wrote ${relative(ROOT, out)}`);
    }
    saveState(state);
  }
  saveState(state);
  for (const p of [proposer, reviewer]) {
    if (!p) continue;
    const cost = estimateCostUsd(p.model, p.usage);
    rec.notes.push(`${p.provider}:${p.model}: ${p.usage.calls} call(s), ${p.usage.failures} failed, ${p.usage.inputTokens} input / ${p.usage.outputTokens} output tokens${cost !== null ? `, about $${cost.toFixed(4)}` : ''}`);
  }
  writeRunReport(rec.finish());
}

/* ---------------- --verify / --verify-seed ---------------- */

/** URLs the registry marks "render": true. */
function registryRenderUrls(): Set<string> {
  const file = join(ROOT, 'data', 'sources.json');
  if (!existsSync(file)) return new Set();
  return new Set(readJson<SourcesFile>(file).pages.filter((p) => p.render === true).map((p) => p.url));
}

function verifyMethodFor(url: string, items: readonly { source_url: string; fetch_method?: FetchMethod }[], renderUrls: ReadonlySet<string>): FetchMethod | 'auto' {
  const recorded = items.filter((i) => i.source_url === url).map((i) => i.fetch_method);
  if (recorded.includes('render')) return 'render';
  if (renderUrls.has(url)) return 'render';
  if (recorded.length > 0 && recorded.every((m) => m === 'static')) return 'static';
  return 'auto';
}

async function verifyItems(items: ReturnType<typeof verifyItemsFrom>['items'], mode: string, argv: string[]) {
  const rec = new RunRecorder('verify', mode, argv, USER_AGENT);
  const pages = new Map<string, string | Error>();
  const times = new Map<string, number>();
  const statuses = new Map<string, ReturnType<typeof outcomeOfError>>();
  const renderUrls = registryRenderUrls();
  for (const url of new Set(items.map((i) => i.source_url))) {
    const t0 = Date.now();
    try {
      // Same method that produced the snippet: recorded fetch_method, else the registry flag, else auto.
      const res = await fetchPage(url, { fetchMethod: verifyMethodFor(url, items, renderUrls) });
      if (res.res.ok) pages.set(url, res.text);
      else {
        pages.set(url, new Error(`HTTP ${res.res.status}`));
        statuses.set(url, outcomeOfStatus(res.res.status));
      }
    } catch (e) {
      pages.set(url, e instanceof Error ? e : new Error(String(e)));
      statuses.set(url, outcomeOfError(e));
    }
    times.set(url, Date.now() - t0);
  }
  const outcomes = verifySnippets(items, pages);
  const notFound: string[] = [];
  for (const o of outcomes) {
    const tag = o.status === 'found' ? 'FOUND    ' : o.status === 'not_found' ? 'NOT FOUND' : 'ERROR    ';
    console.log(`${tag}  ${o.item.label}${o.detail ? `: ${o.detail}` : ''}`);
    const err = statuses.get(o.item.source_url);
    rec.entry({
      kind: 'snippet',
      ref: o.item.label,
      url: o.item.source_url,
      outcome: o.status === 'found' ? 'found' : o.status === 'not_found' ? 'not_found' : (err?.outcome ?? 'error'),
      http_status: err?.http_status ?? null,
      detail: o.detail ?? err?.detail ?? null,
      duration_ms: times.get(o.item.source_url) ?? 0,
    });
    if (o.status === 'not_found') notFound.push(o.item.label);
  }
  const found = outcomes.filter((o) => o.status === 'found').length;
  console.log(`\n${found}/${outcomes.length} snippets still appear verbatim on their official pages.`);
  if (notFound.length) rec.notes.push(`NOT FOUND: ${notFound.join(', ')}`);
  writeRunReport(rec.finish());
  process.exit(found === outcomes.length ? 0 : 1);
}

async function verify(file: string, argv: string[]) {
  let data: unknown;
  try {
    data = readJson(resolve(ROOT, file));
  } catch (e) {
    fail(`Could not read ${file}: ${describeFetchError(e)}`, 2);
  }
  const { items, error } = verifyItemsFrom(data);
  if (error) fail(error, 2);
  if (!items.length) fail('No proposals with source_url and evidence_snippet to verify.', 2);
  await verifyItems(items, 'file', argv);
}

async function verifySeed(argv: string[]) {
  const files: Record<string, unknown> = {};
  for (const name of ['programs.seed.json', 'country_facts.seed.json', 'conversion_rules.seed.json', 'fx_rates.seed.json']) {
    files[name] = readJson(join(ROOT, 'data', name));
  }
  const items = verifyItemsFromSeed(files);
  console.log(`Re-checking ${items.length} stored snippet(s) from data/*.seed.json ...`);
  await verifyItems(items, 'seed', argv);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseIngestArgs(argv);
  switch (args.mode) {
    case 'help':
      console.log(INGEST_USAGE);
      return;
    case 'error':
      fail(`${args.message}\n\n${INGEST_USAGE}`, 2);
    case 'verify':
      await verify(args.file, argv);
      return;
    case 'verify-seed':
      await verifySeed(argv);
      return;
    case 'all':
      await runAll(args, argv);
      return;
    case 'propose':
      await propose(args.programId, args.url, args.fields, argv);
      return;
  }
}

main().catch((e) => fail(`Unexpected error: ${describeFetchError(e)}`));
