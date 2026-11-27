/**
 * The chat guard (pure, deterministic). Runs BEFORE any model call and decides whether the model may speak.
 *
 *  - Legal/immigration advice, dishonesty, predictions or guarantees -> refuse (never a probability).
 *  - A specific field is asked and no row has a usable (Verified/Likely) value -> refuse WITHOUT the model:
 *    "not verified yet" + the official link; a Conflict lists both values and both links.
 *  - Nothing matches -> "I don't have data on that yet" + pointers.
 *  - Otherwise -> 'answer' with the selected rows (the model only explains them).
 */
import { isUsable } from '@/lib/confidence';
import { FIELD_INFO, normalizeQuestion } from './fields';
import type { Retrieval } from './retrieve';
import { MAX_ROWS } from './retrieve';
import type { ChatPointer, ChatRow, ChatSuggestion, RefusalReason } from './types';

type Pointer = ChatPointer;

export type GuardDecision =
  | { mode: 'refusal'; reason: RefusalReason; text: string; rows: ChatRow[]; pointers: Pointer[]; suggestion?: ChatSuggestion }
  | { mode: 'answer'; rows: ChatRow[] };

/** "I couldn't find 'Imprial' in MastersPath. Did you mean Imperial College London?" (built in code, no model). */
export function unknownNameText(s: ChatSuggestion): string {
  return `I couldn't find '${s.typed}' in MastersPath. Did you mean ${s.label}?`;
}

export type UnsafeIntent = 'prediction' | 'legal' | 'dishonest';

/** Documents and results a student must never fake. */
const DOCS =
  '(documents?|docs|papers?|degrees?|certificates?|transcripts?|marksheets?|mark sheets?|bank statements?|statements?|ielts|toefl|pte|duolingo|results?|scores?|letters?|experience( letters?)?|offer( letters?)?|admission( letters?)?|visas?|stamps?|signatures?|cas|i ?20|loa|references?|grades|cgpa)';

/**
 * Asking for help to deceive. Deliberately narrow: "Is this consultant fake?" or "my agent asked for a bribe"
 * are honest questions (they get the normal no-data answer with a pointer to the Check page).
 */
const DISHONEST_PATTERNS: RegExp[] = [
  /\b(should|can|could|shall|would|do|must) (i|we) (just |simply )?(lie|cheat|fake|forge|bribe|pay a bribe|hide|misrepresent)\b/,
  /\b(lie|lying|lied) (to|on|in|about)\b/,
  new RegExp(`\\b(fake|faked|forged?|forgery|fabricat\\w*|counterfeit|doctored|edited|altered|false) (a |an |the |my |some )?${DOCS}\\b`),
  /\b(make|get|buy|create|use|submit|show|send) (a |an |some |my )?(fake|forged|false|doctored)\b/,
  new RegExp(`\\bbuy (a |an |the |my )?${DOCS}\\b`),
  /\b(edit|change|alter|increase|photoshop) (my |the )?(transcript|bank statement|degree|marksheet|result|cgpa|gpa|grades|marks)\b/,
  /\bhide (my |a |the )?(previous |old )?(visa )?(refusal|refusals|rejection|rejections|gap|record)\b/,
  /\b(misrepresent\w*|false (information|details))\b/,
];

/** Legal or immigration advice about the student's own case. */
const LEGAL =
  /\b(is (this|it|that) (legal|illegal|allowed by law|against the law)|legal advice|immigration advice|lawyer|lawyers|solicitor|attorney|sue|appeal (my |a |the )?(visa )?(refusal|decision|rejection)|overstay\w*|illegal\w*|without (a )?(permit|work permit|visa)|asylum|deport\w*)\b/;

/** Outcomes nobody can promise: admission, visas, scholarships, residence. */
const OUTCOME =
  '(visa|visas|admission|admitted|accepted|selected|in|into|an offer|offer|offers|scholarship|scholarships|rejected|refused|approved|granted|pr|citizenship|settlement|a job|job)';

/**
 * Outcome NOUNS that may follow a short description ("a UK visa", "a German student visa", "an admission offer").
 * Prepositions such as "in"/"into" are left out on purpose: "get a scholarship in Germany" must not read as "get in".
 */
const OUTCOME_NOUN = '(visa|visas|admission|offer|offers|scholarship|scholarships|pr|citizenship|settlement|job|place|seat)';

/** Up to two describing words between the article and the outcome ("a UK visa", "a UK student visa"). */
const DESCRIBED = '(?:(?:a|an|the|my|our) )?(?:\\w+ ){0,2}';

