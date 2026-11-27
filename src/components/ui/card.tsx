import type { ComponentProps } from 'react';
import { JourneyCue, type JourneyStepId } from './journey';

export function Card({ className = '', ...rest }: ComponentProps<'div'>) {
  return <div className={`rounded-card border border-line bg-surface p-4 shadow-card ${className}`} {...rest} />;
}

/** Call-out. accent = olive bar on olive tint (key call-outs, sparingly); warning = Conflict colours; neutral = stone. */
export function Callout({
  title,
  children,
  tone = 'accent',
  className = '',
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'accent' | 'warning' | 'neutral';
  className?: string;
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-l-4 border-conflict-fg bg-conflict-bg text-ink'
      : tone === 'neutral'
        ? 'border-l-4 border-line-strong bg-page text-ink'
        : 'border-l-4 border-accent bg-accent-soft text-ink';
  return (
    <div className={`rounded-card p-4 ${toneClass} ${className}`} role={tone === 'warning' ? 'note' : undefined}>
      {title ? <p className="mb-1 font-bold text-heading">{title}</p> : null}
      <div className="text-sm">{children}</div>
    </div>
  );
}

/**
 * The one page header: where you are (step), title, one-line purpose, primary action, then any extras (children).
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  step,
  action,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** Small label above the title. */
  eyebrow?: React.ReactNode;
  /** Highlights this screen in the journey cue (Profile → Shortlist → Check → Plan B → Costs). */
  step?: JourneyStepId;
  /** The primary action of the page, shown under the purpose line. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-4">
      {step ? <JourneyCue current={step} /> : null}
      {eyebrow ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary-ink">{eyebrow}</p> : null}
      <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
      {children}
    </header>
  );
}

/** Section heading with an optional eyebrow and intro, used on Home and the shortlist. */
export function SectionHeading({
  id,
  title,
  eyebrow,
  intro,
  action,
}: {
  id: string;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  intro?: React.ReactNode;
  /** Right-aligned link, e.g. "Read how it works →". */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary-ink">{eyebrow}</p> : null}
        <h2 id={id} className="text-xl font-bold md:text-2xl">
          {title}
        </h2>
        {intro ? <p className="mt-1 max-w-2xl text-sm text-muted">{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** Skeleton for a list of cards (use in loading.tsx). */
export function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-4">
          <Skeleton className="mb-3 h-5 w-2/3" />
          <Skeleton className="mb-2 h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ))}
    </div>
  );
}
