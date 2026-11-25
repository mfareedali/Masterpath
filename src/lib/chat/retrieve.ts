/**
 * Retrieval for the chat (pure, deterministic, no AI).
 *
 * From the question (+ optional programId / country scope) and the dataset, select the database rows that can
 * answer it. Every row carries its value as plain text (or null), its COMPUTED confidence, and its links.
 * Nothing here invents a value: a missing fact becomes a row with value null ("Not verified yet").
 */
import { allSources, computeConfidence, isUsable, usableValue } from '@/lib/confidence';
import { buildConflictEmail } from '@/lib/email';
import { SCALE_LABEL } from '@/lib/fit';
import { countryName, formatDate, formatMoney, formatMonths, safeHref } from '@/lib/format';
import { suggestName, type FuzzyCandidate } from '@/lib/text/fuzzy';
import type {
  ConditionalAdmission,
  CountryFact,
  CountryFactKey,
  CountryFactValue,
  Fact,
  GpaRule,
  Institution,
  LanguageReq,
  Money,
  Program,
} from '@/lib/types';
import {
  COMPANION_FIELDS,
  COUNTRY_SUMMARY_FIELDS,
  FIELD_INFO,
  PROGRAM_SUMMARY_FIELDS,
  detectFields,
  isCountryField,
  isProgramField,
  normalizeQuestion,
} from './fields';
import { MAX_QUESTION_CHARS } from './limits';
import type { ChatField, ChatRow, ChatRowSource, ChatSuggestion, ProgramChatField } from './types';

/** The parts of the dataset the chat reads. Structurally compatible with Dataset from '@/lib/data'. */
export interface ChatDataset {
  programs: Program[];
  institutions: Institution[];
  countryFacts: CountryFact[];
}

export interface ChatScope {
  /** Default program when the question names none (e.g. the panel on a program page). */
  programId?: string;
  /** Default country when the question names none. */
  country?: string;
}

export interface Retrieval {
  rows: ChatRow[];
  /** Fields the question asks about. Empty = no specific field (a general question about an entity). */
  fields: ChatField[];
  programIds: string[];
  countries: string[];
  /** A topic MastersPath has no column for (e.g. "application fee"), when no supported field was asked. */
  unsupportedTopic: string | null;
  /**
   * Set when the question names no university exactly but one word is a near miss ("Imprial"). The guard then
   * asks "Did you mean …?" and no rows are retrieved: we never answer for a guessed name.
   */
  suggestion?: ChatSuggestion | null;
}

/**
 * Common short names. Keys are institution ids from the seed data; each institution's full name is also matched.
 * Plain lower-case ASCII words (the question is normalized the same way).
 */
export const INSTITUTION_ALIASES: Record<string, string[]> = {
  tum: ['tum', 'tu munich', 'tu munchen', 'tu muenchen', 'technical university of munich', 'technische universitat munchen'],
  ethz: ['eth', 'ethz', 'eth zurich', 'eth zuerich'],
  'uni-wuerzburg': ['wurzburg', 'wuerzburg', 'wurzburg university', 'university of wurzburg', 'jmu', 'julius maximilians'],
  imperial: ['imperial', 'imperial college', 'icl'],
  cardiff: ['cardiff', 'cardiff university'],
  'oxford-brookes': ['brookes', 'oxford brookes', 'oxford brooks'],
  qmul: ['qmul', 'queen mary', 'queen marys', 'qm'],
  utoronto: ['toronto', 'uoft', 'u of t', 'university of toronto', 'mscac'],
  cmu: ['cmu', 'carnegie', 'carnegie mellon'],
  uiuc: ['uiuc', 'illinois', 'urbana', 'urbana champaign'],
  csudh: ['csudh', 'dominguez', 'dominguez hills', 'cal state dominguez'],
  nyit: ['nyit', 'new york tech', 'new york institute of technology'],
  usf: ['usf', 'south florida', 'university of south florida'],
  uccs: ['uccs', 'colorado springs'],
  ljmu: ['ljmu', 'john moores', 'liverpool john moores'],
};