/**
 * "Can I get a UK student visa?" is a prediction, but "Can I get a Graduate / work visa?" asks about a rule we hold
 * data on (work after study), so those describing words are excluded for "can".
 */
const CAN_DESCRIBED = '(?:(?:a|an|the|my|our) )?(?:(?!graduate |work |working |post |study |psw |job |seeker )\\w+ ){0,2}';

/** Things a decision is made about ("my UK visa", "the application"). */
const DECIDED_THING = '(visa|visas|application|applications|file|case|admission|offer|cas|scholarship|permit|pr|citizenship)';

const DECISION = '(approved|refused|rejected|accepted|granted|denied|selected|admitted)';

const PREDICTION_PATTERNS: RegExp[] = [
  /\b(chance|chances|odds|probability|probable|likelihood|how likely|predict\w*|forecast|success rate|acceptance rate|admit rate|admission rate|approval rate|refusal rate|rejection rate|selection rate|success ratio)\b/,
  // "Will I get a visa?" — any outcome.
  new RegExp(`\\b(will|would|shall) (i|we|my \\w+) (definitely |surely |still |really |actually |ever )?(get|be) (a |an |the |my )?${OUTCOME}\\b`),
  // "Will I get a UK visa?", "Will I get a German student visa?"
  new RegExp(`\\b(will|would|shall) (i|we|my \\w+) (definitely |surely |still |really |actually |ever )?(get|receive|obtain) ${DESCRIBED}${OUTCOME_NOUN}\\b`),
  // "... that I will get PR?"
  new RegExp(`\\b(i|we) (will|would) (definitely |surely |still |really |actually )?(get|be) (a |an |the |my )?${OUTCOME}\\b`),
  new RegExp(`\\b(i|we) (will|would) (definitely |surely |still |really |actually )?(get|receive|obtain) ${DESCRIBED}${OUTCOME_NOUN}\\b`),
  // "Can I get admission with 2.5?" — but "Can I get a scholarship / PR?" asks about rules, which we answer from data.
  /\b(can|could) (i|we) (definitely |surely |still |really |actually |ever )?(get|be) (a |an |the |my )?(visa|visas|admission|admitted|accepted|selected|in|into|an offer|offer|offers|rejected|refused|approved|granted)\b/,
  // "Can I get a UK student visa?"
  new RegExp(`\\b(can|could) (i|we) (definitely |surely |still |really |actually |ever )?(get|be) ${CAN_DESCRIBED}(visa|visas|admission|offer|offers)\\b`),
  /\b(am i|are we|is it) (going|likely|sure|certain) to (get|be|pass)\b/,
  // "Will my UK visa be approved?", "Is my UK visa going to be refused?", "Will the application get accepted?"
  new RegExp(`\\b(will|would|is|are) (my|the|our) (\\w+ ){0,2}${DECIDED_THING} (going to )?(be|get) ${DECISION}\\b`),
  /\bwill (they|the university|the embassy|the visa officer|the officer|ukvi|uscis|ircc|the home office) (accept|reject|refuse|approve|grant|give|admit)\b/,
  // Any named decision-maker about the student: "Will Imperial accept me?", "Would TUM admit us?"
  /\b(will|would) (\w+ ){0,4}(accept|admit|reject|refuse|approve|grant|select) (me|us)\b/,
  // "Will TUM give me a scholarship?" (but "Will you give me the deadline?" is a data question)
  new RegExp(`\\b(will|would) (\\w+ ){1,4}give (me|us) ${DESCRIBED}${OUTCOME_NOUN}\\b`),
];

/**
 * Roman Urdu outcome questions: "Kya mujhe UK ka visa mil jayega?", "Kya mera admission CMU mein ho jayega?".
 * The marker ("will it happen / will I get it") only counts next to an outcome word, so
 * "TUM ka deadline kahan milega?" (where will I find it) stays a normal data question.
 */
const ROMAN_URDU_WILL =
  /\b((mil|lag|ho) ?(jayega|jayegi|jayenge|jaye ga|jaye gi|jaega|jaegi|jaa ega|jaa egi|jayga|jaygi)|milega|milegi|milenge|mile ga|mile gi)\b/;
const ROMAN_URDU_OUTCOME =
  /\b(visa|visas|admission|admissions|dakhla|dakhila|offer|scholarship|scholarships|pr|citizenship|nationality|job|naukri|seat|selection|acceptance|cas)\b/;
/** "Kya mujhe admission mil sakta hai?" = "Can I get admission?" (scholarship / PR "mil sakti" asks about rules). */
const ROMAN_URDU_CAN = /\b(mil|lag|ho) (sakta|sakti|sakte)\b/;
const ROMAN_URDU_CAN_OUTCOME = /\b(visa|visas|admission|admissions|dakhla|dakhila|offer|selection|acceptance)\b/;

