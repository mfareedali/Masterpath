/**
 * Field catalogue for the chat: labels, which entity a field belongs to, and how a question maps to fields.
 * Pure. Keyword matching is plain code (no AI) so it is predictable and testable.
 */
import type { CountryFactKey } from '@/lib/types';
import type { ChatField, ProgramChatField } from './types';

export interface FieldInfo {
  entity: 'program' | 'country';
  /** Title-case label for lists, e.g. "Application deadline". */
  label: string;
  /** Lower-case phrase for sentences, e.g. "application deadline". */
  phrase: string;
  /** Grammatical number of `phrase` ("are" vs "is"). */
  plural?: boolean;
  /**
   * Secondary fields are only included when the database has a row for them (e.g. "recent citizenship change"),
   * so a missing secondary row never triggers a refusal on its own.
   */
  secondary?: boolean;
  /**
   * When the question names no program (or, for a country fact, no country), only the rows that hold a value are
   * listed, so "Which universities accept MOI?" is not padded with a "not verified yet" row for every program.
   * A named program or country still gets its own "not verified yet" row, and if no row holds a value at all,
   * every row is kept so the code-built "not verified yet" refusal still names them.
   */
  listOnlyKnown?: boolean;
}

export const FIELD_INFO: Record<ChatField, FieldInfo> = {
  deadline: { entity: 'program', label: 'Application deadline', phrase: 'application deadline' },
  tuition: { entity: 'program', label: 'Tuition fee', phrase: 'tuition fee' },
  living_cost: { entity: 'program', label: 'Living cost', phrase: 'living cost' },
  language_req: { entity: 'program', label: 'English language requirement', phrase: 'English language requirement' },
  min_gpa_rule: { entity: 'program', label: 'Minimum grade (CGPA)', phrase: 'minimum grade (CGPA) requirement' },
  lor_count: { entity: 'program', label: 'Recommendation letters', phrase: 'number of recommendation letters' },
  sop_requirements: { entity: 'program', label: 'Statement of purpose', phrase: 'statement of purpose requirements', plural: true },
  cv_requirements: { entity: 'program', label: 'CV requirements', phrase: 'CV requirements', plural: true },
  tests_required: { entity: 'program', label: 'Tests required (GRE/GMAT)', phrase: 'test requirement (GRE/GMAT)' },
  scholarship_info: { entity: 'program', label: 'Scholarships', phrase: 'scholarship information' },
  duration_months: { entity: 'program', label: 'Programme length', phrase: 'programme length' },
  intake: { entity: 'program', label: 'Intake', phrase: 'intake' },
  research_considered: { entity: 'program', label: 'Research considered in admission', phrase: 'information on whether research counts in admission' },
  progression_guaranteed: { entity: 'program', label: 'Progression guaranteed', phrase: 'progression guarantee' },
  progression_requirement: { entity: 'program', label: 'Progression requirement', phrase: 'progression requirement', secondary: true },
  admissions_email: { entity: 'program', label: 'Admissions email', phrase: 'admissions email' },
  status_note: { entity: 'program', label: 'Programme status', phrase: 'programme status' },
  eligibility_note: {
    entity: 'program',
    label: 'Who this course is for',
    phrase: 'eligibility note (who the course is for)',
    secondary: true,
  },
  conditional_admission: {
    entity: 'program',
    label: 'Conditional or provisional admission',
    phrase: 'conditional or provisional admission route',
    listOnlyKnown: true,
  },
  language_waiver: { entity: 'program', label: 'English test waiver', phrase: 'English test waiver rule', listOnlyKnown: true },
  citizenship_rule: { entity: 'country', label: 'Citizenship (naturalisation) rule', phrase: 'citizenship (naturalisation) rule' },
  citizenship_update: { entity: 'country', label: 'Recent citizenship change', phrase: 'recent citizenship change', secondary: true },
  dual_nationality_destination: { entity: 'country', label: 'Dual nationality', phrase: 'dual nationality rule' },
  pakistan_dual_nationality: { entity: 'country', label: "Pakistan's dual nationality rule", phrase: "Pakistan's dual nationality rule" },
  post_study_work: { entity: 'country', label: 'Work after study', phrase: 'work-after-study rule' },
  pr_route: { entity: 'country', label: 'Permanent residence route', phrase: 'permanent residence route' },
  tuition_typical: { entity: 'country', label: 'Typical tuition', phrase: 'typical tuition' },
  living_cost_typical: { entity: 'country', label: 'Typical living cost', phrase: 'typical living cost' },
  proof_of_funds: {
    entity: 'country',
    label: 'Money to show for the student visa',
    phrase: 'money you must show for the student visa',
    listOnlyKnown: true,
  },
};

