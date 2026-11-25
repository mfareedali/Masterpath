/**
 * "Ask the university": a plain-text email of neutral QUESTIONS for every applicable fact we could not verify.
 * Pure. The text never contains a value from the data (no number, date, fee or requirement): only fixed questions,
 * the program and university names, and the admissions address when that address is itself usable
 * (Verified/Likely). Otherwise a placeholder tells the student where to find the address.
 */
import { computeConfidence, usableValue } from '@/lib/confidence';
import type { Fact, Program } from '@/lib/types';
import { applicableFactKeys, FACT_LABEL, type ProgramFactKey } from './fields';

/**
 * Fixed, neutral questions (they complete "Could you please tell me:"). null = never asked:
 *  - status_note is our own note about the program, not a question for the university;
 *  - admissions_email: the student is already writing to the admissions office.
 */
export const QUESTION_FOR: Record<ProgramFactKey, string | null> = {
  status_note: null,
  eligibility_note: 'which bachelor’s degree subjects the programme accepts',
  intake: 'when the programme starts (which intake or semester)',
  deadline: 'the application deadline for international applicants for the next intake',
  duration_months: 'how long the programme takes to complete',
  tuition: 'the tuition fee for international students, and whether it is per year or for the whole programme',
  living_cost: 'the living costs you advise international students to plan for',
  scholarship_info: 'which scholarships or fee reductions international students can apply for',
  min_gpa_rule:
    'the minimum grade you require from applicants with a Pakistani bachelor’s degree, and on which grading scale (CGPA out of 4.0, or percentage)',
  conditional_admission:
    'whether there is a conditional or provisional admission route for applicants below the regular minimum grade, and what it requires',
  language_req: 'the English test scores you accept (for example IELTS or TOEFL)',
  language_waiver:
    'whether the English test can be waived for a bachelor’s degree from Pakistan that was taught in English, and which document you need for that',
  tests_required: 'whether the GRE or any other test is required',
  sop_requirements: 'what the statement of purpose should cover, and whether there is a length limit',
  lor_count: 'how many letters of recommendation are required, and from whom',
  cv_requirements: 'whether a CV is required, and in what format',
  research_considered: 'whether research experience or publications are considered in the admission decision',
  progression_guaranteed: 'whether progression from the preparation stage to the Master’s is guaranteed',
  progression_requirement: 'what is required to progress from the preparation stage to the Master’s',
  admissions_email: null,
};

/** Always asked: the page's checklist has no data row for transcripts, so this item is always "not verified yet". */
export const TRANSCRIPT_QUESTION = 'how to send transcripts and degree documents, and whether attested copies are needed';

export interface AskQuestion {
  key: ProgramFactKey | 'transcript';
  label: string;
  question: string;
}

/**
 * Questions for every applicable fact that is Not verified yet (Unverified: no value, or a value with no evidence),
 * in page order, plus the transcript question. Conflicts are not here: they have their own "Copy email to
 * admissions" with both sources.
 */
export function missingFactQuestions(p: Program, now: Date): AskQuestion[] {
  const out: AskQuestion[] = [];
  for (const key of applicableFactKeys(p)) {
    const question = QUESTION_FOR[key];
    if (!question) continue;
    if (computeConfidence(p[key] as Fact<unknown> | null | undefined, now) !== 'Unverified') continue;
    out.push({ key, label: FACT_LABEL[key], question });
  }
  out.push({ key: 'transcript', label: 'Transcript and degree documents', question: TRANSCRIPT_QUESTION });
  return out;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[A-Za-z]{2,}$/;

/** The admissions address only when its fact is usable AND it looks like a plain email address; else null. */
export function usableAdmissionsEmail(p: Program, now: Date): string | null {
  const v = usableValue(p.admissions_email, now);
  const s = typeof v === 'string' ? v.trim() : '';
  return EMAIL.test(s) ? s : null;
}

export const TO_PLACEHOLDER = '(admissions office email from the official program page)';

export interface AskEmail {
  /** Usable admissions address, or null (the text then shows TO_PLACEHOLDER). */
  to: string | null;
  subject: string;
  /** Body only (no To/Subject lines), for mailto. */
  body: string;
  /** Full text for the copy button: To, Subject, then the body. */
  text: string;
}

export function buildAskUniversityEmail(opts: {
  programName: string;
  institutionName: string;
  questions: readonly AskQuestion[];
  to?: string | null;
}): AskEmail {
  const subject = `Questions about ${opts.programName} from an applicant in Pakistan`;
  const body = [
    'Dear Admissions Team,',
    '',
    `I am a prospective applicant from Pakistan interested in ${opts.programName} at ${opts.institutionName}.`,
    'I could not find the following information on your official pages. Could you please tell me:',
    ...opts.questions.map((q, i) => `  ${i + 1}. ${q.question}?`),
    '',
    'Thank you for your help.',
    '',
    'Kind regards,',
    '[Your name]',
  ].join('\n');
  const to = opts.to?.trim() ? opts.to.trim() : null;
  const text = [`To: ${to ?? TO_PLACEHOLDER}`, `Subject: ${subject}`, '', body].join('\n');
  return { to, subject, body, text };
}

/** "mailto:" link with the subject and body, only for a usable address; null otherwise. Line breaks become CRLF. */
export function askUniversityMailto(email: AskEmail): string | null {
  if (!email.to || !EMAIL.test(email.to)) return null;
  const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, '\r\n'));
  return `mailto:${encodeURIComponent(email.to).replace(/%40/g, '@')}?subject=${enc(email.subject)}&body=${enc(email.body)}`;
}