/**
 * Distinctive single words per institution for "Did you mean …?" (src/lib/text/fuzzy.ts compares 5+ letter words
 * only). Acronyms are left out, and so are words another university shares or that are common English words
 * ("oxford", "munich", "zurich", "florida", "colorado", "liverpool", "urbana", "queen", "south"), so a near miss
 * never points to the wrong university.
 */
export const FUZZY_NAME_WORDS: Record<string, string[]> = {
  'uni-wuerzburg': ['wurzburg', 'wuerzburg'],
  imperial: ['imperial'],
  cardiff: ['cardiff'],
  'oxford-brookes': ['brookes'],
  utoronto: ['toronto'],
  cmu: ['carnegie', 'mellon'],
  uiuc: ['illinois'],
  csudh: ['dominguez'],
  ljmu: ['moores'],
};

/**
 * Names, adjectives, and visa-money terms used by one country only (Sperrkonto / blocked account = Germany,
 * GIC = Canada). "I-20" is left out: normalised it reads "i 20", which also matches "am I 20 years old".
 */
const COUNTRY_ALIASES: Record<string, string[]> = {
  DE: ['germany', 'german', 'deutschland', 'sperrkonto', 'sperr konto', 'blocked account', 'blocked accounts'],
  CH: ['switzerland', 'swiss'],
  UK: ['uk', 'u k', 'united kingdom', 'britain', 'great britain', 'british', 'england', 'scotland', 'wales'],
  CA: ['canada', 'canadian', 'gic'],
  US: ['usa', 'u s a', 'united states', 'america', 'american'],
  PK: ['pakistan', 'pakistani'],
};

/** Home country: only used for Pakistan's own rules (dual nationality), never as a study destination. */
const HOME_COUNTRY = 'PK';

/** Hard cap on rows passed on (keeps the prompt small and the UI readable). */
export const MAX_ROWS = 12;

const MAX_VALUE_CHARS = 600;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasPhrase(normalized: string, phrase: string): boolean {
  const p = normalizeQuestion(phrase).trim();
  if (!p) return false;
  return new RegExp(`\\b${escapeRe(p)}\\b`).test(normalized);
}

function clip(s: string): string {
  return s.length > MAX_VALUE_CHARS ? s.slice(0, MAX_VALUE_CHARS - 1) + '…' : s;
}

/** Only http(s) URLs from data are passed on (the raw data string is kept for display/citation). */
function okUrl(url: string | null | undefined): string | null {
  return url && safeHref(url) ? url : null;
}

/* ---------------- value formatting (plain text, from data only) ---------------- */

function formatGpa(v: GpaRule): string {
  const scale = SCALE_LABEL[v.scale] ?? String(v.scale);
  const base = v.scale === 'german' ? `${v.min} or better (${scale})` : `Minimum ${v.min} (${scale})`;
  // Other minimums printed in the same snippet (e.g. "60% or GPA 2.7"), so percentage students get an answer too.
  const alts = (v.alternatives ?? []).map((a) => `${a.min} (${SCALE_LABEL[a.scale] ?? a.scale})`);
  const rule = alts.length ? `${base}, or ${alts.join(' or ')}` : base;
  return v.text ? `${v.text} — ${rule}` : rule;
}

function formatLanguage(v: LanguageReq): string {
  const parts: string[] = [];
  if (v.ielts_overall != null) parts.push(`IELTS overall ${v.ielts_overall}`);
  if (v.toefl_ibt != null) parts.push(`TOEFL iBT ${v.toefl_ibt}`);
  if (v.waiver) parts.push(`Waiver: ${v.waiver}`);
  if (v.text) parts.push(v.text);
  return parts.join('; ') || 'See the source page';
}

