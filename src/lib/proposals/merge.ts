/**
 * Merge reviewed evidence proposals (data/proposals/verified/*.json) into the seed datasets.
 * Pure: takes parsed JSON, returns new JSON + a change log. The CLI is scripts/merge-proposals.ts.
 *
 * Rules:
 *  - Only proposals with review.verdict === 'accept' are merged.
 *  - An empty fact takes the proposal. A fact with the SAME value gains the evidence (if it had none).
 *  - A fact with a DIFFERENT value from a DIFFERENT official URL becomes a Conflict (both kept, both shown).
 *  - Never deletes data. Never invents values. Every merged fact gets a review note.
 */
import { valuesEqual } from '../confidence';
import type { Fact, SourcedValue } from '../types';

export interface Proposal {
  target: 'program' | 'institution' | 'country_fact' | 'conversion_rule';
  id: string;
  field: string;
  value: unknown;
  source_url: string;
  evidence_snippet: string;
  fetched_at: string;
  basis?: 'verbatim' | 'summary' | 'inferred';
  notes?: string;
  review?: { verdict: string; checks?: string };
}

export interface ProposalFile {
  area?: string;
  proposals: Proposal[];
}

export interface SeedBundle {
  programs: { institutions: Record<string, unknown>[]; programs: Record<string, unknown>[]; [k: string]: unknown };
  countryFacts: { country_facts: Record<string, unknown>[]; [k: string]: unknown };
  conversionRules: { conversion_rules: Record<string, unknown>[]; [k: string]: unknown };
}

export type ChangeKind = 'filled' | 'evidence_added' | 'conflict_added' | 'unchanged' | 'skipped';

export interface Change {
  kind: ChangeKind;
  target: Proposal['target'];
  id: string;
  field: string;
  value: unknown;
  source_url: string;
  evidence_snippet: string;
  notes?: string;
  reason?: string;
}

export const REVIEW_NOTE = (date: string) =>
  `Proposed from the official page on ${date} and checked by a second reviewer. Awaiting human review.`;

const PROGRAM_FACT_FIELDS = new Set([
  'status_note', 'intake', 'deadline', 'min_gpa_rule', 'language_req', 'tuition', 'living_cost', 'duration_months',
  'scholarship_info', 'sop_requirements', 'lor_count', 'cv_requirements', 'tests_required', 'research_considered',
  'progression_guaranteed', 'progression_requirement', 'eligibility_note', 'conditional_admission', 'language_waiver', 'admissions_email',
]);
const INSTITUTION_FACT_FIELDS = new Set(['hec_status', 'pqr_status', 'anabin_status', 'recognition_list_status']);

