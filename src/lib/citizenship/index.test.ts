import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { FIXED_NOW, conflicting, likely, unverified, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import type { CountryFact, CountryFactKey, CountryFactValue, Fact, FxRate } from '@/lib/types';
import { pkrRate } from '@/lib/cost';
import {
  CITIZENSHIP_CALLOUT,
  CITIZENSHIP_RANK_KEYS,
  FACT_LABELS,
  NO_PKR_RATE,
  NO_PKR_UNVERIFIED,
  PK_DUAL_NATIONALITY_ID,
  RANK_OPTIONS,
  ROW_FACT_KEYS,
  VISA_FUNDS_KEY,
  VISA_FUNDS_NOT_COMPARABLE,
  VISA_FUNDS_NOT_RANKED,
  buildCountryQuestion,
  buildCountryRows,
  citizenshipHref,
  conflictSources,
  conflictedFacts,
  countryRankKey,
  defaultDir,
  evidenceLanguage,
  moneyFactText,
  pakistanDualNationality,
  parseCitizenshipQuery,
  rankCountries,
  rankNumberText,
  rankingSummary,
  studentNote,
  visaFundsView,
  yearlyAmount,
} from './index';

/* ---------- fixtures (fictional values only) ---------- */

function cf(country: string, key: CountryFactKey, fact: Fact<CountryFactValue>): CountryFact {
  return { id: `${country.toLowerCase()}-${key}`, country, key, ...fact };
}

const rule = (months: number | null, text = `Fixture rule (${months} months, fictional)`): CountryFactValue => ({
  text,
  sort_months: months,
  clock_note: 'Fixture clock note (fictional).',
});

const money = (amount: number, currency: string, period: 'year' | 'semester' | 'month' | 'total' = 'year'): CountryFactValue => ({
  text: 'Fixture typical amount (fictional).',
  money: { amount, currency, period },
});

function fxRow(currency: string, fact: Fact<number>): FxRate {
  return { id: `${currency.toLowerCase()}-pkr`, currency, pkr_per_unit: fact };
}

/** Full data: every key usable for every supported country (fictional numbers). */
function fullFacts(): CountryFact[] {
  return [
    cf('DE', 'citizenship_rule', verified(rule(50))),
    cf('CH', 'citizenship_rule', verified(rule(100))),
    cf('UK', 'citizenship_rule', likely(rule(70))),
    cf('CA', 'citizenship_rule', verified(rule(30))),
    cf('US', 'citizenship_rule', verified(rule(55))),

    cf('DE', 'post_study_work', verified(rule(20))),
    cf('CH', 'post_study_work', verified(rule(6))),
    cf('UK', 'post_study_work', verified(rule(24))),
    cf('CA', 'post_study_work', likely(rule(30))),
    cf('US', 'post_study_work', verified(rule(12))),

    cf('DE', 'tuition_typical', verified(money(0, 'EUR'))),
    cf('CH', 'tuition_typical', verified(money(1000, 'CHF', 'semester'))),
    cf('UK', 'tuition_typical', verified(money(20000, 'GBP'))),
    cf('CA', 'tuition_typical', verified(money(25000, 'CAD'))),
    cf('US', 'tuition_typical', likely(money(30000, 'USD'))),

    cf('DE', 'living_cost_typical', verified(money(1000, 'EUR', 'month'))),
    cf('CH', 'living_cost_typical', verified(money(2000, 'CHF', 'month'))),
    cf('UK', 'living_cost_typical', verified(money(15000, 'GBP'))),
    cf('CA', 'living_cost_typical', verified(money(20000, 'CAD'))),
    cf('US', 'living_cost_typical', verified(money(20000, 'USD'))),

    cf('DE', 'pr_route', verified(rule(null, 'Fixture PR route text (fictional).'))),
    cf('DE', 'dual_nationality_destination', likely({ text: 'Fixture dual nationality text (fictional).' })),
    cf('PK', 'pakistan_dual_nationality', verified({ text: 'Fixture Pakistan rule text (fictional).' })),
  ];
}

/** Fictional exchange rates (fixture numbers, not real rates). */
const FULL_FX: FxRate[] = [
  fxRow('EUR', verified(10)),
  fxRow('CHF', verified(20)),
  fxRow('GBP', verified(30)),
  fxRow('CAD', likely(5)),
  fxRow('USD', verified(8)),
];

const seed = loadEmptySeedDataset();
const names = (xs: { row: { country: string } }[]) => xs.map((x) => x.row.country);

/* ---------- rows ---------- */

describe('buildCountryRows', () => {
  it('builds one row per supported destination country, in order, even with no data', () => {
    const rows = buildCountryRows([]);
    expect(rows.map((r) => r.country)).toEqual(['DE', 'CH', 'UK', 'CA', 'US']);
    expect(rows.map((r) => r.name)).toEqual(['Germany', 'Switzerland', 'United Kingdom', 'Canada', 'United States']);
    for (const r of rows) {
      expect(Object.values(r.facts).every((f) => f === null)).toBe(true);
    }
  });

  it('picks up every country fact key from the seed data and never includes PK as a destination', () => {
    const rows = buildCountryRows(seed.countryFacts);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.country === 'PK')).toBeUndefined();
    const ca = rows.find((r) => r.country === 'CA')!;
    expect(ca.facts.citizenship_rule?.id).toBe('ca-citizenship-rule');
    expect(ca.facts.post_study_work?.id).toBe('ca-post-study-work');
    const de = rows.find((r) => r.country === 'DE')!;
    expect(de.facts.citizenship_update?.id).toBe('de-citizenship-update');
    expect(de.facts.dual_nationality_destination?.id).toBe('de-dual-nationality-destination');
    expect(de.facts.tuition_typical?.id).toBe('de-tuition-typical');
    expect(de.facts.living_cost_typical?.id).toBe('de-living-cost-typical');
  });

  it('accepts a custom country list', () => {
    expect(buildCountryRows(seed.countryFacts, ['CA']).map((r) => r.country)).toEqual(['CA']);
  });
});