/** The official route's own words, plus the lowest (German scale: weakest) grade it names, when it names one. */
function formatConditional(v: ConditionalAdmission): string {
  const text = typeof v.text === 'string' ? v.text.trim() : '';
  if (typeof v.min !== 'number' || !Number.isFinite(v.min)) return text || 'See the source page';
  const scale = SCALE_LABEL[v.scale] ?? String(v.scale);
  const floor = v.scale === 'german' ? `Weakest grade this route names: ${v.min} (${scale}).` : `Lowest grade this route names: ${v.min} (${scale}).`;
  return text ? `${text} ${floor}` : floor;
}

const DAY_MS = 86_400_000;

/** Whole UTC calendar days from `now` to an ISO date (negative = passed). Null when the date is not a date. */
export function daysUntilDeadline(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || Number.isNaN(now.getTime())) return null;
  const d = new Date(t);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

export const DEADLINE_PASSED_TEXT = '(this date has passed; the next deadline is not verified yet)';
export const DEADLINE_TODAY_TEXT = '(closes today)';

/**
 * Status of a deadline, computed in code and written into the row value, so the model, the fallback list and
 * "Sources used" all repeat it instead of working it out: "(6 days left)", "(closes today)" or the passed text.
 * Never invents the next deadline.
 */
export function deadlineStatusText(iso: string, now: Date): string | null {
  const days = daysUntilDeadline(iso, now);
  if (days === null) return null;
  if (days < 0) return DEADLINE_PASSED_TEXT;
  if (days === 0) return DEADLINE_TODAY_TEXT;
  return `(${days} day${days === 1 ? '' : 's'} left)`;
}

