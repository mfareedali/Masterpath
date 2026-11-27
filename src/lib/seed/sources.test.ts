import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  emptyState,
  groupByTarget,
  hashText,
  selectPages,
  validateSources,
  type SeedIds,
  type SourcesFile,
} from './sources';

const SEED: SeedIds = {
  programs: new Map([
    ['tum-msc-informatics', { country: 'DE', institution_id: 'tum' }],
    ['imperial-msc-computing', { country: 'UK', institution_id: 'imperial' }],
  ]),
  institutions: new Map([['tum', { country: 'DE' }]]),
  conversionRules: new Set(['de-modified-bavarian']),
  fxCurrencies: new Set(['EUR', 'USD']),
  countries: new Set(['DE', 'UK']),
};
const ALLOW = ['tum.de', 'imperial.ac.uk', 'sbp.org.pk', 'gov.uk'];

function file(pages: SourcesFile['pages']): SourcesFile {
  return { version: 1, pages };
}

const GOOD = file([
  { id: 'tum-info-main', url: 'https://www.cit.tum.de/en/info', target: { type: 'program', id: 'tum-msc-informatics' }, fields: ['deadline', 'tuition'] },
  { id: 'imp-comp', url: 'https://www.imperial.ac.uk/study/computing/', target: { type: 'program', id: 'imperial-msc-computing' }, fields: ['tuition'] },
  { id: 'de-visa', url: 'https://www.tum.de/visa', target: { type: 'country', country: 'DE' }, fields: ['proof_of_funds', 'visa_fee'] },
  { id: 'eur', url: 'https://www.sbp.org.pk/rates', target: { type: 'fx', currency: 'EUR' }, fields: ['pkr_per_unit'] },
]);

describe('canonicalUrl', () => {
  it('ignores www, fragments, tracking parameters, trailing slashes and parameter order', () => {
    expect(canonicalUrl('https://WWW.Example.org/a/b/?utm_source=x&b=2&a=1#top')).toBe(canonicalUrl('https://example.org/a/b?a=1&b=2'));
    expect(canonicalUrl('https://example.org/')).toBe('https://example.org');
  });
});

describe('validateSources', () => {
  it('accepts a consistent registry', () => {
    expect(validateSources(GOOD, SEED, ALLOW)).toEqual([]);
  });

  it('rejects schema problems, unknown targets and wrong fields', () => {
    const bad = file([
      { id: 'a', url: 'http://www.tum.de/x', target: { type: 'program', id: 'tum-msc-informatics' }, fields: ['deadline'] },
      { id: 'b', url: 'https://www.tum.de/y', target: { type: 'program', id: 'nope' }, fields: ['deadline'] },
      { id: 'c', url: 'https://www.tum.de/z', target: { type: 'program', id: 'tum-msc-informatics' }, fields: ['pkr_per_unit'] },
      { id: 'd', url: 'https://www.tum.de/w', target: { type: 'fx', currency: 'GBP' }, fields: ['pkr_per_unit'] },
    ]);
    const msgs = validateSources(bad, SEED, ALLOW).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/schema/);
    const fixed = file(bad.pages.slice(1));
    const msgs2 = validateSources(fixed, SEED, ALLOW).map((i) => i.message).join('\n');
    expect(msgs2).toMatch(/unknown program "nope"/);
    expect(msgs2).toMatch(/"pkr_per_unit" is not a field of a program/);
    expect(msgs2).toMatch(/no fx_rates row for GBP/);
  });

  it('rejects hosts that are not on the allowlist, duplicate ids and the same page twice for one target', () => {
    const dup = file([
      GOOD.pages[0],
      { ...GOOD.pages[0], id: 'tum-info-other', url: 'https://cit.tum.de/en/info/' },
      { ...GOOD.pages[1], id: GOOD.pages[0].id, url: 'https://evil.example.com/p' },
    ]);
    const msgs = validateSources(dup, SEED, ALLOW).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/duplicate page id/);
    expect(msgs).toMatch(/registered twice/);
    expect(msgs).toMatch(/not on data\/ingest.allowlist.json/);
  });
});

describe('selectPages / groupByTarget', () => {
  const now = new Date('2026-11-27T00:00:00Z');

  it('filters by country of the target (fx pages have none)', () => {
    const de = selectPages(GOOD, emptyState(), SEED, { country: 'DE', now }).map((p) => p.id);
    expect(de).toEqual(['tum-info-main', 'de-visa']);
  });

  it('skips pages checked more recently than --stale-days and keeps never-checked ones', () => {
    const state = emptyState();
    state.pages['https://www.cit.tum.de/en/info'] = { hash: 'h', etag: null, last_modified: null, checked_at: '2026-11-25T00:00:00Z', final_url: 'x', chars: 1, extracted: true };
    const ids = selectPages(GOOD, state, SEED, { staleDays: 7, now }).map((p) => p.id);
    expect(ids).not.toContain('tum-info-main');
    expect(ids).toContain('imp-comp');
    expect(selectPages(GOOD, state, SEED, { staleDays: 1, now }).map((p) => p.id)).toContain('tum-info-main');
  });

  it('groups pages by target and hashes text stably', () => {
    const g = groupByTarget(GOOD.pages);
    expect([...g.keys()]).toEqual(['program:tum-msc-informatics', 'program:imperial-msc-computing', 'country:DE', 'fx:EUR']);
    expect(hashText('a')).toBe(hashText('a'));
    expect(hashText('a')).not.toBe(hashText('b'));
  });
});
