/**
 * "Where you are / next step" cue shown at the top of every screen on the path:
 * Profile → Shortlist → Check a program → Plan B → Costs. Server component; plain links, no JavaScript.
 */
import Link from 'next/link';

export type JourneyStepId = 'profile' | 'shortlist' | 'check' | 'plan-b' | 'costs';

interface Step {
  id: JourneyStepId;
  label: string;
  /** Where the step lives. Null = no page of its own (programs are opened from the shortlist). */
  href: string | null;
  /** Wording of the "Next" line when this is the current step. */
  next: { text: string; href: string | null } | null;
}

export const JOURNEY_STEPS: readonly Step[] = [
  { id: 'profile', label: 'Profile', href: '/onboarding', next: { text: 'See your shortlist', href: '/shortlist' } },
  { id: 'shortlist', label: 'Shortlist', href: '/shortlist', next: { text: 'Open a program to check its requirements', href: null } },
  { id: 'check', label: 'Check', href: null, next: { text: 'See other routes (Plan B)', href: '/plan-b' } },
  { id: 'plan-b', label: 'Plan B', href: '/plan-b', next: { text: 'Compare citizenship rules and costs', href: '/citizenship' } },
  { id: 'costs', label: 'Costs', href: '/citizenship', next: { text: 'Back to your shortlist', href: '/shortlist' } },
];

export function JourneyCue({ current }: { current: JourneyStepId }) {
  const idx = JOURNEY_STEPS.findIndex((s) => s.id === current);
  const step = JOURNEY_STEPS[idx];
  return (
    <nav aria-label="Your journey" className="mb-3" data-journey={current}>
      <ol className="flex w-full items-center text-[0.6875rem] sm:text-xs">
        {JOURNEY_STEPS.map((s, i) => {
          const active = s.id === current;
          const cls = active
            ? 'bg-accent-soft font-bold text-on-accent-soft'
            : 'text-muted' + (s.href ? ' hover:text-ink' : '');
          const inner = (
            <>
              <span aria-hidden="true" className="hidden tabular-nums sm:inline">
                {i + 1}
              </span>
              {s.label}
            </>
          );
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-center justify-center sm:flex-none sm:gap-1">
              {i > 0 ? (
                <span aria-hidden="true" className="hidden text-line-strong sm:inline">
                  ›
                </span>
              ) : null}
              {s.href && !active ? (
                <Link href={s.href} className={`inline-flex min-h-tap w-full items-center justify-center gap-1 rounded-chip px-1 text-center font-semibold no-underline sm:w-auto sm:px-1.5 md:min-h-0 md:py-1 ${cls}`}>
                  {inner}
                </Link>
              ) : (
                <span aria-current={active ? 'step' : undefined} className={`inline-flex min-h-8 w-full items-center justify-center gap-1 rounded-chip px-1 text-center sm:w-auto sm:px-1.5 font-semibold ${cls}`}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {step.next ? (
        <p className="mt-1 text-sm text-muted">
          Next:{' '}
          {step.next.href ? (
            <Link href={step.next.href} className="font-semibold">
              {step.next.text}
              <span aria-hidden="true">&nbsp;→</span>
            </Link>
          ) : (
            <span className="text-ink">{step.next.text}</span>
          )}
        </p>
      ) : null}
    </nav>
  );
}