describe('pakistanDualNationality — the PK card is always present', () => {
  it('returns the seed row (Unverified today)', () => {
    const f = pakistanDualNationality(seed.countryFacts);
    expect(f.id).toBe('pk-pakistan-dual-nationality');
    expect(f.country).toBe('PK');
    expect(f.value).toBeNull();
  });

  it('returns an empty Unverified stub when the data has no PK row', () => {
    const f = pakistanDualNationality([]);
    expect(f).toMatchObject({ id: PK_DUAL_NATIONALITY_ID, country: 'PK', key: 'pakistan_dual_nationality', value: null, source_url: null });
  });

  it('returns a filled row when one exists', () => {
    const f = pakistanDualNationality(fullFacts());
    expect(f.value?.text).toContain('Fixture');
  });
});

/* ---------- query ---------- */

describe('parseCitizenshipQuery', () => {
  it('defaults to citizenship ascending', () => {
    expect(parseCitizenshipQuery({})).toEqual({ rank: 'citizenship', dir: 'asc' });
    expect(parseCitizenshipQuery(undefined)).toEqual({ rank: 'citizenship', dir: 'asc' });
  });

  it('post-study work defaults to descending (longer work permit first)', () => {
    expect(parseCitizenshipQuery({ rank: 'psw' })).toEqual({ rank: 'psw', dir: 'desc' });
    expect(defaultDir('psw')).toBe('desc');
  });

  it('the direction toggle still works', () => {
    expect(parseCitizenshipQuery({ rank: 'psw', dir: 'asc' })).toEqual({ rank: 'psw', dir: 'asc' });
    expect(parseCitizenshipQuery({ rank: 'tuition', dir: 'desc' })).toEqual({ rank: 'tuition', dir: 'desc' });
  });

  it('falls back safely on bad input and uses the first array value', () => {
    expect(parseCitizenshipQuery({ rank: 'chances', dir: 'sideways' })).toEqual({ rank: 'citizenship', dir: 'asc' });
    expect(parseCitizenshipQuery({ rank: ['total', 'psw'], dir: ['desc'] })).toEqual({ rank: 'total', dir: 'desc' });
    expect(parseCitizenshipQuery({ rank: '<script>' })).toEqual({ rank: 'citizenship', dir: 'asc' });
  });
});

describe('citizenshipHref', () => {
  it('drops default values', () => {
    expect(citizenshipHref({ rank: 'citizenship' })).toBe('/citizenship');
    expect(citizenshipHref({ rank: 'citizenship', dir: 'asc' })).toBe('/citizenship');
    expect(citizenshipHref({ rank: 'psw', dir: 'desc' })).toBe('/citizenship?rank=psw');
  });

  it('keeps non-default values and round-trips through the parser', () => {
    expect(citizenshipHref({ rank: 'citizenship', dir: 'desc' })).toBe('/citizenship?dir=desc');
    expect(citizenshipHref({ rank: 'psw', dir: 'asc' })).toBe('/citizenship?rank=psw&dir=asc');
    for (const rank of CITIZENSHIP_RANK_KEYS) {
      for (const dir of ['asc', 'desc'] as const) {
        const href = citizenshipHref({ rank, dir });
        const sp = Object.fromEntries(new URL(href, 'https://example.test').searchParams);
        expect(parseCitizenshipQuery(sp)).toEqual({ rank, dir });
      }
    }
  });

  it('has a chip option for every rank key', () => {
    expect(RANK_OPTIONS.map((o) => o.label)).toEqual(['Citizenship rule', 'Post-study work', 'Tuition', 'Total cost']);
  });
});

/* ---------- ranking with today's seed data ---------- */

