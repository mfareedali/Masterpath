/**
 * Plain-words glossary (audit proposal #40): what the jargon on our own pages means. Pure data, no imports.
 *
 * MEANINGS ONLY. A definition never states an amount, a date, a duration, a score or a country's requirement: those
 * are facts, and facts live in the evidence rows with their official source. src/lib/glossary.test.ts fails if a
 * definition holds a digit, a number word, a month name, a currency, a URL or chance/guarantee wording.
 * No external links (a link would need a human-checked official page) and no Roman Urdu gloss until a fluent reviewer
 * signs it off. Rendered as plain text by src/app/glossary/page.tsx (one anchor per term).
 */

export const GLOSSARY_GROUPS = [
  { id: 'grades-and-documents', title: 'Grades, documents and recognition' },
  { id: 'tests-and-credits', title: 'Tests and credits' },
  { id: 'offers-and-routes', title: 'Offers and routes into a Masters' },
  { id: 'visas-and-money', title: 'Visas and money' },
  { id: 'after-your-studies', title: 'After your studies' },
] as const;

export type GlossaryGroupId = (typeof GLOSSARY_GROUPS)[number]['id'];

export interface GlossaryEntry {
  /** Anchor on /glossary (lowercase letters, digits and hyphens). */
  id: string;
  /** The word as it appears on our pages. */
  term: string;
  /** What the abbreviation stands for, or the other name it goes by. */
  also?: string;
  group: GlossaryGroupId;
  /** Plain English. Meaning only: no numbers, dates, amounts or requirements. */
  definition: string;
}

