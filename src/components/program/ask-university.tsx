/**
 * "Ask the university" (server component): what we could not verify, as neutral questions in a ready email.
 * The email contains questions only, never a value from this page. The mail-app link appears only when the
 * admissions address itself is usable (Verified/Likely); otherwise the copied text has a placeholder address.
 */
import { CopyButton } from '@/components/ui/copy-button';
import { askUniversityMailto, buildAskUniversityEmail, type AskQuestion } from '@/lib/program/ask-university';
import { Section } from './fact-section';

export function AskUniversity({
  programName,
  institutionName,
  questions,
  admissionsEmail,
}: {
  programName: string;
  institutionName: string;
  questions: readonly AskQuestion[];
  /** Usable admissions address (see usableAdmissionsEmail), or null. */
  admissionsEmail: string | null;
}) {
  if (questions.length === 0) return null;
  const email = buildAskUniversityEmail({ programName, institutionName, questions, to: admissionsEmail });
  const mailto = askUniversityMailto(email);
  return (
    <Section
      id="ask-university"
      title="Ask the university"
      intro="We could not verify these on the official pages yet. This email only asks questions; it does not repeat anything from this page."
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
        {questions.map((q) => (
          <li key={q.key}>{q.label}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <CopyButton label="Copy email to the university" copiedLabel="Email copied" text={email.text} />
        {mailto ? (
          <a href={mailto} className="inline-flex min-h-tap items-center font-semibold text-primary-ink">
            Open in my email app
          </a>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted">
        {mailto
          ? `It goes to ${email.to}, the address on the official page. Add your name before you send it.`
          : 'We have no verified admissions address yet. Find it on the official page, then add your name before you send it.'}
      </p>
    </Section>
  );
}