describe('rankCountries — seed data (today)', () => {
  const rows = buildCountryRows(seed.countryFacts);

  it('citizenship: CA (36 months) before DE (60 months); UK, US and CH not ranked', () => {
    const r = rankCountries(rows, parseCitizenshipQuery({}), seed.fxRates, FIXED_NOW);
    expect(names(r.ranked)).toEqual(['CA', 'DE']);
    expect(r.ranked.map((x) => x.key.value)).toEqual([36, 60]);
    expect(r.ranked.map((x) => x.rank)).toEqual([1, 2]);
    expect(r.ranked.every((x) => x.key.confidence === 'Likely')).toBe(true);
    expect(r.ranked[0].key.display).toBe('36 months (the number this rule is ranked by)');
    expect(r.ranked[0].key.showBadge).toBe(false);
    expect(names(r.notRanked).sort()).toEqual(['CH', 'UK', 'US']);
    expect(r.notRanked.every((x) => x.reason === 'Citizenship rule not verified yet')).toBe(true);
  });

  it('citizenship descending flips the ranked order and keeps the same not-ranked group', () => {
    const r = rankCountries(rows, { rank: 'citizenship', dir: 'desc' }, seed.fxRates, FIXED_NOW);
    expect(names(r.ranked)).toEqual(['DE', 'CA']);
    expect(names(r.notRanked).sort()).toEqual(['CH', 'UK', 'US']);
  });

  it('post-study work: longest first by default (US 36, UK 18)', () => {
    const r = rankCountries(rows, parseCitizenshipQuery({ rank: 'psw' }), seed.fxRates, FIXED_NOW);
    expect(names(r.ranked)).toEqual(['US', 'UK']);
    expect(names(r.notRanked).sort()).toEqual(['CA', 'CH', 'DE']);
    expect(r.notRanked[0].reason).toBe('Post-study work rule not verified yet');
    const asc = rankCountries(rows, parseCitizenshipQuery({ rank: 'psw', dir: 'asc' }), seed.fxRates, FIXED_NOW);
    expect(names(asc.ranked)).toEqual(['UK', 'US']);
  });

  it('tuition: nothing is ranked today, every country has a reason', () => {
    const r = rankCountries(rows, { rank: 'tuition', dir: 'asc' }, seed.fxRates, FIXED_NOW);
    expect(r.ranked).toHaveLength(0);
    expect(r.notRanked).toHaveLength(5);
    expect(r.notRanked.every((x) => x.reason === 'Typical tuition not verified yet')).toBe(true);
    expect(r.notRanked.every((x) => x.key.value === null)).toBe(true);
  });

  it('total cost: nothing is ranked today and both missing parts are named', () => {
    const r = rankCountries(rows, { rank: 'total', dir: 'asc' }, seed.fxRates, FIXED_NOW);
    expect(r.ranked).toHaveLength(0);
    expect(r.notRanked).toHaveLength(5);
    for (const x of r.notRanked) {
      expect(x.reason).toBe('Typical tuition not verified yet; Typical living cost not verified yet');
    }
  });

  it('never silently drops a country', () => {
    for (const rank of CITIZENSHIP_RANK_KEYS) {
      const r = rankCountries(rows, parseCitizenshipQuery({ rank }), seed.fxRates, FIXED_NOW);
      expect(r.ranked.length + r.notRanked.length).toBe(5);
    }
  });

  it('summary line for screen readers', () => {
    const r = rankCountries(rows, parseCitizenshipQuery({}), seed.fxRates, FIXED_NOW);
    expect(rankingSummary(r)).toBe(
      'Ranked by citizenship rule, shortest first. 2 countries ranked, 3 not ranked because data is missing.',
    );
  });
});

/* ---------- ranking with full fixture data ---------- */