/**
 * "100%" is a prediction only next to a certainty or outcome word ("Am I 100% sure to get the visa?").
 * "100% scholarship" or "a 50 percent tuition waiver" asks about funding, which we answer from data.
 */
const PERCENT_FUNDING =
  /\b\d{1,3} ?(%|percent)( \w+)? (scholarship|scholarships|funding|funded|tuition|fee|fees|waiver|waivers|remission|financial aid|stipend|stipends|bursary|bursaries|fellowship|fellowships|discount)\b/g;
const HUNDRED = /\b100 ?(%|percent)/;
const HUNDRED_CONTEXT =
  /\b(sure|certain|certainly|definitely|guarantee\w*|chance\w*|confirm\w*|success\w*|visa|visas|admission|admit\w*|accept\w*|select\w*|offer|offers|approv\w*|refus\w*|reject\w*|pass|get in|get into|pr|citizenship)\b/;

/** "definitely" / "for sure" only signal a prediction next to an outcome ("Do I definitely need IELTS?" is a fact question). */
const CERTAINTY = /\b(definitely|for sure|surely|certain|certainly|confirm(ed)? (that )?i)\b/;
const CERTAINTY_OUTCOME = new RegExp(`\\b(get|got|be|pass|succeed|${OUTCOME.slice(1, -1)})\\b`);

/** "What percentage do I need?" is a grade question in Pakistan; "What percentage of applicants get in?" is not. */
const PERCENT = /%|\bpercent(age)?s?\b/;
const PERCENT_AS_GRADE = /\b(c?gpa|marks|grade|grades|division|need|needed|required|require|requirement|requirements|minimum|min|score)\b/;

/** Classify questions MastersPath must never answer from data. Order: dishonesty > legal > prediction. */
export function detectUnsafeIntent(question: string): UnsafeIntent | null {
  const s = normalizeQuestion(question);
  if (DISHONEST_PATTERNS.some((re) => re.test(s))) return 'dishonest';
  if (LEGAL.test(s)) return 'legal';
  const progression = /\b(progression|progress (to|into|onto))\b/.test(s);
  if (/\bguarantee\w*\b/.test(s) && !progression) return 'prediction';
  if (PREDICTION_PATTERNS.some((re) => re.test(s))) return 'prediction';
  if (ROMAN_URDU_WILL.test(s) && ROMAN_URDU_OUTCOME.test(s)) return 'prediction';
  if (ROMAN_URDU_CAN.test(s) && ROMAN_URDU_CAN_OUTCOME.test(s)) return 'prediction';
  if (CERTAINTY.test(s) && CERTAINTY_OUTCOME.test(s)) return 'prediction';
  // Funding percentages ("100% scholarship") are a data question, not a prediction.
  const withoutFunding = s.replace(PERCENT_FUNDING, ' ');
  if (HUNDRED.test(withoutFunding) && HUNDRED_CONTEXT.test(withoutFunding)) return 'prediction';
  if (PERCENT.test(withoutFunding) && !PERCENT_AS_GRADE.test(withoutFunding)) return 'prediction';
  return null;
}

const NOT_ADVICE = 'This is not legal or immigration advice.';

export const NO_DATA_TEXT = "I can only answer from verified data in MastersPath, and I don't have data on that yet.";

const INTENT_TEXT: Record<UnsafeIntent, string> = {
  prediction: [
    "I can't predict admission or visa decisions, and MastersPath never gives chances, percentages or guarantees.",
    'Universities and immigration offices decide each case themselves.',
    'What I can show you is official information from our database, with its source.',
    'To compare your grades with a program’s published minimum, use your Shortlist.',
    `${NOT_ADVICE} Please check the official government and university websites.`,
  ].join(' '),
  legal: [
    "I can't say what is allowed in your own case. MastersPath is not legal or immigration advice.",
    'It only shows information copied from official pages, with links.',
    'For your own situation, please check the official government website or talk to a registered immigration adviser.',
  ].join(' '),
  dishonest: [
    "I can't help with that.",
    'MastersPath only helps with honest applications that use genuine documents.',
    'If anyone suggests false documents or payments to "fix" a case, please do not go ahead.',
    'If something in your documents is unclear, ask the university or the official visa office directly.',
    NOT_ADVICE,
  ].join(' '),
};