export function formatProgramValue(field: ProgramChatField, v: unknown): string {
  try {
    switch (field) {
      case 'deadline':
        return formatDate(String(v));
      case 'conditional_admission':
        return formatConditional(v as ConditionalAdmission);
      case 'tuition':
      case 'living_cost':
        return formatMoney(v as Money);
      case 'min_gpa_rule':
        return formatGpa(v as GpaRule);
      case 'language_req':
        return formatLanguage(v as LanguageReq);
      case 'duration_months': {
        const n = Number(v);
        return Number.isFinite(n) && n % 12 === 0 ? `${formatMonths(n)} (${n} months)` : formatMonths(n);
      }
      case 'lor_count': {
        const n = Number(v);
        return Number.isFinite(n) ? `${n} letter${n === 1 ? '' : 's'}` : String(v);
      }
      case 'progression_guaranteed':
        return v === true ? 'Yes' : v === false ? 'No' : String(v);
      default:
        return typeof v === 'string' ? v : JSON.stringify(v);
    }
  } catch {
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
}

function cleanNote(note: unknown): string | null {
  return typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
}

/**
 * A value plus the fact's student-facing `note` (e.g. "Applications close at 12:00 noon CET"), so the chat, its
 * fallback list and "Sources used" show the same caveat the program page shows. Only `note` is ever used here:
 * `review_note` is internal and never leaves the server.
 */
export function withNote(value: string, note: unknown): string {
  const n = cleanNote(note);
  return n ? `${value} Note: ${n}` : value;
}

export function formatCountryValue(v: CountryFactValue | null | undefined, note?: string | null): string | null {
  if (!v || typeof v.text !== 'string' || v.text.trim() === '') return null;
  const notes = [cleanNote(v.clock_note), cleanNote(note)].filter((n): n is string => n != null);
  return notes.length > 0 ? `${v.text} Note: ${notes.join(' ')}` : v.text;
}

/* ---------------- row builders ---------------- */

export function programDisplayName(p: Program, inst: Institution | undefined): string {
  return inst ? `${p.name} at ${inst.name}` : p.name;
}

export function programRow(p: Program, inst: Institution | undefined, field: ProgramChatField, now: Date): ChatRow {
  const fact = p[field] as Fact<unknown> | null | undefined;
  const confidence = computeConfidence(fact, now);
  const fmt = (v: unknown, note?: unknown) => clip(withNote(formatProgramValue(field, v), note));
  const info = FIELD_INFO[field];
  // Days left / passed: only for a usable deadline (a Conflict shows both dates as they are; Unverified is withheld).
  const status =
    field === 'deadline' && isUsable(confidence) && typeof fact?.value === 'string' ? deadlineStatusText(fact.value, now) : null;
  const row: ChatRow = {
    id: `${p.id}:${field}`,
    entity: 'program',
    entity_id: p.id,
    entity_name: programDisplayName(p, inst),
    field,
    label: info.label,
    value:
      fact && fact.value != null
        ? status
          ? clip(withNote(`${formatProgramValue(field, fact.value)} ${status}`, fact.note))
          : fmt(fact.value, fact.note)
        : null,
    confidence,
    source_url: okUrl(fact?.source_url),
    evidence_snippet: fact?.evidence_snippet ?? null,
    fetched_at: fact?.fetched_at ?? null,
    official_url: okUrl(p.official_url) ?? okUrl(inst?.website),
  };
  if (fact && confidence === 'Conflict') {
    const sources = allSources(fact);
    row.sources = sources.map(
      (s): ChatRowSource => ({
        value: s.value != null ? fmt(s.value, s.note) : null,
        source_url: okUrl(s.source_url),
        evidence_snippet: s.evidence_snippet ?? null,
        fetched_at: s.fetched_at ?? null,
      }),
    );
    row.email_draft = buildConflictEmail({
      programName: p.name,
      institutionName: inst?.name ?? p.name,
      fieldLabel: info.label,
      sources,
      formatValue: (v) => formatProgramValue(field, v),
      to: usableValue(p.admissions_email, now),
    });
  }
  return row;
}

export function countryRow(
  code: string,
  key: CountryFactKey,
  fact: CountryFact | undefined,
  now: Date,
): ChatRow {
  const confidence = computeConfidence(fact, now);
  const info = FIELD_INFO[key];
  const row: ChatRow = {
    id: fact?.id ?? `${code.toLowerCase()}-${key}`,
    entity: 'country',
    entity_id: code,
    entity_name: countryName(code),
    field: key,
    label: info.label,
    value: fact ? (formatCountryValue(fact.value, fact.note) ?? null) : null,
    confidence,
    source_url: okUrl(fact?.source_url),
    evidence_snippet: fact?.evidence_snippet ?? null,
    fetched_at: fact?.fetched_at ?? null,
    official_url: okUrl(fact?.source_url),
  };
  if (row.value) row.value = clip(row.value);
  if (fact && confidence === 'Conflict') {
    row.sources = allSources(fact).map((s) => ({
      value: s.value ? clip(formatCountryValue(s.value, s.note) ?? '') || null : null,
      source_url: okUrl(s.source_url),
      evidence_snippet: s.evidence_snippet ?? null,
      fetched_at: s.fetched_at ?? null,
    }));
  }
  return row;
}

/* ---------------- entity detection ---------------- */

export function detectInstitutions(normalized: string, institutions: Institution[]): string[] {
  const found: string[] = [];
  for (const inst of institutions) {
    if (inst.kind !== 'destination') continue;
    const aliases = [...(INSTITUTION_ALIASES[inst.id] ?? []), inst.name];
    if (aliases.some((a) => hasPhrase(normalized, a))) found.push(inst.id);
  }
  return found;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * "Did you mean …?" for a question that names no university exactly. Uses suggestName() (one clear winner or
 * nothing). The correction swaps only the misspelled word, so tapping the chip asks the student's own question.
 */
export function suggestInstitution(question: string, normalized: string, institutions: Institution[]): ChatSuggestion | null {
  const candidates: FuzzyCandidate[] = institutions
    .filter((i) => i.kind === 'destination' && FUZZY_NAME_WORDS[i.id])
    .map((i) => ({ key: i.id, label: i.name, words: FUZZY_NAME_WORDS[i.id] }));
  const hit = suggestName(normalized, candidates);
  if (!hit) return null;
  const replacement = capitalize(hit.matched);
  for (const m of question.matchAll(/[\p{L}\p{M}'’`]+/gu)) {
    if (normalizeQuestion(m[0]).trim() !== hit.typed) continue;
    const at = m.index ?? 0;
    const corrected = question.slice(0, at) + replacement + question.slice(at + m[0].length);
    return { typed: m[0], label: hit.label, question: corrected.slice(0, MAX_QUESTION_CHARS) };
  }
  return { typed: hit.typed, label: hit.label, question: `Tell me about ${hit.label}` };
}

export function detectCountries(original: string, normalized: string): string[] {
  const found = new Set<string>();
  for (const [code, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((a) => hasPhrase(normalized, a))) found.add(code);
  }
  // "US" only when written in capitals (so the pronoun "us" never matches); also "U.S."
  if (/\bUS\b|\bU\.S\.?(?=\W|$)/.test(original)) found.add('US');
  return [...found];
}

const PROGRAM_NAME_STOPWORDS = new Set(['msc', 'ms', 'ma', 'master', 'masters', 'of', 'in', 'and', 'science', 'the', 'to', 'route']);

/** Within one institution, prefer programs whose distinctive name words appear in the question. */
function pickPrograms(normalized: string, programs: Program[]): Program[] {
  if (programs.length <= 1) return programs;
  const scored = programs.map((p) => {
    const words = normalizeQuestion(p.name).trim().split(' ').filter((w) => w.length > 2 && !PROGRAM_NAME_STOPWORDS.has(w));
    return { p, score: words.filter((w) => hasPhrase(normalized, w)).length };
  });
  const best = Math.max(...scored.map((s) => s.score));
  return best > 0 ? scored.filter((s) => s.score === best).map((s) => s.p) : programs;
}

/* ---------------- main entry ---------------- */

/**
 * For listOnlyKnown fields asked across many programs or countries: drop the rows without a usable or Conflict
 * value, unless none has one (then every row stays, so the refusal names them all).
 */
function dropUnknownInLists(rows: ChatRow[], fields: ChatField[]): ChatRow[] {
  let out = rows;
  for (const f of fields) {
    if (!FIELD_INFO[f].listOnlyKnown) continue;
    const ofField = out.filter((r) => r.field === f);
    if (ofField.some((r) => r.confidence !== 'Unverified')) out = out.filter((r) => r.field !== f || r.confidence !== 'Unverified');
  }
  return out;
}

export function retrieve(question: string, scope: ChatScope, dataset: ChatDataset, now: Date): Retrieval {
  const normalized = normalizeQuestion(question);
  const { fields, unsupportedTopic } = detectFields(normalized);
  const instById = new Map(dataset.institutions.map((i) => [i.id, i]));

  // 1. Programs named in the question (via their institution), else the scope's program.
  let programs: Program[] = [];
  const namedInstitutions = detectInstitutions(normalized, dataset.institutions);
  for (const instId of namedInstitutions) {
    programs.push(...pickPrograms(normalized, dataset.programs.filter((p) => p.institution_id === instId)));
  }
  // A near-miss name ("Imprial") is never answered with a guess, not even with the page's own program.
  const suggestion = namedInstitutions.length === 0 ? suggestInstitution(question, normalized, dataset.institutions) : null;
  if (suggestion) {
    return { rows: [], fields, programIds: [], countries: [], unsupportedTopic, suggestion };
  }
  if (programs.length === 0 && scope.programId) {
    const p = dataset.programs.find((x) => x.id === scope.programId);
    if (p) programs = [p];
  }

  // 2. Countries named in the question, else the scope's country, else the matched programs' countries.
  let countries = detectCountries(question, normalized);
  const namedCountries = countries.filter((c) => c !== HOME_COUNTRY);
  if (namedCountries.length === 0 && scope.country) countries = [...countries, scope.country.toUpperCase()];
  const programCountries = [...new Set(programs.map((p) => p.country))];
  const destCountries = (() => {
    const named = countries.filter((c) => c !== HOME_COUNTRY);
    return named.length > 0 ? named : programCountries;
  })();

  const programFields = fields.filter(isProgramField);
  const countryFields = fields.filter(isCountryField);
  const generalQuestion = fields.length === 0 && !unsupportedTopic;

  const rows: ChatRow[] = [];
  const seen = new Set<string>();
  const push = (r: ChatRow) => {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      rows.push(r);
    }
  };

  // 3. Program rows.
  let programsForFields = programs;
  if (programFields.length > 0 && programsForFields.length === 0) {
    // Field asked without naming a program: every active program in the named countries (or everywhere).
    const inCountries = destCountries.length > 0 ? dataset.programs.filter((p) => destCountries.includes(p.country)) : dataset.programs;
    programsForFields = inCountries.filter((p) => p.status === 'active');
  }
  const wantedProgramFields: ProgramChatField[] = generalQuestion && programs.length > 0 ? PROGRAM_SUMMARY_FIELDS : programFields;
  // Companion rows (waiver beside the English requirement, conditional route beside the minimum grade) only for a
  // named program and only for fields the student asked about.
  const withCompanions = programs.length > 0 && !generalQuestion;
  for (const p of programsForFields) {
    const inst = instById.get(p.institution_id);
    // A ruled-out program always shows its status first.
    const list: ProgramChatField[] =
      p.status === 'ruled_out' && !wantedProgramFields.includes('status_note') && wantedProgramFields.length > 0
        ? ['status_note', ...wantedProgramFields]
        : wantedProgramFields;
    for (const f of list) {
      if (f === 'status_note' && p.status !== 'ruled_out' && p.status_note?.value == null) continue;
      const r = programRow(p, inst, f, now);
      if (FIELD_INFO[f].secondary && r.value == null) continue;
      push(r);
      // Only beside a USABLE asked row: a companion must never turn a "not verified yet" refusal into an answer.
      if (!withCompanions || !isUsable(r.confidence)) continue;
      for (const c of COMPANION_FIELDS[f] ?? []) {
        if (list.includes(c)) continue;
        const companion = programRow(p, inst, c, now);
        // Context only: a companion with no sourced value is left out, so it never causes a refusal.
        if (companion.value == null || companion.confidence === 'Unverified') continue;
        push(companion);
      }
    }
  }

  // 4. Country rows. A cost question about a country (no program named) also gets the country's typical costs.
  const costCountryFields: CountryFactKey[] =
    programs.length === 0 && destCountries.length > 0
      ? [
          ...(programFields.includes('tuition') ? (['tuition_typical'] as const) : []),
          ...(programFields.includes('living_cost') ? (['living_cost_typical'] as const) : []),
        ]
      : [];
  const wantedCountryFields: CountryFactKey[] =
    generalQuestion && programs.length === 0 && destCountries.length > 0
      ? COUNTRY_SUMMARY_FIELDS
      : [...countryFields, ...costCountryFields];
  if (wantedCountryFields.length > 0) {
    const knownCountries = [...new Set(dataset.countryFacts.map((f) => f.country))].filter((c) => c !== HOME_COUNTRY);
    for (const key of wantedCountryFields) {
      const targets = key === 'pakistan_dual_nationality' ? [HOME_COUNTRY] : destCountries.length > 0 ? destCountries : knownCountries;
      for (const code of targets) {
        if (code === HOME_COUNTRY && key !== 'pakistan_dual_nationality') continue;
        const fact = dataset.countryFacts.find((f) => f.country === code && f.key === key);
        const r = countryRow(code, key, fact, now);
        if (FIELD_INFO[key].secondary && r.value == null) continue;
        push(r);
      }
    }
  }

  // Lists across every program / country: only the known rows of listOnlyKnown fields (see FIELD_INFO).
  const listedFields: ChatField[] = [
    ...(programs.length === 0 ? programFields : []),
    ...(destCountries.length === 0 ? countryFields : []),
  ];

  return {
    rows: dropUnknownInLists(rows, listedFields),
    fields,
    programIds: programs.map((p) => p.id),
    countries: destCountries,
    unsupportedTopic,
    suggestion: null,
  };
}
