/** Builds the "Copy email to admissions" text for a source Conflict. Plain text only. */
import type { SourcedValue } from './types';

export function buildConflictEmail(opts: {
  programName: string;
  institutionName: string;
  fieldLabel: string;
  sources: SourcedValue<unknown>[];
  formatValue: (v: unknown) => string;
  to?: string | null;
}): string {
  const lines = opts.sources.map(
    (s, i) => `  ${i + 1}. "${opts.formatValue(s.value)}" (source: ${s.source_url ?? 'no link'})`,
  );
  return [
    opts.to ? `To: ${opts.to}` : 'To: (admissions office email from the official program page)',
    `Subject: Clarification on ${opts.fieldLabel} for ${opts.programName}`,
    '',
    'Dear Admissions Team,',
    '',
    `I am a prospective applicant from Pakistan interested in ${opts.programName} at ${opts.institutionName}.`,
    `I found different information about the ${opts.fieldLabel.toLowerCase()} on your official pages:`,
    ...lines,
    '',
    `Could you please confirm which ${opts.fieldLabel.toLowerCase()} applies to applicants for the next intake?`,
    '',
    'Thank you for your help.',
    '',
    'Kind regards,',
    '[Your name]',
  ].join('\n');
}