const INTENT_POINTERS: Record<UnsafeIntent, Pointer[]> = {
  prediction: [{ href: '/shortlist', label: 'Compare grades with published minimums' }],
  legal: [{ href: '/check', label: 'Check a claim against official sources' }],
  dishonest: [{ href: '/check', label: 'Check a claim against official sources' }],
};

const NO_DATA_POINTERS: Pointer[] = [
  { href: '/check', label: 'Check a claim against official sources' },
  { href: '/shortlist', label: 'See programs in MastersPath' },
];

/* ---------------- getting started (greetings and general "how do I apply") ---------------- */

const GREETING =
  /^ (hi+|hello+|hey+|hiya|salam|salaam|assalam\w*|asalam\w*|aoa|as?salamu? ?alaikum|good (morning|afternoon|evening)|yo) /;
const GENERAL_START =
  / ((want|wanna|planning|plan|wish|hope|thinking) (to )?(apply|study|go|do (a |my )?masters?)|how (do|can|should) (i|we) (apply|start|begin|get started)|help me|guide me|where (do|should) i start|get started|getting started|what should i do|what do i do|kahan se shuru|kaise apply|apply kaise) /;

/**
 * True for a greeting or a general "I want to apply / how do I start" message. normalizeQuestion pads the text
 * with spaces, so the patterns use spaces as word edges. Only used when retrieval found no rows and no unsafe
 * intent was detected, so it can never replace a data answer or a safety refusal.
 */
export function isGettingStarted(question: string): boolean {
  const s = normalizeQuestion(question);
  if (!s.trim()) return false;
  return GREETING.test(s) || GENERAL_START.test(s);
}

export const GETTING_STARTED_TEXT =
  'Hi! I answer questions from the sourced data in MastersPath: programs, minimum grades, English tests, deadlines, ' +
  'costs, visa money and work after study. Every answer links to the official page.\n\n' +
  'A good way to start: add your grade and field on the Shortlist to see which programs you meet the minimum for. ' +
  'Then ask me about a program or a country. Got advice from an agent? Paste it into Check before you pay anyone.';

const GETTING_STARTED_POINTERS: Pointer[] = [
  { href: '/shortlist', label: 'See programs for my grade' },
  { href: '/citizenship', label: 'Compare countries: cost and citizenship' },
  { href: '/check', label: 'Check what an agent told me' },
];

/* ---------------- text helpers ---------------- */

const NEEDS_THE = new Set(['United Kingdom', 'United States']);

