/**
 * "Rank by" and order chips. Plain links (server-rendered, work without JS); state lives in the URL.
 */
import { RANK_OPTIONS, citizenshipHref, rankOption, type CitizenshipQuery } from '@/lib/citizenship';
import { ChipLink, ChipRow } from '@/components/ui/chip';

const DIR_GLYPH = { asc: '↑', desc: '↓' } as const;

export function RankControls({ query }: { query: CitizenshipQuery }) {
  const opt = rankOption(query.rank);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-muted">Rank by</p>
      <ChipRow label="Rank by">
        {RANK_OPTIONS.map((o) => (
          <ChipLink key={o.key} href={citizenshipHref({ rank: o.key })} active={o.key === query.rank} scroll={false}>
            {o.label}
          </ChipLink>
        ))}
      </ChipRow>
      <ChipRow label="Order">
        {(['asc', 'desc'] as const).map((d) => (
          <ChipLink key={d} href={citizenshipHref({ rank: query.rank, dir: d })} active={d === query.dir} scroll={false}>
            <span aria-hidden="true">{DIR_GLYPH[d]}</span>
            {opt.dirLabels[d]}
          </ChipLink>
        ))}
      </ChipRow>
    </div>
  );
}