/**
 * Rows shown NEXT TO an asked program field, only for a named program (or the page's program) and only when that
 * program has a sourced value: the English test waiver beside the English requirement, the official conditional
 * route beside the minimum grade, and the other way round. They are context, never a decision: a conditional route
 * or a waiver never changes whether a student meets the regular minimum.
 */
export const COMPANION_FIELDS: Partial<Record<ProgramChatField, ProgramChatField[]>> = {
  language_req: ['language_waiver'],
  language_waiver: ['language_req'],
  min_gpa_rule: ['conditional_admission'],
  conditional_admission: ['min_gpa_rule'],
};

export function isProgramField(f: ChatField): f is ProgramChatField {
  return FIELD_INFO[f].entity === 'program';
}

export function isCountryField(f: ChatField): f is CountryFactKey {
  return FIELD_INFO[f].entity === 'country';
}

/**
 * Fields shown when a question names a program but no specific field ("Tell me about TUM").
 * status_note and eligibility_note are only included when the program has a value (see retrieve.ts).
 */
export const PROGRAM_SUMMARY_FIELDS: ProgramChatField[] = [
  'status_note',
  'eligibility_note',
  'deadline',
  'intake',
  'tuition',
  'living_cost',
  'duration_months',
  'min_gpa_rule',
  'language_req',
  'tests_required',
  'scholarship_info',
];

/** Country facts shown when a question names a country but no specific field. */
export const COUNTRY_SUMMARY_FIELDS: CountryFactKey[] = [
  'post_study_work',
  'pr_route',
  'citizenship_rule',
  'citizenship_update',
  'dual_nationality_destination',
  'tuition_typical',
  'living_cost_typical',
];

/** eligibility_note is secondary: it is only added when the program has one (a warning, never a decision). */
const REQUIREMENT_FIELDS: ChatField[] = [
  'eligibility_note',
  'min_gpa_rule',
  'language_req',
  'tests_required',
  'lor_count',
  'sop_requirements',
  'cv_requirements',
];

interface FieldPattern {
  test: RegExp | ((s: string) => boolean);
  fields: ChatField[];
  /** Weak matches are dropped when any strong match exists ("minimum IELTS" -> language only). */
  weak?: boolean;
  /**
   * Also removed from the text when this pattern matches, so later patterns cannot read it.
   * "How long can I stay after my Masters?" asks about the work-after-study rule, so its "how long" must not
   * fall through to the programme length.
   */
  consumes?: RegExp;
}

/** "How long" / "how many years" (also Roman Urdu "kitne saal") belong to an immigration rule when the question is about one. */
const HOW_LONG = /\b(how long|how many (years|months)|how much time|kitne (saal|sal|mahine|mahiney|maheene)|kitna (arsa|arsaa|time|waqt))\b/;

/** Roman Urdu "after studying" + work / job / staying: "UK mein parhai ke baad kitna kaam kar sakte hain?" */
function asksAboutWorkAfterStudyRomanUrdu(s: string): boolean {
  return (
    /\b(parhai|parhayi|parhaai|padhai|padhaai|parhne|padhne|study|studies|degree|masters|graduation) (ke|kay|k) (baad|bad)\b/.test(s) &&
    /\b(kaam|kam karna|naukri|nokri|naukari|job|jobs|work|rehna|rehne|reh|rukna|rukne|stay)\b/.test(s)
  );
}

/**
 * Money the student must show for the student visa (proof of funds, blocked account, bank statement).
 * Matched as a phrase and removed from the text, so "bank statement" never reads as a statement of purpose and
 * "how much money to show" never reads as tuition.
 */
const VISA_MONEY_PHRASE =
  /\b(proof of (funds?|financial \w+|finances?|money)|bank statements?|bank balance|blocked accounts?|sperrkonto|sperr konto|financial (requirement|requirements|proof|support|evidence)|maintenance (funds?|money|requirement)|funds? (required|needed|requirement|requirements)|visa funds?|gic|i ?20 funds?)\b/;
const MONEY_WORD = /\b(money|funds?|paise|paisay|pese|paisa|raqam|balance|amount)\b/;
/** "show me / show us" is a request to the chat ("Show me the tuition amount"), not money to show. */
const SHOW_MONEY = /\b(show(?! (me|us)\b)|showing|shown|prove|proving|dikha\w*|dikhaa\w*|maintain|maintained)\b/;
const FOR_STUDENT_VISA =
  /\b(student visa|study visa|study permit|visa application|visa (ke|kay|k|ki) (liye|liay|lye|lie)|for (the |a |an |my |your )?(\w+ )?(student |study )?visa)\b/;