describe('rankCountries — full fixture data', () => {
  const rows = buildCountryRows(fullFacts());

  it('citizenship ranks every country ascending by sort_months', () => {
    const r = rankCountries(rows, { rank: 'citizenship', dir: 'asc' }, FULL_FX, FIXED_NOW);
    expect(names(r.ranked)).toEqual(['CA', 'DE', 'US', 'UK', 'CH']);
    expect(r.notRanked).toHaveLength(0);
    expect(r.ranked.find((x) => x.row.country === 'UK')?.key.confidence).toBe('Likely');
  });

  it('psw ranks longest first, toggle to shortest first', () => {
    const desc = rankCountries(rows, { rank: 'psw', dir: 'desc' }, FULL_FX, FIXED_NOW);
    expect(names(desc.ranked)).toEqual(['CA', 'UK', 'DE', 'US', 'CH']);
    expect(desc.ranked[0].key.display).toBe('30 months (the number this rule is ranked by)');
    expect(desc.ranked.every((x) => x.key.showBadge === false)).toBe(true);
    const asc = rankCountries(rows, { rank: 'psw', dir: 'asc' }, FULL_FX, FIXED_NOW);
    expect(names(asc.ranked)).toEqual(['CH', 'US', 'DE', 'UK', 'CA']);
  });

  it('tuition converts yearly amounts to PKR via the fx rows', () => {
    const r = rankCountries(rows, { rank: 'tuition', dir: 'asc' }, FULL_FX, FIXED_NOW);
    // DE 0 | CH 2,000 CHF/yr * 20 = 40,000 | CA 25,000 * 5 = 125,000 | US 30,000 * 8 = 240,000 | UK 20,000 * 30 = 600,000
    expect(names(r.ranked)).toEqual(['DE', 'CH', 'CA', 'US', 'UK']);
    expect(r.ranked.map((x) => x.key.value)).toEqual([0, 40_000, 125_000, 240_000, 600_000]);
    expect(r.ranked.find((x) => x.row.country === 'CA')?.key.confidence).toBe('Likely'); // Likely fx rate
    expect(r.ranked.find((x) => x.row.country === 'US')?.key.confidence).toBe('Likely'); // Likely tuition fact
    expect(r.ranked[1].key.display).toBe('PKR 40,000 per year');
    expect(r.ranked.every((x) => x.key.showBadge)).toBe(true); // a converted amount keeps its computed badge
    expect(r.ranked[1].key.detail).toContain('per year');
    const desc = rankCountries(rows, { rank: 'tuition', dir: 'desc' }, FULL_FX, FIXED_NOW);
    expect(names(desc.ranked)).toEqual(['UK', 'US', 'CA', 'CH', 'DE']);
  });

  it('total = tuition + living per year in PKR', () => {
    const r = rankCountries(rows, { rank: 'total', dir: 'asc' }, FULL_FX, FIXED_NOW);
    // DE 0 + 12,000*10 = 120,000 | CA 125,000 + 100,000 = 225,000 | CH 40,000 + 24,000*20 = 520,000
    // US 240,000 + 160,000 = 400,000 | UK 600,000 + 450,000 = 1,050,000
    expect(names(r.ranked)).toEqual(['DE', 'CA', 'US', 'CH', 'UK']);
    expect(r.ranked.map((x) => x.key.value)).toEqual([120_000, 225_000, 400_000, 520_000, 1_050_000]);
    expect(r.ranked[0].key.display).toBe('PKR 120,000 (1.2 lakh) per year');
    expect(r.ranked[0].key.detail).toContain('Tuition');
  });

  it('zero tuition needs no exchange rate, but non-zero amounts do', () => {
    const r = rankCountries(rows, { rank: 'tuition', dir: 'asc' }, [], FIXED_NOW);
    expect(names(r.ranked)).toEqual(['DE']);
    expect(r.ranked[0].key.value).toBe(0);
    expect(r.notRanked.find((x) => x.row.country === 'UK')?.reason).toBe('No verified GBP→PKR exchange rate yet');
  });

  it('an Unverified exchange rate is not used', () => {
    const fx = FULL_FX.map((f) => (f.currency === 'GBP' ? fxRow('GBP', unverified(30)) : f));
    const r = rankCountries(rows, { rank: 'total', dir: 'asc' }, fx, FIXED_NOW);
    expect(names(r.notRanked)).toEqual(['UK']);
    expect(r.notRanked[0].reason).toBe('No verified GBP→PKR exchange rate yet');
  });

  it('total needs both tuition and living cost', () => {
    const facts = fullFacts().filter((f) => !(f.country === 'CA' && f.key === 'living_cost_typical'));
    const r = rankCountries(buildCountryRows(facts), { rank: 'total', dir: 'asc' }, FULL_FX, FIXED_NOW);
    expect(names(r.notRanked)).toEqual(['CA']);
    expect(r.notRanked[0].reason).toBe('Typical living cost not verified yet');
    // Tuition alone still ranks CA.
    const t = rankCountries(buildCountryRows(facts), { rank: 'tuition', dir: 'asc' }, FULL_FX, FIXED_NOW);
    expect(names(t.ranked)).toContain('CA');
  });
});

/* ---------- not-ranked reasons ---------- */

describe('countryRankKey — not-ranked reasons', () => {
  const now = FIXED_NOW;
  const rowWith = (key: CountryFactKey, fact: Fact<CountryFactValue>) => buildCountryRows([cf('DE', key, fact)], ['DE'])[0];

  it('Unverified value with a number is not ranked (never treated as data)', () => {
    const k = countryRankKey(rowWith('citizenship_rule', unverified(rule(12))), 'citizenship', [], now);
    expect(k.value).toBeNull();
    expect(k.missingReason).toBe('Citizenship rule not verified yet');
  });

  it('Conflicting sources are not ranked', () => {
    const k = countryRankKey(rowWith('citizenship_rule', conflicting(rule(40), rule(50))), 'citizenship', [], now);
    expect(k.value).toBeNull();
    expect(k.confidence).toBe('Conflict');
    expect(k.missingReason).toBe('Sources disagree on the citizenship rule');
  });

  it('a usable rule without a months number is not ranked', () => {
    const k = countryRankKey(rowWith('post_study_work', verified(rule(null))), 'psw', [], now);
    expect(k.value).toBeNull();
    expect(k.missingReason).toBe('Post-study work rule has no single number of months to compare');
  });

  it('money: no amount, total-only amount', () => {
    const noMoney = countryRankKey(rowWith('tuition_typical', verified({ text: 'Fixture text only' })), 'tuition', FULL_FX, now);
    expect(noMoney.missingReason).toBe('Typical tuition has no amount to compare');
    const total = countryRankKey(rowWith('tuition_typical', verified(money(5000, 'EUR', 'total'))), 'tuition', FULL_FX, now);
    expect(total.missingReason).toBe('Typical tuition is not given per year');
  });

  it('a stale verified fact becomes Likely and is still ranked', () => {
    const k = countryRankKey(rowWith('citizenship_rule', verified(rule(40), 90)), 'citizenship', [], now);
    expect(k.value).toBe(40);
    expect(k.confidence).toBe('Likely');
  });
});

