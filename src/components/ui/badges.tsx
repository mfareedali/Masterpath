import type { Confidence, FitLabel } from '@/lib/types';
import { CONFIDENCE_HELP } from '@/lib/confidence';

const CONF_CLASS: Record<Confidence, string> = {
  Verified: 'bg-verified-bg text-verified-fg',
  Likely: 'bg-likely-bg text-likely-fg',
  Unverified: 'bg-unverified-bg text-unverified-fg',
  Conflict: 'bg-conflict-bg text-conflict-fg',
};

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 16 16',
  className: 'h-3.5 w-3.5 shrink-0',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Icon + label so status never depends on colour alone. */
function ConfIcon({ confidence }: { confidence: Confidence }) {
  switch (confidence) {
    case 'Verified':
      return (
        <svg {...iconProps}>
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      );
    case 'Conflict':
      return (
        <svg {...iconProps}>
          <path d="M8 2.5l6 11H2z" />
          <path d="M8 6.8v3M8 12h.01" />
        </svg>
      );
    case 'Likely':
      return (
        <span aria-hidden="true" className="font-bold">
          ~
        </span>
      );
    case 'Unverified':
      return (
        <span aria-hidden="true" className="font-bold">
          ?
        </span>
      );
  }
}

const base =
  'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap align-middle';

export function ConfidenceBadge({ confidence, className = '' }: { confidence: Confidence; className?: string }) {
  return (
    <span className={`${base} ${CONF_CLASS[confidence]} ${className}`} title={CONFIDENCE_HELP[confidence]}>
      <ConfIcon confidence={confidence} />
      {confidence}
    </span>
  );
}

/** Integrity gate hard block. Dashed border + text + icon, distinct from every other badge. */
export function BlockedBadge({ children = 'Blocked', className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={`${base} border border-dashed border-blocked-fg bg-surface text-blocked-fg ${className}`}>
      <svg {...iconProps}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M4.2 11.8l7.6-7.6" />
      </svg>
      {children}
    </span>
  );
}

const FIT_CLASS: Record<FitLabel, string> = {
  'Meets minimum': 'bg-fit-meets-bg text-fit-meets-fg border border-fit-meets-bg',
  'Competitive range unknown': 'bg-fit-unknown-bg text-fit-unknown-fg border-[1.5px] border-fit-unknown-border',
  'Below minimum': 'bg-fit-below-bg text-fit-below-fg border border-fit-below-bg',
};

const FIT_GLYPH: Record<FitLabel, string> = {
  'Meets minimum': '●',
  'Competitive range unknown': '◐',
  'Below minimum': '○',
};

/** Fit label. Never a probability. */
export function FitBadge({ label, className = '' }: { label: FitLabel; className?: string }) {
  return (
    <span className={`${base} rounded-chip px-3 py-1 text-[0.8125rem] ${FIT_CLASS[label]} ${className}`}>
      <span aria-hidden="true">{FIT_GLYPH[label]}</span>
      {label}
    </span>
  );
}

/** Rank number badge (olive-600, white text). */
export function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className="inline-flex h-7 min-w-7 items-center justify-center rounded-chip bg-accent px-2 text-sm font-semibold text-on-accent"
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  );
}

/** Neutral pill for secondary info (country, intake…). */
export function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`${base} border border-line bg-surface text-muted ${className}`}>{children}</span>;
}