export const GLOSSARY = [
  // Grades, documents and recognition
  {
    id: 'cgpa',
    term: 'CGPA',
    also: 'Cumulative Grade Point Average',
    group: 'grades-and-documents',
    definition:
      'The average of all your course grades on a points scale, printed on your transcript. Universities abroad state their minimum on a particular scale, so check which scale they mean before you compare.',
  },
  {
    id: 'percentage-division',
    term: 'Percentage and division',
    group: 'grades-and-documents',
    definition:
      'Some Pakistani degrees show your result as a percentage of total marks, or as a division (first, second or third), instead of a CGPA. A university abroad may state its minimum in either form. Use the form it asks for, and ask the university if you are not sure how your result compares.',
  },
  {
    id: 'hec-attestation',
    term: 'HEC attestation',
    also: 'Higher Education Commission of Pakistan',
    group: 'grades-and-documents',
    definition:
      'The HEC stamp that confirms your degree and transcript are genuine. Universities and visa offices abroad sometimes ask for attested copies; each says whether it needs them.',
  },
  {
    id: 'anabin',
    term: 'anabin',
    group: 'grades-and-documents',
    definition:
      "A German database that lists foreign universities and degrees and how German authorities assess them. A university's entry carries a code such as H+, which shows whether anabin treats it as a recognised higher-education institution. German universities and visa offices may check it.",
  },
  {
    id: 'moi-letter',
    term: 'MOI letter',
    also: 'Medium of Instruction letter',
    group: 'grades-and-documents',
    definition:
      'A letter from your university confirming that your degree was taught in English. Some universities accept it instead of an English test (a language waiver); others do not. Each university decides for itself.',
  },
  {
    id: 'sop',
    term: 'SOP',
    also: 'Statement of Purpose',
    group: 'grades-and-documents',
    definition:
      'An essay in your own words about why you want this program, what you have studied or done so far, and what you plan to do next. Each university says what it should cover and how long it can be.',
  },
  {
    id: 'lor',
    term: 'LOR',
    also: 'Letter of Recommendation, or reference',
    group: 'grades-and-documents',
    definition:
      'A letter from a teacher, supervisor or employer who knows your work, describing your abilities. Universities say how many they want, from whom, and how the letters should be sent.',
  },
  {
    id: 'cv',
    term: 'CV',
    also: 'Curriculum Vitae',
    group: 'grades-and-documents',
    definition:
      'A short summary of your education, work, projects, skills and any publications, usually with the most recent first.',
  },

  // Tests and credits
  {
    id: 'ielts-toefl',
    term: 'IELTS and TOEFL',
    also: 'International English Language Testing System; Test of English as a Foreign Language',
    group: 'tests-and-credits',
    definition:
      'Widely used English language tests. Each university sets its own minimum scores, often for each part (listening, reading, writing and speaking) as well as overall. Some accept other tests, or a waiver instead of a test.',
  },
  {
    id: 'gre',
    term: 'GRE',
    also: 'Graduate Record Examinations',
    group: 'tests-and-credits',
    definition:
      'A general admissions test of verbal, maths and writing skills, used mostly by universities in the United States. Some programs require it, some recommend it, and many do not ask for it.',
  },
  {
    id: 'ects',
    term: 'ECTS',
    also: 'European Credit Transfer and Accumulation System',
    group: 'tests-and-credits',
    definition:
      'The credit points European universities use to measure how much study a course takes. Course pages often give the size of a program, or an entry requirement, in ECTS credits.',
  },

  // Offers and routes into a Masters
  {
    id: 'conditional-admission',
    term: 'Conditional or provisional admission',
    group: 'offers-and-routes',
    definition:
      'An offer that becomes final only after you meet stated conditions, such as reaching a set grade, passing an English test or finishing extra courses. Provisional admission is a similar idea: you are admitted for now and confirmed later. On MastersPath a conditional route is shown as information; it never changes your fit result.',
  },
  {
    id: 'pre-masters',
    term: "Pre-master's",
    group: 'offers-and-routes',
    definition:
      "A preparation course some universities offer to students who do not yet meet a Masters program's entry requirements. Whether and how you move on to the Masters is set by the university's own progression rules.",
  },
  {
    id: 'pathway',
    term: 'Pathway',
    group: 'offers-and-routes',
    definition:
      "A route into a degree through a preparation program, sometimes run by a partner company on or near the university's campus. It is not the same as direct admission to the degree: check the official page for the grades you must reach to move on.",
  },

  // Visas and money
  {
    id: 'cas',
    term: 'CAS',
    also: 'Confirmation of Acceptance for Studies',
    group: 'visas-and-money',
    definition:
      'An electronic reference number that a UK university gives to an international student it has accepted. You need it to apply for a UK Student visa. Each university sets its own dates for issuing it.',
  },
  {
    id: 'pre-cas-interview',
    term: 'Pre-CAS interview',
    group: 'visas-and-money',
    definition:
      'A short interview some UK universities hold before they issue a CAS. It usually asks about your study plans, why you chose the course and the university, and how you will pay. It is separate from any visa interview.',
  },
  {
    id: 'i-20',
    term: 'I-20',
    also: 'Certificate of Eligibility for Nonimmigrant Student Status',
    group: 'visas-and-money',
    definition:
      'A US form that a school issues once it has admitted you as an international student. You need it to apply for a US student visa. It also lists the costs the school expects you to be able to pay.',
  },
  {
    id: 'proof-of-funds',
    term: 'Proof of funds',
    group: 'visas-and-money',
    definition:
      'Evidence, such as bank statements, that you can pay your tuition and living costs. Visa offices ask for it. Each country sets its own amount, what counts as proof and how long the money must be held.',
  },
  {
    id: 'blocked-account',
    term: 'Blocked account',
    also: 'Sperrkonto',
    group: 'visas-and-money',
    definition:
      'A special German bank account. You pay money in before you apply for the visa, and after you arrive you can take out only a set amount each month. It is a common way to show proof of funds for a German student visa.',
  },
  {
    id: 'semester-contribution',
    term: 'Semester contribution',
    also: 'Semesterbeitrag',
    group: 'visas-and-money',
    definition:
      'A fee that German universities charge every semester, separate from tuition. It pays for things like student services; the amount and what it covers are set by each university.',
  },

  // After your studies
  {
    id: 'opt',
    term: 'OPT',
    also: 'Optional Practical Training',
    group: 'after-your-studies',
    definition:
      'US permission for international students to work in their field of study, during or after their degree. How long it can last depends on the official rule and on your degree.',
  },
  {
    id: 'stem',
    term: 'STEM',
    also: 'Science, Technology, Engineering and Mathematics',
    group: 'after-your-studies',
    definition:
      'A group of subjects. In the United States, some work-after-study rules treat degrees on an official STEM list differently. Whether a degree counts is decided by that list, not by the course name alone.',
  },
  {
    id: 'graduate-visa',
    term: 'Graduate visa',
    group: 'after-your-studies',
    definition:
      "The UK's route for staying to work, or to look for work, after you finish an eligible UK degree. How long it lasts and who can apply are set by the UK government and can change.",
  },
  {
    id: 'naturalisation',
    term: 'Naturalisation',
    group: 'after-your-studies',
    definition:
      'Becoming a citizen of a country after living there legally for a required time and meeting its other conditions. Each country sets its own rules, including whether your years as a student count.',
  },
] as const satisfies readonly GlossaryEntry[];

export type GlossaryId = (typeof GLOSSARY)[number]['id'];

/** Internal link to one term, e.g. glossaryHref('cas') -> '/glossary#cas'. Typed so a wrong id fails to compile. */
export function glossaryHref(id: GlossaryId): string {
  return `/glossary#${id}`;
}

/** Entries of one group, in the order above. */
export function glossaryEntriesIn(group: GlossaryGroupId): readonly GlossaryEntry[] {
  return GLOSSARY.filter((e) => e.group === group);
}