/** "How much money do I need to show?", "kitne paise dikhane parte hain?", "money for a UK student visa". */
function asksAboutVisaMoney(s: string): boolean {
  if (!MONEY_WORD.test(s)) return false;
  if (SHOW_MONEY.test(s)) return true;
  // "How much money can I earn on a work visa?" is not about the money to show.
  return FOR_STUDENT_VISA.test(s) && !/\b(earn|earning|earnings|salary|salaries|work|working|job|jobs)\b/.test(s);
}

/** English tests and the words students use for them. */
const LANGUAGE_TEST =
  '(ielts|toefl|pte|duolingo|english (language )?(proficiency )?(tests?|requirements?)|english|language tests?|english tests?)';

/** "IELTS waiver", "without IELTS", "MOI", "medium of instruction", "English proficiency letter". */
const LANGUAGE_WAIVER = new RegExp(
  `\\b(moi|medium of instruction|instruction (letter|certificate)|english (proficiency|medium) (letter|certificate)|proficiency letter|taught (entirely |completely |fully )?in english|english medium|${LANGUAGE_TEST} (waiver|waivers|waived|waive|exemption|exemptions|exempt\\w*)|(waive|waiving|waiver (of|for)|exempt\\w* (from|of)|without( an?| the| any)?|no need (of|for)( an?| the)?|skip( the)?) ${LANGUAGE_TEST})\\b`,
);

/** A waiver word anywhere in an English-test question ("Do I need IELTS or is there a waiver?"), but not a fee waiver. */
function asksAboutLanguageWaiver(s: string): boolean {
  return (
    /\b(ielts|toefl|pte|duolingo|english)\b/.test(s) &&
    /\b(waiver|waivers|waive|waived|exempt\w*|exemption|exemptions)\b/.test(s) &&
    !/\b(tuition|fee|fees) (waiver|waivers)\b/.test(s)
  );
}

/**
 * Official routes below the regular minimum: "conditional", "provisional", "low CGPA", "below the minimum",
 * "with 2.5" (the question is normalised, so "2.5" reads "2 5"). The grade words are removed with the match, so
 * a list across every program shows the routes, not every minimum.
 */
const CONDITIONAL_ADMISSION =
  /\b(conditional|conditionally|provisional|provisionally|low (c?gpa|cgpa|grades?|marks|percentage|score)|(below|under|less than|lower than) (the |your |their |a |its )?(minimum|min|required|requirement|requirements)( (c?gpa|cgpa|grade|grades|marks|percentage))?|with (a |an |my )?(c?gpa (of )?2( \d{1,2})?|2 \d{1,2}( out of 4| 4)?( c?gpa| cgpa)?|2 c?gpa))\b/;

/** What a student finishes before the work-after-study rule applies. */
const AFTER_STUDY =
  '(study|studies|studying|graduation|graduating|graduate|masters|master|ms|msc|degree|degrees|course|program|programme|university|uni)';

/** Staying in the country after the course: stay / remain / live / work + after + study (or "after graduation"). */
function asksAboutStayingAfterStudy(s: string): boolean {
  if (/\bafter (my |the |your |our )?(graduation|graduating)\b/.test(s)) return true;
  const stay = /\b(stay|staying|remain|remaining|live|living|work|working)\b(?! (cost|costs|expenses))/.test(s);
  const after = new RegExp(
    `\\b(after (i )?((complete|completing|completed|finish|finishing|finished) )?|(once|when) (i )?(complete|completed|finish|finished) )(my |the |your |our |a )?${AFTER_STUDY}\\b(?! (starts?|begins?))`,
  ).test(s);
  return stay && after;
}

/** A computing first degree ("with a BS Computer Science degree") — the question is who the course is for. */
const COMPUTING_DEGREE =
  /\b(with|have|having|hold|holding|from) (a |an |my )?((bs|bsc|bscs|be|bachelors?|bachelor of science|undergraduate|ug|four year|4 year) )?(degree )?(in )?(cs|computer science|computing|software engineering|information technology)( degree| background)?\b|\b(bscs|bs cs|bsc cs|cs (background|graduate|graduates|degree)|computing (background|graduate|graduates)|non cs|non computing)\b/;

/**
 * Topics MastersPath has NO column for. They are matched first and removed from the text, so
 * "application fee" is not misread as "tuition fee". A question that only asks about these gets "no data".
 */
