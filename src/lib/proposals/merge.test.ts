import { describe, expect, it } from 'vitest';
import { mergeProposals, type Proposal, type SeedBundle } from './merge';

const empty = { value: null, source_url: null, evidence_snippet: null, fetched_at: null };
function bundle(): SeedBundle {
  return {
    programs: { institutions: [], programs: [] },
    countryFacts: { country_facts: [] },
    conversionRules: { conversion_rules: [] },
    fxRates: { fx_rates: [{ id: 'eur-pkr', currency: 'EUR', pkr_per_unit: { ...empty } }] },
  };
}
const fx = (over: Partial<Proposal> = {}): Proposal => ({
  target: 'fx_rate',
  id: 'eur-pkr',
  field: 'pkr_per_unit',
  value: 303.1114,
  source_url: 'https://www.sbp.org.pk/assets/document/x.pdf',
  evidence_snippet: 'EUR 303.1114',
  fetched_at: '2026-11-27',
  review: { verdict: 'accept' },
  ...over,
});

describe('mergeProposals: fx_rate', () => {
  it('fills an empty rate with its evidence', () => {
    const { seed, changes } = mergeProposals(bundle(), [{ proposals: [fx()] }], '2026-11-27');
    expect(changes[0].kind).toBe('filled');
    expect(seed.fxRates!.fx_rates[0].pkr_per_unit).toMatchObject({ value: 303.1114, evidence_snippet: 'EUR 303.1114' });
  });

  it('skips non-positive values, wrong fields, unknown ids and unaccepted reviews', () => {
    const kinds = [fx({ value: -1 }), fx({ field: 'value' }), fx({ id: 'xxx-pkr' }), fx({ review: { verdict: 'reject' } })].map(
      (p) => mergeProposals(bundle(), [{ proposals: [p] }], '2026-11-27').changes[0].kind,
    );
    expect(kinds).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
  });
});
