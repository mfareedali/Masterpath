/**
 * Home shortcut tiles (bento grid) and the "How MastersPath works" steps. Server components, plain links.
 * The tile illustrations are decorative (aria-hidden) and carry no data: no numbers, no country names.
 */
import { BentoCard, BentoGrid, type BentoSpan } from '@/components/ui/bento';

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/* ---------------------------------------------------------------- visuals (decorative) */

function RouteVisual() {
  const step = 'rounded-chip border px-3 py-1 text-xs font-semibold whitespace-nowrap';
  return (
    <div className="flex w-full items-center justify-center gap-1.5 py-2">
      <span className={`${step} border-line bg-page text-muted`}>Your grade</span>
      <span className="h-px w-5 shrink border-t border-dashed border-line-strong sm:w-8" />
      <span className={`${step} border-primary bg-surface text-primary-ink`}>Pre-master’s</span>
      <span className="h-px w-5 shrink border-t border-dashed border-line-strong sm:w-8" />
      <span className={`${step} border-chrome bg-chrome text-on-chrome`}>Master’s</span>
    </div>
  );
}

function CompareVisual() {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-button border border-line bg-page px-2.5 py-1.5">
        <span className="text-[11px] font-semibold text-muted">Agent</span>
        <span className="h-1.5 flex-1 rounded-chip bg-stone-300" />
      </div>
      <div className="flex items-center justify-center text-xs font-bold text-conflict-fg">≠</div>
      <div className="flex items-center gap-2 rounded-button border-l-[3px] border-evidence-bar bg-evidence-bg px-2.5 py-1.5">
        <span className="text-[11px] font-semibold text-verified-fg">Official</span>
        <span className="h-1.5 flex-1 rounded-chip bg-evidence-bar/50" />
      </div>
    </div>
  );
}

function BarsVisual() {
  const heights = ['h-6', 'h-10', 'h-8', 'h-12', 'h-7'];
  return (
    <div className="flex h-14 items-end gap-2">
      {heights.map((h, i) => (
        <span key={i} className={`w-4 rounded-t-badge ${h} ${i === 3 ? 'bg-primary' : 'bg-surface-tint'}`} />
      ))}
    </div>
  );
}

function ChatVisual() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-1.5">
      <span className="ml-auto block h-6 w-2/3 rounded-card rounded-br-badge bg-chrome" />
      <span className="flex items-center gap-2 rounded-card rounded-bl-badge border border-line bg-page px-3 py-2">
        <span className="h-1.5 flex-1 rounded-chip bg-stone-300" />
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-evidence-bg text-evidence-bar">
          <svg {...svg} className="h-2.5 w-2.5" strokeWidth={3}>
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </span>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- icons (decorative) */

const ICONS = {
  route: (
    <svg {...svg}>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h6" />
    </svg>
  ),
  check: (
    <svg {...svg}>
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </svg>
  ),
  globe: (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  chat: (
    <svg {...svg}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  ),
} as const;

export const SHORTCUTS = [
  {
    href: '/plan-b',
    title: 'Plan B',
    text: 'Other routes when a program’s minimum is above your grade: pre-master’s, pathways and research-led options.',
    icon: ICONS.route,
    visual: <RouteVisual />,
    span: 2,
  },
  {
    href: '/check',
    title: 'Consultant Check',
    text: 'Paste what an agent or consultant told you. We compare it with the official pages.',
    icon: ICONS.check,
    visual: <CompareVisual />,
    span: 1,
  },
  {
    href: '/citizenship',
    title: 'Citizenship and cost',
    text: 'Compare study costs, work after study and citizenship rules by country, with sources.',
    icon: ICONS.globe,
    visual: <BarsVisual />,
    span: 1,
  },
  {
    href: '/ask',
    title: 'Ask',
    text: 'Ask a question in plain words. Answers come only from our sourced data, with links.',
    icon: ICONS.chat,
    visual: <ChatVisual />,
    span: 2,
  },
] as const satisfies readonly {
  href: string;
  title: string;
  text: string;
  icon: React.ReactNode;
  visual: React.ReactNode;
  span: BentoSpan;
}[];

export function ShortcutCards() {
  return (
    <BentoGrid columns={3}>
      {SHORTCUTS.map((s, i) => (
        <BentoCard
          key={s.href}
          index={i}
          href={s.href}
          title={s.title}
          description={s.text}
          icon={s.icon}
          visual={s.visual}
          cta="Open"
          srLabel={s.title}
          colSpan={s.span}
        />
      ))}
    </BentoGrid>
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

/** Numbered steps joined by a rail: vertical on phones, horizontal from md. */
export function HowItWorksList() {
  return (
    <ol className="relative grid gap-4 md:grid-cols-4 md:gap-3">
      <span aria-hidden="true" className="absolute bottom-4 left-4 top-4 w-px bg-line md:hidden" />
      <span aria-hidden="true" className="absolute left-4 right-4 top-4 hidden h-px bg-line md:block" />
      {HOW_IT_WORKS.map((item, i) => (
        <li key={item.title} className="relative flex gap-3 md:flex-col md:gap-2">
          <span
            aria-hidden="true"
            className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-chip border border-primary bg-surface font-bold text-primary-ink"
          >
            {i + 1}
          </span>
          <span className="rounded-card border border-line bg-surface p-4 md:flex-1">
            <span className="block font-bold text-heading">{item.title}</span>
            <span className="mt-0.5 block text-sm text-muted">{item.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
