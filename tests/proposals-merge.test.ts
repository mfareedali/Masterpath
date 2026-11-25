import { describe, expect, it } from 'vitest';
import { computeConfidence } from '@/lib/confidence';
import { mergeProposals, reviewMarkdown, type Proposal, type SeedBundle } from '@/lib/proposals/merge';
import { emptyFact } from '@/lib/confidence';
import type { Fact } from '@/lib/types';

const NOW = new Date('2026-11-24T12:00:00Z');

function seed(): SeedBundle {
  return {
    programs: {
      institutions: [{ id: 'fx-uni', recognition_list_status: emptyFact(), hec_status: emptyFact(), pqr_status: emptyFact(), anabin_status: emptyFact() }],
      programs: [{ id: 'fx-msc', official_url: null, last_checked: null, deadline: emptyFact(), tuition: emptyFact() }],
    },
    countryFacts: {
      country_facts: [
        { id: 'fx-cit', country: 'CA', key: 'citizenship_rule', value: { text: 'Old summary', sort_months: 36 }, source_url: 'https://gov.example/a', evidence_snippet: null, fetched_at: '2026-11-23', basis: 'summary', note: 'x' },
      ],
    },
    conversionRules: { conversion_rules: [{ id: 'fx-rule', source_url: null, evidence_snippet: null, fetched_at: null }] },
  };
}

const P = (o: Partial<Proposal>): Proposal => ({
  target: 'program', id: 'fx-msc', field: 'deadline', value: '2027-01-15',
  source_url: 'https://fixture.example.edu/apply', evidence_snippet: 'The deadline is 15 January 2027 for all applicants.',
  fetched_at: '2026-11-24', review: { verdict: 'accept' }, ...o,
});

describe('mergeProposals', () => {
  it('fills an empty fact and the result is Verified', () => {
    const { seed: s, changes } = mergeProposals(seed(), [{ proposals: [P({})] }], '2026-11-24');
    const fact = s.programs.programs[0].deadline as Fact<string>;
    expect(changes[0].kind).toBe('filled');
    expect(fact.value).toBe('2027-01-15');
    expect(computeConfidence(fact, NOW)).toBe('Verified');
    expect(s.programs.programs[0].last_checked).toBe('2026-11-24');
  });

  it('a different value from a different official page becomes a Conflict', () => {
    const { seed: s, changes } = mergeProposals(
      seed(),
      [{ proposals: [P({}), P({ value: '2027-02-01', source_url: 'https://fixture.example.edu/other', evidence_snippet: 'Applications close on 1 February 2027.' })] }],
      '2026-11-24',
    );
    expect(changes.map((c) => c.kind)).toEqual(['filled', 'conflict_added']);
    expect(computeConfidence(s.programs.programs[0].deadline as Fact<string>, NOW)).toBe('Conflict');
  });

  it('upgrades a Likely summary country fact to Verified when the same value gets a verbatim snippet', () => {
    const { seed: s } = mergeProposals(
      seed(),
      [{ proposals: [P({ target: 'country_fact', id: 'fx-cit', field: 'value', value: { text: 'Old summary', sort_months: 36 }, source_url: 'https://gov.example/b', evidence_snippet: 'You must be physically present for 1,095 days.' })] }],
      '2026-11-24',
    );
    const f = s.countryFacts.country_facts[0] as unknown as Fact<unknown>;
    expect(f.basis).toBeUndefined();
    expect(computeConfidence(f, NOW)).toBe('Verified');
  });

  it('a sourced proposal replaces an unsourced placeholder instead of creating a fake Conflict', () => {
    const s0 = seed();
    s0.programs.programs[0].deadline = { value: '2027-03-01', source_url: null, evidence_snippet: null, fetched_at: null, note: 'reported' };
    const { seed: s, changes } = mergeProposals(s0, [{ proposals: [P({})] }], '2026-11-24');
    expect(changes[0].kind).toBe('filled');
    const fact = s.programs.programs[0].deadline as Fact<string>;
    expect(fact.value).toBe('2027-01-15');
    expect(fact.conflicts).toBeUndefined();
    expect(computeConfidence(fact, NOW)).toBe('Verified');
  });

  it('skips rejected, non-https, short-snippet and unknown-id proposals', () => {
    const { changes } = mergeProposals(
      seed(),
      [{ proposals: [
        P({ review: { verdict: 'reject' } }),
        P({ source_url: 'http://insecure.example.edu' }),
        P({ evidence_snippet: 'short' }),
        P({ id: 'nope' }),
        P({ field: 'admission_chance' }),
      ] }],
      '2026-11-24',
    );
    expect(changes.every((c) => c.kind === 'skipped')).toBe(true);
  });

  it('sets official_url and conversion rule sources', () => {
    const { seed: s } = mergeProposals(
      seed(),
      [{ proposals: [
        P({ field: 'official_url', value: 'https://fixture.example.edu/msc' }),
        P({ target: 'conversion_rule', id: 'fx-rule', field: 'source', value: 'formula', source_url: 'https://kmk.example/formula', evidence_snippet: 'Nd = 1 + 3 (Nmax - Nd) / (Nmax - Nmin)' }),
      ] }],
      '2026-11-24',
    );
    expect(s.programs.programs[0].official_url).toBe('https://fixture.example.edu/msc');
    expect(s.conversionRules.conversion_rules[0].source_url).toBe('https://kmk.example/formula');
  });

  it('review markdown lists applied changes with checkboxes', () => {
    const { changes } = mergeProposals(seed(), [{ proposals: [P({})] }], '2026-11-24');
    const md = reviewMarkdown(changes, '2026-11-24');
    expect(md).toContain('| [ ] | filled | program:fx-msc | deadline |');
    expect(md).toContain('Reviewer notes');
  });
});