describe('yearlyAmount', () => {
  it('scales per period and refuses totals', () => {
    expect(yearlyAmount({ amount: 100, currency: 'EUR', period: 'year' })).toBe(100);
    expect(yearlyAmount({ amount: 100, currency: 'EUR', period: 'semester' })).toBe(200);
    expect(yearlyAmount({ amount: 100, currency: 'EUR', period: 'month' })).toBe(1200);
    expect(yearlyAmount({ amount: 100, currency: 'EUR', period: 'total' })).toBeNull();
    expect(yearlyAmount({ amount: -1, currency: 'EUR', period: 'year' })).toBeNull();
    expect(yearlyAmount({ amount: Number.NaN, currency: 'EUR', period: 'year' })).toBeNull();
    expect(yearlyAmount(null)).toBeNull();
  });
});

/* ---------- conflicts ---------- */

describe('conflicts', () => {
  it('lists conflicted facts and builds a plain-text question with both values and links', () => {
    const row = buildCountryRows([cf('CA', 'citizenship_rule', conflicting(rule(40, 'Fixture A'), rule(50, 'Fixture B')))], ['CA'])[0];
    const c = conflictedFacts(row, FIXED_NOW);
    expect(c.map((x) => x.key)).toEqual(['citizenship_rule']);
    const text = buildCountryQuestion({ countryName: row.name, topic: c[0].label, sources: conflictSources(c[0].fact) });
    expect(text).toContain('"Fixture A" (source: https://fixture.example.edu/page-a)');
    expect(text).toContain('"Fixture B" (source: https://fixture.example.edu/page-b)');
    expect(text).toContain('citizenship rule in Canada');
    expect(text).not.toMatch(/@/); // no invented email address
  });

  it('no conflicts in today’s seed data', () => {
    for (const row of buildCountryRows(seed.countryFacts)) expect(conflictedFacts(row, FIXED_NOW)).toHaveLength(0);
  });
});

/* ---------- copy rules ---------- */

describe('copy', () => {
  it('the call-out never promises an outcome', () => {
    const all = `${CITIZENSHIP_CALLOUT.title} ${CITIZENSHIP_CALLOUT.body}`;
    expect(all).toBe('Earliest rule, not a guarantee. Not immigration advice. Rules change - always check the official page.');
    expect(all.toLowerCase()).not.toContain('guaranteed');
    expect(all.toLowerCase()).not.toContain('fastest');
    for (const o of RANK_OPTIONS) {
      expect(`${o.label} ${o.dirLabels.asc} ${o.dirLabels.desc}`.toLowerCase()).not.toMatch(/fastest|guarantee|chance|%/);
    }
  });

  it('moneyFactText shows the amount and the source wording', () => {
    expect(moneyFactText(money(100, 'EUR'))).toMatch(/^€100 per year\. Fixture/);
    expect(moneyFactText({ text: 'Only words' })).toBe('Only words');
  });
});

/* ---------- review findings (regressions) ---------- */

describe('ranked months number is a sort key, never a code-made legal paraphrase (live seed)', () => {
  const live = loadSeedDataset();
  const rows = buildCountryRows(live.countryFacts);

  it('citizenship: Canada and Germany show "<N> months (the number this rule is ranked by)" with no badge', () => {
    const r = rankCountries(rows, parseCitizenshipQuery({}), live.fxRates, FIXED_NOW);
    expect(names(r.ranked)).toEqual(['CA', 'DE']);
    expect(r.ranked.map((x) => x.key.display)).toEqual([
      '36 months (the number this rule is ranked by)',
      '60 months (the number this rule is ranked by)',
    ]);
    // The facts themselves are Verified today, but the code-made line must not carry that badge.
    expect(r.ranked.map((x) => x.key.confidence)).toEqual(['Verified', 'Verified']);
    expect(r.ranked.every((x) => x.key.showBadge === false)).toBe(true);
    for (const x of r.ranked) {
      expect(x.key.display).not.toMatch(/minimum residence|years? minimum|longest work permit/i);
      expect(x.key.detail).toBe('Read the exact rule: its wording is what counts.');
    }
  });

  it('post-study work: the UK row is "18 months (the number this rule is ranked by)", not "18 months longest work permit"', () => {
    const r = rankCountries(rows, parseCitizenshipQuery({ rank: 'psw' }), live.fxRates, FIXED_NOW);
    expect(names(r.ranked)).toEqual(['US', 'UK']);
    const uk = r.ranked.find((x) => x.row.country === 'UK')!;
    expect(uk.key.display).toBe('18 months (the number this rule is ranked by)');
    expect(uk.key.showBadge).toBe(false);
    // The UK rule text (which also allows 2 years) is kept exactly as the data states it.
    expect(uk.row.facts.post_study_work?.value?.text).toContain('2 years');
    const us = r.ranked.find((x) => x.row.country === 'US')!;
    expect(us.key.display).toBe('36 months (the number this rule is ranked by)');
    expect(us.key.showBadge).toBe(false);
    for (const x of r.ranked) expect(x.key.display).not.toMatch(/longest work permit|years? longest/i);
  });

  it('rankNumberText uses months, never years, and handles 1 month', () => {
    expect(rankNumberText(36)).toBe('36 months (the number this rule is ranked by)');
    expect(rankNumberText(1)).toBe('1 month (the number this rule is ranked by)');
  });
});