const UNSUPPORTED_TOPICS: { re: RegExp; topic: string }[] = [
  { re: /\bapplication (fee|fees|charge)\b/, topic: 'application fee' },
  { re: /\bvisa (fee|fees|cost|costs|charge)\b/, topic: 'visa fee' },
  { re: /\b(ihs|immigration health surcharge|health surcharge)\b/, topic: 'health surcharge' },
  // Proof of funds / blocked account are no longer here: the proof_of_funds country fact answers them, and a
  // country without a usable row still gets the code-built "not verified yet" refusal.
  { re: /\b(ranking|rankings|ranked|qs rank|world rank)\b/, topic: 'rankings' },
  { re: /\b(salary|salaries|pay after|how much can i earn)\b/, topic: 'salaries' },
];

/** Ordered: multi-word / specific phrases first. Each match is removed from the text before the next pattern. */
const FIELD_PATTERNS: FieldPattern[] = [
  {
    test: /\b(dual (nationality|citizenship|national|nationals)|two (passports|nationalities)|(keep|give up|lose|renounce|retain) (my )?(pakistani|pakistan)\w*( (nationality|citizenship|passport|passports))?)\b/,
    fields: ['dual_nationality_destination', 'pakistan_dual_nationality'],
  },
  // Money to show for the student visa, before any cost pattern: these never return tuition rows.
  { test: VISA_MONEY_PHRASE, fields: ['proof_of_funds'] },
  {
    test: asksAboutVisaMoney,
    fields: ['proof_of_funds'],
    consumes: /\b(money|funds?|paise|paisay|pese|paisa|raqam|balance|amount|show|showing|shown|prove|proving|dikha\w*|dikhaa\w*|maintain|maintained|student visa|study visa|visa)\b/,
  },
  {
    test: /\b(post study|graduate (visa|route)|pgwp|stem opt|opt|stay back|work permit|work visa|psw)\b/,
    fields: ['post_study_work'],
    consumes: HOW_LONG,
  },
  {
    test: (s) => /\bwork(ing)?\b/.test(s) && /\b(after|graduat\w*|how long|stay)\b/.test(s),
    fields: ['post_study_work'],
    consumes: HOW_LONG,
  },
  // "How long can I stay in Germany after my Masters?", "Can I stay in Canada after my studies?", "after graduation"
  { test: asksAboutStayingAfterStudy, fields: ['post_study_work'], consumes: HOW_LONG },
  // "UK mein parhai ke baad kitna kaam kar sakte hain?"
  { test: asksAboutWorkAfterStudyRomanUrdu, fields: ['post_study_work'], consumes: HOW_LONG },
  {
    test: /\b(permanent residen\w*|permanent resident|pr|settlement|settle|ilr|indefinite leave|green card)\b/,
    fields: ['pr_route'],
    consumes: HOW_LONG,
  },
  {
    test: /\b(citizenship|citizen|citizens|naturali[sz]\w*|nationality)\b/,
    fields: ['citizenship_rule', 'citizenship_update'],
    consumes: HOW_LONG,
  },
  { test: /\bpassports?\b/, fields: ['citizenship_rule', 'citizenship_update'], weak: true },
  {
    test: /\b(deadline|deadlines|last date|closing date|closing|closes|close|due date|apply by|application date|application window|when (can|should|do|must) i apply|when to apply|aa?khi?ri (tareekh|tarikh|tareekh|tareek|date)|kab tak (apply|jama|submit))\b/,
    fields: ['deadline'],
  },
  // English test waivers (before the fee-waiver and English-requirement patterns, which would misread them).
  { test: LANGUAGE_WAIVER, fields: ['language_waiver'] },
  {
    test: asksAboutLanguageWaiver,
    fields: ['language_waiver'],
    consumes: /\b(waiver|waivers|waive|waived|exempt\w*|exemption|exemptions|ielts|toefl|pte|duolingo|english)\b/,
  },
  // Conditional / provisional routes below the regular minimum (before the grade patterns).
  { test: CONDITIONAL_ADMISSION, fields: ['conditional_admission'] },
  // Who the course is for (e.g. a conversion MSc for non-computing graduates), plus the usual requirements.
  // Weak, so "Am I eligible for a scholarship / PR?" stays a scholarship / PR question.
  {
    test: /\b(eligible|eligibility|ineligible|who can apply|who (is|are) (it|this|that|they|the course|the program|the programme|this course|this program|this programme) (for|meant for|aimed at)|conversion)\b/,
    fields: REQUIREMENT_FIELDS,
    weak: true,
  },
  { test: COMPUTING_DEGREE, fields: REQUIREMENT_FIELDS, weak: true },
  { test: /\b(intake|intakes|start date|start dates|starting date|commence\w*)\b/, fields: ['intake'] },
  { test: /\b(start|starts|begin|begins)\b/, fields: ['intake'], weak: true },
  // "100% scholarship", "100 percent tuition waiver": a funding question, not tuition amount or grades.
  {
    test: /\b\d{1,3} ?(%|percent) (\w+ )?(scholarship|scholarships|funding|funded|tuition|fee|fees|waiver|waivers|remission|financial aid|stipend|stipends|bursary|bursaries|fellowship|fellowships|discount)\b/,
    fields: ['scholarship_info'],
  },
  { test: /\b((tuition|fee|fees) )?(waiver|waivers|remission)\b/, fields: ['scholarship_info'] },
  { test: /\b(tuition|fee|fees)\b/, fields: ['tuition'] },
  {
    test: /\b(living|accommodation|rent|housing|hostel|rihaish|rehaish|rehne (ka|ke|ki|kay) (kharcha|kharch|kharchay|kharche|kharchy|jagah))\b/,
    fields: ['living_cost'],
  },
  {
    test: /\b(cost|costs|expensive|how much|afford|budget|kharcha|kharch|kharchay|kharche|kharchy|kitne paise|kitne pese|kitna paisa|kitni raqam)\b/,
    fields: ['tuition', 'living_cost'],
    weak: true,
  },
  { test: /\b(ielts|toefl|pte|duolingo|english|language)\b/, fields: ['language_req'] },
  { test: /\b(c?gpa|grade|grades|marks|division|percentage|percent)\b/, fields: ['min_gpa_rule'] },
  { test: /\b(minimum|min)\b/, fields: ['min_gpa_rule'], weak: true },
  { test: /\b(lor|lors|recommendation|recommendations|reference letters?|referees?|references?)\b/, fields: ['lor_count'] },
  { test: /\b(sop|statement of purpose|personal statement|motivation letter|statement|essay|essays)\b/, fields: ['sop_requirements'] },
  { test: /\b(cv|resume|curriculum vitae)\b/, fields: ['cv_requirements'] },
  { test: /\b(gre|gmat)\b/, fields: ['tests_required'] },
  { test: /\b(test|tests|exam|exams|entrance)\b/, fields: ['tests_required'], weak: true },
  { test: /\b(scholarship|scholarships|funding|funded|financial aid|stipend|daad|fellowship|bursary)\b/, fields: ['scholarship_info'] },
  { test: /\b(duration|how many (years|months)|length|long is|years long|months long)\b/, fields: ['duration_months'] },
  { test: /\bhow long\b/, fields: ['duration_months'], weak: true },
  { test: /\b(research|publication|publications|paper|papers)\b/, fields: ['research_considered'] },
  { test: /\b(progression|progress (to|into|onto))\b/, fields: ['progression_guaranteed', 'progression_requirement'] },
  { test: /\b(email|e mail|contact)\b/, fields: ['admissions_email'] },
  { test: /\b(status|ruled out|accepting|open to pakistan\w*)\b/, fields: ['status_note'] },
  { test: /\b(requirement|requirements|required|criteria|documents|need)\b/, fields: REQUIREMENT_FIELDS, weak: true },
];

