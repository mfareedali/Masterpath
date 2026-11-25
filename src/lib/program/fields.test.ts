import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { conflicting, FIXED_NOW, likely, makeProgram, unverified, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import type { Program } from '@/lib/types';
import {
  ALL_FACT_KEYS_LISTED,
  applicableFactKeys,
  computeCoverage,
  coverageDetail,
  coverageLine,
  FACT_LABEL,
  FACT_SECTIONS,
  isPathwayProgram,
  PROGRAM_FACT_KEYS,
  reportFieldOptions,
} from './fields';

const now = FIXED_NOW;

function isFactShaped(v: unknown): boolean {
  return v !== null && typeof v === 'object' && 'value' in v && 'source_url' in v && 'evidence_snippet' in v;
}

describe('PROGRAM_FACT_KEYS', () => {
  it('lists every fact field of the Program type (compile-time guard)', () => {
    expect(ALL_FACT_KEYS_LISTED).toBe(true);
    expect(PROGRAM_FACT_KEYS).toHaveLength(20);
    expect(new Set(PROGRAM_FACT_KEYS).size).toBe(PROGRAM_FACT_KEYS.length);
  });

  it('matches the fact-shaped fields of every seed program', () => {
    for (const p of loadEmptySeedDataset().programs) {
      const factKeys = Object.entries(p)
        .filter(([, v]) => isFactShaped(v))
        .map(([k]) => k)
        .sort();
      expect(factKeys).toEqual([...PROGRAM_FACT_KEYS].sort());
    }
  });

  it('matches the fact fields of the test fixture', () => {
    const p = makeProgram();
    for (const k of PROGRAM_FACT_KEYS) expect(isFactShaped(p[k])).toBe(true);
  });

  it('has a label for every key', () => {
    for (const k of PROGRAM_FACT_KEYS) expect(FACT_LABEL[k].length).toBeGreaterThan(1);
  });

  it('page sections + status banner + research block cover every field exactly once', () => {
    const shown = [
      ...Object.values(FACT_SECTIONS).flatMap((s) => [...s.keys]),
      'status_note',
      'research_considered',
    ];
    expect([...shown].sort()).toEqual([...PROGRAM_FACT_KEYS].sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('puts "Who this course is for" first under Entry requirements', () => {
    expect(FACT_SECTIONS.entry.keys[0]).toBe('eligibility_note');
    expect(FACT_LABEL.eligibility_note).toBe('Who this course is for');
  });

  it('places the route below the minimum after the minimum grade, and the English waiver after the English test', () => {
    expect([...FACT_SECTIONS.entry.keys]).toEqual([
      'eligibility_note',
      'min_gpa_rule',
      'conditional_admission',
      'language_req',
      'language_waiver',
      'tests_required',
    ]);
    expect(FACT_LABEL.conditional_admission).toBe('Route below the minimum');
    expect(FACT_LABEL.language_waiver).toBe('English test waiver');
    // Page order is also the report form's order.
    const order = [...PROGRAM_FACT_KEYS];
    expect(order.indexOf('conditional_admission')).toBe(order.indexOf('min_gpa_rule') + 1);
    expect(order.indexOf('language_waiver')).toBe(order.indexOf('language_req') + 1);
  });
});

describe('applicableFactKeys', () => {
  it('drops progression fields and the empty status note for a direct, active program', () => {
    const keys = applicableFactKeys(makeProgram({ pathway_type: 'direct' }));
    expect(keys).toHaveLength(17);
    expect(keys).toContain('eligibility_note');
    expect(keys).not.toContain('progression_guaranteed');
    expect(keys).not.toContain('progression_requirement');
    expect(keys).not.toContain('status_note');
  });

  it('keeps progression fields for pre-masters, pathway and conditional routes', () => {
    for (const pathway_type of ['pre_masters', 'pathway', 'conditional'] as const) {
      const p = makeProgram({ pathway_type });
      expect(isPathwayProgram(p)).toBe(true);
      expect(applicableFactKeys(p)).toContain('progression_requirement');
      expect(applicableFactKeys(p)).toHaveLength(19);
    }
    expect(isPathwayProgram(makeProgram({ pathway_type: 'score_based' }))).toBe(false);
  });

  it('counts "Who this course is for" for every program, even when it is empty', () => {
    for (const p of [makeProgram(), makeProgram({ status: 'ruled_out' }), makeProgram({ pathway_type: 'pre_masters' })]) {
      expect(applicableFactKeys(p)).toContain('eligibility_note');
    }
    expect(coverageLine(computeCoverage(makeProgram({ pathway_type: 'direct' }), now))).toBe('0 of 17 fields verified');
  });

  it('counts "Route below the minimum" and "English test waiver" for every program, even when they are empty', () => {
    const programs = [
      makeProgram(),
      makeProgram({ status: 'ruled_out' }),
      makeProgram({ pathway_type: 'pre_masters' }),
      ...loadEmptySeedDataset().programs,
    ];
    for (const p of programs) {
      expect(applicableFactKeys(p)).toContain('conditional_admission');
      expect(applicableFactKeys(p)).toContain('language_waiver');
    }
    const c = computeCoverage(makeProgram(), now);
    expect(c.byKey.conditional_admission).toBe('Unverified');
    expect(c.byKey.language_waiver).toBe('Unverified');
  });

  it('live seed: NYIT counts its route below the minimum as Verified (a fact like any other, never a fit input)', () => {
    const live = loadSeedDataset().programs;
    const nyit = live.find((p) => p.id === 'nyit-mscs') as Program;
    const c = computeCoverage(nyit, new Date('2026-11-24T12:00:00Z'));
    expect(c.byKey.conditional_admission).toBe('Verified');
    expect(c.byKey.language_waiver).toBe('Verified');
    const withWaiver = live.filter((p) => p.language_waiver?.value != null).map((p) => p.id);
    expect(withWaiver.length).toBeGreaterThanOrEqual(7);
  });

  it('keeps the status note for a ruled-out program', () => {
    expect(applicableFactKeys(makeProgram({ status: 'ruled_out' }))).toContain('status_note');
  });

  it('keeps the status note when an active program has one', () => {
    expect(applicableFactKeys(makeProgram({ status_note: verified('Fixture note') }))).toContain('status_note');
  });
});

describe('computeCoverage', () => {
  it('counts nothing as verified for the empty seed data', () => {
    for (const p of loadEmptySeedDataset().programs) {
      const c = computeCoverage(p, now);
      expect(c.verified).toBe(0);
      expect(c.likely).toBe(0);
      expect(c.total).toBe(applicableFactKeys(p).length);
      expect(c.unverified).toBe(c.total);
      expect(coverageLine(c)).toBe(`0 of ${c.total} fields verified`);
    }
  });

  it('counts the seed ruled-out program (status note has no source, so Unverified)', () => {
    const ljmu = loadEmptySeedDataset().programs.find((p) => p.id === 'ljmu-msc-cs') as Program;
    const c = computeCoverage(ljmu, now);
    expect(c.byKey.status_note).toBe('Unverified');
    expect(c.total).toBe(18);
  });

  it('counts each confidence for full fixture data: "11 of 20 fields verified"', () => {
    const p = makeProgram({
      status: 'ruled_out',
      pathway_type: 'pre_masters',
      status_note: verified('Fixture: not running this year'),
      eligibility_note: verified('Fixture: for graduates of other subjects'),
      intake: verified('September'),
      deadline: verified('2027-01-15'),
      duration_months: verified(12),
      tuition: verified({ amount: 10000, currency: 'GBP', period: 'year' as const }),
      living_cost: verified({ amount: 1000, currency: 'GBP', period: 'month' as const }),
      scholarship_info: verified('Fixture scholarship'),
      min_gpa_rule: verified({ scale: 'cgpa_4' as const, min: 3 }),
      language_req: likely({ ielts_overall: 6.5 }),
      tests_required: likely('None'),
      lor_count: conflicting(2, 3),
      sop_requirements: unverified('An SOP'),
      research_considered: verified('Fixture research note', 400),
      conditional_admission: verified({ scale: 'cgpa_4' as const, min: 2.5, text: 'Fixture route below the minimum' }),
      language_waiver: verified('Fixture: waiver with a medium-of-instruction letter'),
    });
    const c = computeCoverage(p, now);
    expect(c.total).toBe(20);
    expect(c.verified).toBe(11);
    expect(c.byKey.eligibility_note).toBe('Verified');
    expect(c.byKey.conditional_admission).toBe('Verified');
    expect(c.byKey.language_waiver).toBe('Verified');
    expect(c.likely).toBe(3); // language, tests, research (verbatim but older than 30 days)
    expect(c.conflict).toBe(1);
    expect(c.unverified).toBe(5);
    expect(coverageLine(c)).toBe('11 of 20 fields verified');
    expect(coverageDetail(c)).toBe('3 likely · 1 with conflicting sources · 5 not verified yet');
  });

  it('uses the singular for one field and an empty detail when nothing else to say', () => {
    const c = { total: 1, verified: 1, likely: 0, conflict: 0, unverified: 0, byKey: {} };
    expect(coverageLine(c)).toBe('1 of 1 field verified');
    expect(coverageDetail(c)).toBe('');
  });
});

describe('reportFieldOptions', () => {
  it('offers the applicable fields with their labels', () => {
    const opts = reportFieldOptions(makeProgram());
    expect(opts).toHaveLength(17);
    expect(opts[0]).toEqual({ key: 'eligibility_note', label: 'Who this course is for' });
    expect(opts[1]).toEqual({ key: 'intake', label: 'Intake' });
    expect(opts.map((o) => o.key)).toContain('admissions_email');
    expect(opts).toContainEqual({ key: 'conditional_admission', label: 'Route below the minimum' });
    expect(opts).toContainEqual({ key: 'language_waiver', label: 'English test waiver' });
  });
});