describe('evidenceLanguage — label German-language official pages', () => {
  it('detects German pages by the first path segment', () => {
    expect(evidenceLanguage('https://www.bundesregierung.de/breg-de/aktuelles/kabinett-einbuergerung-2350620')).toEqual({
      code: 'de',
      name: 'German',
    });
    expect(evidenceLanguage('https://www.bamf.de/DE/Themen/Integration/Einbuergerung/einbuergerung-node.html')?.name).toBe('German');
    expect(evidenceLanguage('https://www.auswaertiges-amt.de/de/some-page')?.name).toBe('German');
  });

  it('English pages, other paths, bad URLs and missing URLs are not labelled', () => {
    expect(evidenceLanguage('https://www.auswaertiges-amt.de/en/229970-229970')).toBeNull();
    expect(evidenceLanguage('https://www.bundesregierung.de/breg-en/news/x')).toBeNull();
    expect(evidenceLanguage('https://www.gov.uk/graduate-visa')).toBeNull();
    expect(evidenceLanguage('https://fixture.example.edu/countries/de/page')).toBeNull(); // only the first segment counts
    expect(evidenceLanguage('not a url')).toBeNull();
    expect(evidenceLanguage(null)).toBeNull();
    expect(evidenceLanguage(undefined)).toBeNull();
  });

  it('live seed: only the German federal government snippet is labelled', () => {
    const live = loadSeedDataset();
    const labelled = live.countryFacts
      .filter((f) => f.evidence_snippet && evidenceLanguage(f.source_url))
      .map((f) => f.id);
    expect(labelled).toEqual(['de-citizenship-update']);
  });
});

describe('studentNote — student-facing note only, never the reviewer note', () => {
  it('returns the note text', () => {
    expect(studentNote({ note: '  Fixture note (fictional).  ' })).toBe('Fixture note (fictional).');
  });

  it('drops blank notes and notes that only repeat "Not verified yet"', () => {
    expect(studentNote({ note: null })).toBeNull();
    expect(studentNote({ note: '   ' })).toBeNull();
    expect(studentNote({ note: 'Not verified yet.' })).toBeNull();
    expect(studentNote({ note: 'not verified yet' })).toBeNull();
    expect(studentNote(null)).toBeNull();
  });

  it('never falls back to review_note', () => {
    const f = { ...verified(rule(12)), note: null, review_note: 'REVIEW-NOTE-MARKER (internal)' };
    expect(studentNote(f)).toBeNull();
  });

  it('live seed: the Canada half-day quote and the US STEM quote are student notes', () => {
    const live = loadSeedDataset();
    const ca = live.countryFacts.find((f) => f.id === 'ca-citizenship-rule')!;
    const us = live.countryFacts.find((f) => f.id === 'us-post-study-work')!;
    expect(studentNote(ca)).toContain('0.5 days of physical presence');
    expect(studentNote(us)).toContain('24-month extension');
  });
});

/* ---------- money to show for the student visa (proof_of_funds) ---------- */