function isHttps(u: unknown): u is string {
  try {
    return typeof u === 'string' && new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Reviewer notes go to `review_note` (never rendered). Students see the value, the verbatim evidence and the
 * source instead; a stale student-facing `note` (e.g. "Summarised… re-verify") is cleared when evidence arrives.
 */
function toSourced(p: Proposal, note: string): SourcedValue<unknown> {
  const s: SourcedValue<unknown> = {
    value: p.value,
    source_url: p.source_url,
    evidence_snippet: p.evidence_snippet,
    fetched_at: p.fetched_at,
    review_note: p.notes ? `${note} ${p.notes}` : note,
  };
  if (p.basis && p.basis !== 'verbatim') s.basis = p.basis;
  return s;
}

/** Replace a fact's primary source with the incoming one (keeps recorded conflicts). */
function replacePrimary(fact: Fact<unknown>, incoming: SourcedValue<unknown>, keepConflicts: boolean): void {
  const conflicts = fact.conflicts;
  Object.assign(fact, incoming);
  if (!incoming.basis) delete fact.basis;
  delete fact.note;
  if (keepConflicts && conflicts) fact.conflicts = conflicts;
  else delete (fact as { conflicts?: unknown }).conflicts;
}

/** Merge one proposal into one fact object (mutates and returns the change kind). */
export function mergeIntoFact(fact: Fact<unknown>, p: Proposal, note: string): { kind: ChangeKind; reason?: string } {
  const incoming = toSourced(p, note);
  if (fact.value === null || fact.value === undefined) {
    replacePrimary(fact, incoming, false);
    return { kind: 'filled' };
  }
  if (valuesEqual(fact.value, p.value)) {
    if (!fact.evidence_snippet || fact.basis === 'summary' || fact.basis === 'inferred') {
      replacePrimary(fact, incoming, true);
      return { kind: 'evidence_added' };
    }
    return { kind: 'unchanged', reason: 'same value already has evidence' };
  }
  // Different value. An unsourced placeholder is not a second source: the sourced proposal replaces it.
  if (!fact.source_url) {
    replacePrimary(fact, incoming, false);
    return { kind: 'filled', reason: 'replaced an unsourced placeholder value' };
  }
  if (fact.source_url === p.source_url) {
    return { kind: 'skipped', reason: 'different value from the SAME page as the existing fact; needs a human decision' };
  }
  const existing = fact.conflicts ?? [];
  if (existing.some((c) => c.source_url === p.source_url && valuesEqual(c.value, p.value))) {
    return { kind: 'unchanged', reason: 'conflict already recorded' };
  }
  fact.conflicts = [...existing, incoming];
  return { kind: 'conflict_added' };
}

export function mergeProposals(seed: SeedBundle, files: ProposalFile[], date: string): { seed: SeedBundle; changes: Change[] } {
  const out: SeedBundle = JSON.parse(JSON.stringify(seed));
  const changes: Change[] = [];
  const note = REVIEW_NOTE(date);

  const programs = new Map(out.programs.programs.map((p) => [p.id as string, p]));
  const institutions = new Map(out.programs.institutions.map((i) => [i.id as string, i]));
  const facts = new Map(out.countryFacts.country_facts.map((f) => [f.id as string, f]));
  const rules = new Map(out.conversionRules.conversion_rules.map((r) => [r.id as string, r]));

  for (const file of files) {
    for (const p of file.proposals ?? []) {
      const base = { target: p.target, id: p.id, field: p.field, value: p.value, source_url: p.source_url, evidence_snippet: p.evidence_snippet, notes: p.notes };
      const skip = (reason: string) => changes.push({ ...base, kind: 'skipped', reason });

      if (p.review && p.review.verdict !== 'accept') { skip(`review verdict ${p.review.verdict}`); continue; }
      if (!isHttps(p.source_url)) { skip('source_url is not https'); continue; }
      if (typeof p.evidence_snippet !== 'string' || p.evidence_snippet.trim().length < 12) { skip('evidence snippet missing or too short'); continue; }
      if (p.value === null || p.value === undefined) { skip('no value'); continue; }

      if (p.target === 'program') {
        const prog = programs.get(p.id);
        if (!prog) { skip('unknown program id'); continue; }
        if (p.field === 'official_url') {
          if (!isHttps(p.value)) { skip('official_url value is not https'); continue; }
          if (prog.official_url && prog.official_url !== p.value) { skip(`official_url already set to ${prog.official_url}`); continue; }
          const kind: ChangeKind = prog.official_url === p.value ? 'unchanged' : 'filled';
          prog.official_url = p.value;
          changes.push({ ...base, kind });
          continue;
        }
        if (!PROGRAM_FACT_FIELDS.has(p.field)) { skip('unknown program field'); continue; }
        const r = mergeIntoFact(prog[p.field] as Fact<unknown>, p, note);
        if (r.kind !== 'skipped' && r.kind !== 'unchanged') {
          const prev = prog.last_checked as string | null;
          if (!prev || prev < p.fetched_at) prog.last_checked = p.fetched_at;
        }
        changes.push({ ...base, ...r });
      } else if (p.target === 'institution') {
        const inst = institutions.get(p.id);
        if (!inst) { skip('unknown institution id'); continue; }
        if (!INSTITUTION_FACT_FIELDS.has(p.field)) { skip('unknown institution field'); continue; }
        changes.push({ ...base, ...mergeIntoFact(inst[p.field] as Fact<unknown>, p, note) });
      } else if (p.target === 'country_fact') {
        const f = facts.get(p.id);
        if (!f) { skip('unknown country fact id'); continue; }
        if (p.field !== 'value') { skip('country facts only accept field "value"'); continue; }
        const v = p.value as { text?: unknown };
        if (!v || typeof v !== 'object' || typeof v.text !== 'string') { skip('country fact value must be {text, sort_months?, clock_note?}'); continue; }
        changes.push({ ...base, ...mergeIntoFact(f as unknown as Fact<unknown>, p, note) });
      } else if (p.target === 'conversion_rule') {
        const rule = rules.get(p.id);
        if (!rule) { skip('unknown conversion rule id'); continue; }
        if (p.field !== 'source') { skip('conversion rules only accept field "source"'); continue; }
        if (rule.source_url && rule.source_url !== p.source_url) { skip(`rule already sourced from ${rule.source_url}`); continue; }
        rule.source_url = p.source_url;
        rule.evidence_snippet = p.evidence_snippet;
        rule.fetched_at = p.fetched_at;
        changes.push({ ...base, kind: 'filled' });
      } else {
        skip('unknown target');
      }
    }
  }
  return { seed: out, changes };
}

function cell(v: unknown, max = 140): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const t = s.length > max ? s.slice(0, max - 1) + '…' : s;
  return t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Human review checklist in Markdown. */
export function reviewMarkdown(changes: Change[], date: string): string {
  const applied = changes.filter((c) => c.kind === 'filled' || c.kind === 'evidence_added' || c.kind === 'conflict_added');
  const other = changes.filter((c) => !applied.includes(c));
  const lines = [
    `# Evidence review — ${date}`,
    '',
    'These values were proposed from official pages, their snippets were checked verbatim against the live page,',
    'and a second reviewer re-checked each one. They are in the seed files now and show as **Verified** (or **Conflict**).',
    'Please tick each row after you open the link and agree. To undo everything: `git checkout -- data/*.seed.json`.',
    '',
    `Applied: ${applied.length} · Not applied: ${other.length}`,
    '',
    '| ✓ | Change | Target | Field | Value | Evidence (verbatim) | Source | Reviewer notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...applied.map((c) => `| [ ] | ${c.kind} | ${c.target}:${c.id} | ${c.field} | ${cell(c.value, 80)} | ${cell(c.evidence_snippet)} | ${c.source_url} | ${cell(c.notes ?? '', 220)} |`),
  ];
  if (other.length) {
    lines.push('', '## Not applied', '', '| Target | Field | Reason |', '| --- | --- | --- |');
    lines.push(...other.map((c) => `| ${c.target}:${c.id} | ${c.field} | ${cell(c.reason ?? c.kind)} |`));
  }
  return lines.join('\n') + '\n';
}