/** Lower-case, strip accents (Würzburg -> wurzburg), drop apostrophes, punctuation -> spaces. Keeps '%'. */
export function normalizeQuestion(q: string): string {
  return (
    ' ' +
    q
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9%]+/g, ' ')
      .trim() +
    ' '
  );
}

function blank(s: string, re: RegExp): string {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return s.replace(g, (m) => ' '.repeat(m.length));
}

export interface FieldDetection {
  fields: ChatField[];
  /** A topic MastersPath has no data column for (only set when no supported field was found). */
  unsupportedTopic: string | null;
}

/** Detect which fields a (normalized) question asks about. Order of the result follows FIELD_PATTERNS. */
export function detectFields(normalized: string): FieldDetection {
  let s = normalized;
  let unsupported: string | null = null;
  for (const u of UNSUPPORTED_TOPICS) {
    if (u.re.test(s)) {
      unsupported ??= u.topic;
      s = blank(s, u.re);
    }
  }
  const strong: ChatField[] = [];
  const weak: ChatField[] = [];
  for (const p of FIELD_PATTERNS) {
    const hit = typeof p.test === 'function' ? p.test(s) : p.test.test(s);
    if (!hit) continue;
    (p.weak ? weak : strong).push(...p.fields);
    if (p.test instanceof RegExp) s = blank(s, p.test);
    if (p.consumes) s = blank(s, p.consumes);
  }
  const chosen = strong.length > 0 ? strong : weak;
  const fields = [...new Set(chosen)];
  return { fields, unsupportedTopic: fields.length === 0 ? unsupported : null };
}
