/**
 * Home FAQ: native <details> accordion (works without JS, keyboard and screen-reader friendly).
 * No FAQPage JSON-LD: it would need dangerouslySetInnerHTML, which product rule 9 forbids.
 * Answers describe how the product behaves; they must stay true to the code (see DECISIONS.md).
 */
import { VERIFIED_MAX_AGE_DAYS } from '@/lib/confidence';

export const FAQ = [
  {
    q: 'Is MastersPath really free?',
    a: 'Yes. It is free and open source under the MIT licence, built so you can plan without paying a consultant.',
  },
  {
    q: 'Will you tell me my chance of admission?',
    a: 'No. Nobody outside the admissions office knows that. We compare your grade with the minimum each university publishes and show “Meets minimum”, “Below minimum” or “Competitive range unknown”. We never show a percentage.',
  },
  {
    q: 'Where does the information come from?',
    a: `From the universities’ and governments’ own pages. Every value shows the official link, the exact quote and the date we checked it. A value is “Verified” only when it was copied from an official page in the last ${VERIFIED_MAX_AGE_DAYS} days.`,
  },
  {
    q: 'What happens when something is missing?',
    a: 'It says “Not verified yet” with a link to the official page. We never guess, and a program with a missing value is listed under “Not ranked” instead of being treated as zero.',
  },
  {
    q: 'Do I need an account, my passport or my ID number?',
    a: 'No. Every feature works without an account: what you type stays in this browser. We never ask for a passport or ID number. See the privacy page for the optional account.',
  },
  {
    q: 'Does the AI decide anything?',
    a: 'No. Fit, ranking, deadlines and cost are plain code over the data. The chat only explains rows from our database, with links, and says so when we hold no verified answer.',
  },
  {
    q: 'My consultant told me something different. Who is right?',
    a: 'Paste their message into Consultant Check. It compares each claim with the official pages and gives you questions to ask them in writing.',
  },
  {
    q: 'I found a mistake. How do I fix it?',
    a: 'Every program page has “Report a mistake”. Anyone can also add or correct data in the open-source repository, as long as it comes with an official source.',
  },
] as const;

export function FaqList() {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {FAQ.map((f) => (
        <details key={f.q} className="faq group">
          <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 font-semibold text-heading transition-colors hover:bg-page md:px-5 [&::-webkit-details-marker]:hidden">
            <span>{f.q}</span>
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-chip border border-line bg-page text-primary-ink transition-transform duration-200 group-open:rotate-45"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </span>
          </summary>
          <p className="px-4 pb-4 text-sm text-ink md:px-5">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
