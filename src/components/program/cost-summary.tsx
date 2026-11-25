import { ConfidenceBadge } from '@/components/ui/badges';
import { NotVerified } from '@/components/ui/fact';
import type { CostResult } from '@/lib/cost';
import { formatMoney, formatPkr } from '@/lib/format';
import { Section } from './fact-section';

/**
 * Plain-text caveats about the total (e.g. a fee that covers the first year only), computed in src/lib/cost.ts.
 * Read defensively: strings, or objects with a string `text`; anything else is ignored.
 */
export function costCaveats(cost: CostResult): string[] {
  const raw = (cost as CostResult & { caveats?: unknown }).caveats;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw as unknown[]) {
    const text =
      typeof c === 'string' ? c : c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '';
    if (text.trim() && !out.includes(text.trim())) out.push(text.trim());
  }
  return out;
}

/** Total cost line from programTotalCost(): native currency and PKR when possible, otherwise what is missing. */
export function CostSummary({ cost, officialUrl }: { cost: CostResult; officialUrl: string | null }) {
  const hasAny = cost.native != null || cost.pkr != null;
  const caveats = costCaveats(cost);
  return (
    <Section
      id="cost"
      title="Total cost"
      intro="Tuition plus living cost for the whole program, worked out from the facts on this page. Visa, travel and insurance are not included."
    >
      {hasAny ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-heading">
              {cost.native ? formatMoney({ amount: cost.native.amount, currency: cost.native.currency, period: 'total' }) : 'Costs are in different currencies'}
            </p>
            <ConfidenceBadge confidence={cost.confidence} />
          </div>
          <p className="text-base text-ink">
            {cost.pkr != null ? (
              <>
                About <strong>{formatPkr(cost.pkr)}</strong>
              </>
            ) : (
              <span className="text-muted">In PKR: not verified yet</span>
            )}
          </p>
        </div>
      ) : (
        <p className="text-base">
          <NotVerified officialUrl={officialUrl} />
        </p>
      )}
      {cost.missing.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {cost.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {caveats.length ? (
        <ul className="mt-2 space-y-1 text-sm text-muted" aria-label="About this total">
          {caveats.map((c) => (
            <li key={c}>Note: {c}</li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
