/** Home shortcut cards and the "How MastersPath works" list. Server components, plain links. */
import Link from 'next/link';

export const SHORTCUTS = [
  {
    href: '/plan-b',
    title: 'Plan B',
    text: 'Other routes when a program’s minimum is above your grade: pre-master’s, pathways and research-led options.',
  },
  {
    href: '/check',
    title: 'Consultant Check',
    text: 'Paste what an agent or consultant told you. We compare it with the official pages.',
  },
  {
    href: '/citizenship',
    title: 'Citizenship and cost',
    text: 'Compare study costs, work after study and citizenship rules by country, with sources.',
  },
  {
    href: '/ask',
    title: 'Ask',
    text: 'Ask a question in plain words. Answers come only from our sourced data, with links.',
  },
] as const;

export function ShortcutCards() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {SHORTCUTS.map((s) => (
        <li key={s.href}>
          <Link
            href={s.href}
            className="group flex h-full min-h-tap items-start justify-between gap-3 rounded-card border border-line bg-surface p-4 text-ink no-underline shadow-card transition-colors hover:border-primary"
          >
            <span>
              <span className="block text-lg font-bold text-heading group-hover:underline">{s.title}</span>
              <span className="mt-1 block text-sm text-muted">{s.text}</span>
            </span>
            <span aria-hidden="true" className="mt-1 text-lg font-bold text-primary-ink">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export const HOW_IT_WORKS = [
  {
    title: 'Evidence first',
    text: 'Every value links to the official page and shows when it was checked. Missing data says “Not verified yet”.',
  },
  {
    title: 'Code decides',
    text: 'Ranking, fit, deadlines and cost are plain code over the data rows. The AI only explains; it never decides.',
  },
  {
    title: 'No percentages',
    text: 'We never show admission chances. You see “Meets minimum”, “Below minimum” or “Competitive range unknown”.',
  },
  {
    title: 'Open source',
    text: 'Free, MIT-licensed, and anyone can add or fix data, as long as it comes with an official source.',
  },
] as const;

export function HowItWorksList() {
  return (
    <ol className="grid gap-3 sm:grid-cols-2">
      {HOW_IT_WORKS.map((item, i) => (
        <li key={item.title} className="flex gap-3 rounded-card border border-line bg-surface p-4">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-surface-tint font-bold text-primary-ink"
          >
            {i + 1}
          </span>
          <span>
            <span className="block font-bold text-heading">{item.title}</span>
            <span className="mt-0.5 block text-sm text-muted">{item.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