function entityPhrase(row: ChatRow): string {
  return row.entity === 'country' && NEEDS_THE.has(row.entity_name) ? `the ${row.entity_name}` : row.entity_name;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function checkLine(row: ChatRow): string {
  if (row.official_url) return `Please check the official page: ${row.official_url}`;
  return row.entity === 'program'
    ? "Please check the university's official website."
    : 'Please check the official government website.';
}

function groupByEntity(rows: ChatRow[]): ChatRow[][] {
  const groups = new Map<string, ChatRow[]>();
  for (const r of rows) {
    const k = `${r.entity}:${r.entity_id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()];
}

/** "The application deadline for X is not verified yet in MastersPath, so I won't guess. Please check ..." */
export function notVerifiedText(rows: ChatRow[]): string {
  if (rows.length === 0) return NO_DATA_TEXT;
  const groups = groupByEntity(rows);

  if (rows.length === 1) {
    const r = rows[0];
    const info = FIELD_INFO[r.field];
    return `${capitalize(`the ${info.phrase}`)} for ${entityPhrase(r)} ${info.plural ? 'are' : 'is'} not verified yet in MastersPath, so I won't guess. ${checkLine(r)}`;
  }

  if (groups.length === 1) {
    const g = groups[0];
    return [
      `These details for ${entityPhrase(g[0])} are not verified yet in MastersPath, so I won't guess:`,
      ...g.map((r) => `- ${r.label}`),
      checkLine(g[0]),
    ].join('\n');
  }

  const fields = [...new Set(rows.map((r) => r.field))];
  if (groups.length > 6) {
    const what = fields.length === 1 ? `The ${FIELD_INFO[fields[0]].phrase} is` : 'These details are';
    const kind = groups.every((g) => g[0].entity === 'program') ? 'programs' : 'places';
    return `${what} not verified yet for any of the ${groups.length} ${kind} I checked in MastersPath, so I won't guess. Open a program from your Shortlist to find its official page.`;
  }

  const lines: string[] = [];
  if (fields.length === 1) {
    lines.push(`The ${FIELD_INFO[fields[0]].phrase} is not verified yet in MastersPath for:`);
    lines.push(...groups.map((g) => `- ${g[0].entity_name}`));
  } else {
    lines.push('These details are not verified yet in MastersPath:');
    lines.push(...groups.map((g) => `- ${g[0].entity_name}: ${g.map((r) => r.label).join(', ')}`));
  }
  lines.push("So I won't guess. Please check the official pages:");
  for (const g of groups) {
    lines.push(`- ${g[0].entity_name}: ${g[0].official_url ?? (g[0].entity === 'program' ? "the university's official website" : 'the official government website')}`);
  }
  return lines.join('\n');
}

/** Both (all) values with both links, and a nudge to email admissions. */
export function conflictText(rows: ChatRow[]): string {
  const parts = rows.map((r) => {
    const sources = r.sources ?? [];
    return [
      `Official sources disagree on the ${FIELD_INFO[r.field].phrase} for ${entityPhrase(r)}, so I won't pick one:`,
      ...sources.map((s, i) => `- Source ${i + 1}: ${s.value ?? 'no value'} — ${s.source_url ?? 'no link'}`),
    ].join('\n');
  });
  const anyProgram = rows.some((r) => r.entity === 'program');
  parts.push(
    anyProgram
      ? 'Please email the admissions office and ask which one is correct. You can copy a ready-made email below.'
      : 'Please ask the official office which one is correct.',
  );
  return parts.join('\n\n');
}

function noDetailsText(rows: ChatRow[]): string {
  const first = rows[0];
  const what = first.entity === 'program' ? 'details' : 'rules';
  return `MastersPath has no verified ${what} for ${entityPhrase(first)} yet, so I won't guess. ${checkLine(first)}`;
}

function sortUsableFirst(rows: ChatRow[]): ChatRow[] {
  const rank = (r: ChatRow) => (isUsable(r.confidence) ? 0 : r.confidence === 'Conflict' ? 1 : 2);
  return [...rows].map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

/* ---------------- the decision ---------------- */

export function guard(question: string, retrieval: Retrieval): GuardDecision {
  const intent = detectUnsafeIntent(question);
  if (intent) {
    return { mode: 'refusal', reason: intent, text: INTENT_TEXT[intent], rows: [], pointers: INTENT_POINTERS[intent] };
  }

  // A near-miss university name: ask, never answer for a guessed match.
  if (retrieval.suggestion) {
    const suggestion = retrieval.suggestion;
    return { mode: 'refusal', reason: 'unknown_name', text: unknownNameText(suggestion), rows: [], pointers: [], suggestion };
  }

  const rows = retrieval.rows;
  if (rows.length === 0 && !retrieval.unsupportedTopic && isGettingStarted(question)) {
    return { mode: 'refusal', reason: 'getting_started', text: GETTING_STARTED_TEXT, rows: [], pointers: GETTING_STARTED_POINTERS };
  }
  if (rows.length === 0) {
    const text = retrieval.unsupportedTopic
      ? `I can only answer from verified data in MastersPath, and I don't have data on ${retrieval.unsupportedTopic} yet.`
      : NO_DATA_TEXT;
    return {
      mode: 'refusal',
      reason: 'no_data',
      text: `${text} Please check the official university or government website. You can also use the Check page to test a claim before you pay anyone.`,
      rows: [],
      pointers: NO_DATA_POINTERS,
    };
  }

  const usable = rows.filter((r) => isUsable(r.confidence));
  const conflicts = rows.filter((r) => r.confidence === 'Conflict');
  const missing = rows.filter((r) => !isUsable(r.confidence) && r.confidence !== 'Conflict');
  const general = retrieval.fields.length === 0;

  if (usable.length > 0) {
    // General question: only what we actually know. Specific question: include missing rows so the model can
    // say "not verified yet" for them.
    const selected = general ? [...usable, ...conflicts] : rows;
    return { mode: 'answer', rows: sortUsableFirst(selected).slice(0, MAX_ROWS) };
  }

  // No usable value anywhere -> deterministic refusal, the model is never called.
  if (general && conflicts.length === 0) {
    return { mode: 'refusal', reason: 'not_verified', text: noDetailsText(rows), rows: rows.slice(0, MAX_ROWS), pointers: [] };
  }
  const paragraphs: string[] = [];
  if (conflicts.length > 0) paragraphs.push(conflictText(conflicts));
  if (!general && missing.length > 0) paragraphs.push(notVerifiedText(missing));
  const shown = general ? conflicts : [...conflicts, ...missing];
  return {
    mode: 'refusal',
    reason: conflicts.length > 0 ? 'conflict' : 'not_verified',
    text: paragraphs.join('\n\n'),
    rows: shown.slice(0, MAX_ROWS),
    pointers: [],
  };
}