describe('visa money (proof_of_funds): shown for every country, never ranked', () => {
  const live = loadSeedDataset();
  const liveRows = buildCountryRows(live.countryFacts);
  const liveFact = (c: string) => liveRows.find((r) => r.country === c)!.facts.proof_of_funds;
  const DEC_2 = new Date('2026-12-02T12:00:00Z');
  const JAN_10 = new Date('2027-01-10T12:00:00Z');

  const visaMoney = (
    amount: number,
    currency: string,
    period: 'year' | 'month' | 'semester' | 'total' = 'year',
  ): CountryFactValue => ({
    text: 'Fixture visa money rule (fictional).',
    money: { amount, currency, period },
    clock_note: 'Fixture: how it is checked (fictional).',
  });

  it('is a row key with its own label, and is not a rank option', () => {
    expect(VISA_FUNDS_KEY).toBe('proof_of_funds');
    expect(ROW_FACT_KEYS).toContain('proof_of_funds');
    expect(FACT_LABELS.proof_of_funds).toBe('Money to show for the student visa');
    expect(CITIZENSHIP_RANK_KEYS as readonly string[]).not.toContain('proof_of_funds');
    for (const o of RANK_OPTIONS) expect(o.label).not.toMatch(/visa|funds|money to show/i);
    expect(parseCitizenshipQuery({ rank: 'proof_of_funds' }).rank).toBe('citizenship');
  });

  it('live seed: every destination country has its proof_of_funds row', () => {
    expect(liveRows.map((r) => r.facts.proof_of_funds?.id)).toEqual([
      'de-proof-of-funds',
      'ch-proof-of-funds',
      'uk-proof-of-funds',
      'ca-proof-of-funds',
      'us-proof-of-funds',
    ]);
    // The frozen empty seed has no such rows: the block still exists and reads "Not verified yet".
    for (const r of buildCountryRows(seed.countryFacts)) {
      expect(r.facts.proof_of_funds).toBeNull();
      expect(visaFundsView(r.facts.proof_of_funds, seed.fxRates, FIXED_NOW)).toEqual({
        state: 'empty',
        confidence: 'Unverified',
        text: null,
        amount: null,
        pkr: null,
        howChecked: null,
      });
    }
  });

  it('UK: the rule text and how it is checked; no single amount, so no amount and no PKR line', () => {
    const v = visaFundsView(liveFact('UK'), live.fxRates, FIXED_NOW);
    expect(v.state).toBe('value');
    expect(v.confidence).toBe('Verified');
    expect(v.text).toContain('£1,529 per month for courses in London');
    expect(v.text).toContain('£1,171 per month for courses outside London');
    expect(v.howChecked).toBe(
      'You must have this money for at least 28 days in a row. The 28-day period must end within 31 days of the date you apply.',
    );
    expect(v.amount).toBeNull();
    expect(v.pkr).toBeNull();
  });

  it('DE: €11,904 per year; no verified EUR rate today, so "No verified PKR rate yet"', () => {
    const v = visaFundsView(liveFact('DE'), live.fxRates, FIXED_NOW);
    expect(v.confidence).toBe('Verified');
    expect(v.amount).toBe('€11,904 per year');
    expect(pkrRate('EUR', live.fxRates, FIXED_NOW)).toBeNull(); // today: every fx row is empty
    expect(v.pkr).toEqual({ ok: false, text: NO_PKR_RATE });
    expect(NO_PKR_RATE).toBe('No verified PKR rate yet');
    expect(v.howChecked).toContain('attested by the Embassy in Islamabad');
  });

  it('CA: CA$23,448 per year; "No verified PKR rate yet"', () => {
    const v = visaFundsView(liveFact('CA'), live.fxRates, FIXED_NOW);
    expect(v.amount).toBe('CA$23,448 per year');
    expect(pkrRate('CAD', live.fxRates, FIXED_NOW)).toBeNull();
    expect(v.pkr).toEqual({ ok: false, text: NO_PKR_RATE });
    expect(v.text).toContain('not including tuition and transport');
  });

  it('US: text only (the school works it out for the I-20): no amount, no PKR line, no check line', () => {
    const v = visaFundsView(liveFact('US'), live.fxRates, FIXED_NOW);
    expect(v.state).toBe('value');
    expect(v.text).toContain('Form I-20');
    expect(v.amount).toBeNull();
    expect(v.pkr).toBeNull();
    expect(v.howChecked).toBeNull();
  });

  it('CH: a row with no value is "Not verified yet" (empty, Unverified)', () => {
    const v = visaFundsView(liveFact('CH'), live.fxRates, FIXED_NOW);
    expect(v).toEqual({ state: 'empty', confidence: 'Unverified', text: null, amount: null, pkr: null, howChecked: null });
    expect(studentNote(liveFact('CH'))).toBeNull(); // its "Not verified yet." note is not repeated
  });

  it('pinned dates: still Verified on 2 Dec 2026, Likely from 10 Jan 2027 (checked 24 Nov 2026)', () => {
    expect(visaFundsView(liveFact('DE'), live.fxRates, DEC_2).confidence).toBe('Verified');
    expect(visaFundsView(liveFact('DE'), live.fxRates, JAN_10).confidence).toBe('Likely');
    // An old (Likely) amount is still converted, and the PKR badge is the weaker of amount and rate.
    const fx = [fxRow('EUR', { ...verified(300), fetched_at: '2027-01-08' })];
    const v = visaFundsView(liveFact('DE'), fx, JAN_10);
    expect(v.pkr).toEqual({
      ok: true,
      text: 'PKR 3,571,200 (35.7 lakh) per year',
      confidence: 'Likely',
      detail: 'Converted from EUR with the exchange rate checked 8 Jan 2027. The official amount is the one in EUR.',
    });
  });

  it('PKR only through a Verified/Likely rate; the badge is the weaker input', () => {
    const fact = cf('DE', 'proof_of_funds', verified(visaMoney(1000, 'EUR')));
    const ok = visaFundsView(fact, FULL_FX, FIXED_NOW);
    expect(ok.amount).toBe('€1,000 per year');
    expect(ok.pkr).toMatchObject({ ok: true, text: 'PKR 10,000 per year', confidence: 'Verified' });
    const monthly = visaFundsView(cf('CA', 'proof_of_funds', verified(visaMoney(100, 'CAD', 'month'))), FULL_FX, FIXED_NOW);
    expect(monthly.amount).toBe('CA$100 per month');
    expect(monthly.pkr).toMatchObject({ ok: true, text: 'PKR 500 per month', confidence: 'Likely' }); // Likely CAD rate
    for (const bad of [unverified(300), conflicting(300, 310)]) {
      expect(visaFundsView(fact, [fxRow('EUR', bad)], FIXED_NOW).pkr).toEqual({ ok: false, text: NO_PKR_RATE });
    }
    expect(visaFundsView(fact, [], FIXED_NOW).pkr).toEqual({ ok: false, text: NO_PKR_RATE });
  });

  it('an Unverified amount is never converted, even with a verified rate', () => {
    const v = visaFundsView(cf('DE', 'proof_of_funds', unverified(visaMoney(1000, 'EUR'))), FULL_FX, FIXED_NOW);
    expect(v.state).toBe('value');
    expect(v.confidence).toBe('Unverified');
    expect(v.amount).toBe('€1,000 per year');
    expect(v.pkr).toEqual({ ok: false, text: NO_PKR_UNVERIFIED });
  });

  it('a Conflict shows no single amount and no PKR line (both sources are shown by the UI)', () => {
    const v = visaFundsView(
      cf('DE', 'proof_of_funds', conflicting(visaMoney(1000, 'EUR'), visaMoney(2000, 'EUR'))),
      FULL_FX,
      FIXED_NOW,
    );
    expect(v).toEqual({ state: 'conflict', confidence: 'Conflict', text: null, amount: null, pkr: null, howChecked: null });
  });

  it('an amount already in PKR needs no PKR line; a broken amount is never shown', () => {
    expect(visaFundsView(cf('DE', 'proof_of_funds', verified(visaMoney(5000, 'PKR'))), FULL_FX, FIXED_NOW).pkr).toBeNull();
    for (const amount of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const v = visaFundsView(cf('DE', 'proof_of_funds', verified(visaMoney(amount, 'EUR'))), FULL_FX, FIXED_NOW);
      expect(v.amount).toBeNull();
      expect(v.pkr).toBeNull();
    }
  });

  it('never ranks: every ranking is identical with or without visa-money rows', () => {
    const visa: CountryFact[] = [
      cf('DE', 'proof_of_funds', verified(visaMoney(99_000, 'EUR'))),
      cf('CH', 'proof_of_funds', verified(visaMoney(1, 'CHF'))),
      cf('UK', 'proof_of_funds', verified(visaMoney(5, 'GBP', 'month'))),
      cf('CA', 'proof_of_funds', verified(visaMoney(50_000, 'CAD'))),
      cf('US', 'proof_of_funds', verified({ text: 'Fixture I-20 rule (fictional).' })),
    ];
    const without = buildCountryRows(fullFacts());
    const withVisa = buildCountryRows([...fullFacts(), ...visa]);
    for (const rank of CITIZENSHIP_RANK_KEYS) {
      for (const dir of ['asc', 'desc'] as const) {
        const a = rankCountries(without, { rank, dir }, FULL_FX, FIXED_NOW);
        const b = rankCountries(withVisa, { rank, dir }, FULL_FX, FIXED_NOW);
        expect(names(b.ranked), `${rank} ${dir}`).toEqual(names(a.ranked));
        expect(
          b.ranked.map((x) => x.key),
          `${rank} ${dir}`,
        ).toEqual(a.ranked.map((x) => x.key));
        expect(names(b.notRanked)).toEqual(names(a.notRanked));
      }
    }
    // With ONLY visa-money rows, nothing is ranked by anything.
    const only = buildCountryRows(visa);
    for (const rank of CITIZENSHIP_RANK_KEYS) {
      expect(rankCountries(only, { rank, dir: 'asc' }, FULL_FX, FIXED_NOW).ranked, rank).toHaveLength(0);
    }
  });

  it('a conflicting visa-money row gets its own copy-question', () => {
    const row = buildCountryRows(
      [cf('CA', 'proof_of_funds', conflicting(visaMoney(1, 'CAD'), visaMoney(2, 'CAD')))],
      ['CA'],
    )[0];
    expect(conflictedFacts(row, FIXED_NOW).map((c) => c.label)).toEqual(['Money to show for the student visa']);
  });

  it('copy: the not-ranked line explains why, with no numbers, no country claims and no outcome promise', () => {
    expect(VISA_FUNDS_NOT_RANKED).toBe(`Not ranked. ${VISA_FUNDS_NOT_COMPARABLE} Read each country's rule.`);
    expect(VISA_FUNDS_NOT_COMPARABLE).toContain('cannot be compared');
    for (const t of [VISA_FUNDS_NOT_RANKED, NO_PKR_RATE, NO_PKR_UNVERIFIED]) {
      expect(t).not.toMatch(/\d|guarantee|chance|will get|approved|Germany|Canada|United|Switzerland/i);
    }
  });

  it('the view never carries the reviewer note', () => {
    for (const c of ['DE', 'CH', 'UK', 'CA', 'US']) {
      const f = liveFact(c);
      const json = JSON.stringify(visaFundsView(f, live.fxRates, FIXED_NOW));
      if (f?.review_note) expect(json).not.toContain(f.review_note.slice(0, 40));
      expect(json).not.toMatch(/Awaiting human review|Companion snippets/);
    }
  });
});
