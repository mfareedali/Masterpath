/**
 * The chat on TODAY's real seed data (/data/*.seed.json): the /ask suggestion chips, the new eligibility_note
 * field, student-facing notes, and the rule that review_note is never shown. Behaviour with empty data is tested
 * against the frozen fixture elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { computeConfidence } from '@/lib/confidence';
import { loadSeedDataset } from '@/lib/data/seed-source';
import type { Fact } from '@/lib/types';
import { ASK_SUGGESTIONS } from '@/app/ask/suggestions';
import { collectAnswer, type AnswerDeps } from './answer';
import { formatFallbackAnswer } from './fallback';
import { FIELD_INFO } from './fields';
import { countryRow, programRow, retrieve } from './retrieve';
import { mockModel } from './test-helpers';
import type { ProgramChatField } from './types';
import { unsupportedFacts } from './verify';

const now = new Date('2026-11-25T12:00:00Z');
const seed = loadSeedDataset();

function deps(over: Partial<AnswerDeps> = {}): AnswerDeps {
  return { dataset: seed, now, model: null, ...over };
}

describe('/ask suggestion chips behave as intended on the live seed', () => {
  it('the page shows exactly these four chips', () => {
    expect(ASK_SUGGESTIONS).toEqual([
      'What is the deadline for Imperial MSc Computing?',
      'What IELTS score does Oxford Brookes need?',
      'How long can I work in the UK after my Masters?',
      'Will I definitely get a UK visa?',
    ]);
  });

  it('1. Imperial deadline: refusal demo — not verified yet + the official page, the model is never called', async () => {
    const model = mockModel(['The deadline is 6 January 2027.']);
    const r = await collectAnswer({ question: ASK_SUGGESTIONS[0] }, deps({ model }));
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.reason).toBe('not_verified');
    expect(r.rows.map((x) => x.id)).toEqual(['imperial-msc-computing:deadline']);
    expect(r.text).toContain('https://www.imperial.ac.uk/study/courses/postgraduate-taught/computing/');
    expect(r.text).not.toMatch(/\d{4}|january|\bjan\b/i);
  });

  it('2. Brookes IELTS: answers from the Verified English requirement row', async () => {
    const r = await collectAnswer({ question: ASK_SUGGESTIONS[1] }, deps());
    expect(r.mode).toBe('fallback'); // no key in tests -> deterministic list from the rows
    expect(r.rows.map((x) => [x.id, x.confidence])).toEqual([['brookes-msc-cs:language_req', 'Verified']]);
    expect(r.text).toContain('IELTS 6.0 overall with 6.0 in all skills');
    expect(r.text).toContain('MSc Advanced Computer Science at Oxford Brookes University');
    expect(r.text).toContain('https://www.brookes.ac.uk/courses/postgraduate/advanced-computer-science');
  });

  it('3. UK work after study: the Verified Graduate visa row, with the not-advice line', async () => {
    const r = await collectAnswer({ question: ASK_SUGGESTIONS[2] }, deps());
    expect(r.mode).toBe('fallback');
    expect(r.rows.map((x) => [x.id, x.confidence])).toEqual([['uk-post-study-work', 'Verified']]);
    expect(r.text).toContain('https://www.gov.uk/graduate-visa');
    expect(r.text).toMatch(/not legal or immigration advice/i);
    expect(r.text).not.toMatch(/programme length/i);
  });

  it('4. "Will I definitely get a UK visa?": prediction refusal, no rows, no model', async () => {
    const model = mockModel(['You have a 90% chance.']);
    const r = await collectAnswer({ question: ASK_SUGGESTIONS[3] }, deps({ model }));
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.reason).toBe('prediction');
    expect(r.rows).toEqual([]);
    expect(r.text).toMatch(/can't predict/);
    expect(r.text).toMatch(/not legal or immigration advice/i);
  });

  it('… and still a prediction refusal without "definitely" (reviewer case)', async () => {
    const r = await collectAnswer({ question: 'Will I get a UK visa?' }, deps({ model: mockModel() }));
    expect(r.reason).toBe('prediction');
  });
});

describe('work after study on the live seed (reviewer curl cases)', () => {
  it('"How long can I stay in the UK after graduation?" -> the Verified Graduate visa row, not programme lengths', async () => {
    const r = await collectAnswer({ question: 'How long can I stay in the UK after graduation?' }, deps());
    expect(r.rows.map((x) => x.id)).toEqual(['uk-post-study-work']);
    expect(r.text).not.toMatch(/Programme length/);
  });

  it('"How long can I stay in Germany after my Masters?" -> refusal: work-after-study rule not verified yet', async () => {
    const model = mockModel();
    const r = await collectAnswer({ question: 'How long can I stay in Germany after my Masters?' }, deps({ model }));
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.reason).toBe('not_verified');
    expect(r.rows.map((x) => x.id)).toEqual(['de-post-study-work']);
    expect(r.text).toMatch(/work-after-study rule for Germany is not verified yet/);
    expect(r.text).not.toMatch(/24 months|2 years/);
  });
});

describe('eligibility_note (who the course is for) on the live seed', () => {
  it('"Can I apply to Imperial MSc Computing with a BS Computer Science degree?" returns the Verified eligibility row first', async () => {
    const q = 'Can I apply to Imperial MSc Computing with a BS Computer Science degree?';
    const r = await collectAnswer({ question: q }, deps());
    expect(r.mode).toBe('fallback');
    expect(r.rows[0]).toMatchObject({
      id: 'imperial-msc-computing:eligibility_note',
      label: 'Who this course is for',
      confidence: 'Verified',
      source_url: 'https://www.imperial.ac.uk/study/courses/postgraduate-taught/computing/',
    });
    expect(r.rows[0].value).toMatch(/subjects other than computing/);
    expect(r.text).toMatch(/Who this course is for \(MSc Computing at Imperial College London\): For graduates of subjects other than computing/);
  });

  it('QMUL pre-master’s: the Conversion MSc warning is returned for an eligibility question', () => {
    const rows = retrieve('Who can apply to the QMUL pre-masters?', {}, seed, now).rows;
    const elig = rows.find((x) => x.field === 'eligibility_note');
    expect(elig).toMatchObject({ entity_id: 'qmul-premasters-cs', confidence: 'Verified' });
    expect(elig?.value).toMatch(/not related to Computer Science/);
  });

  it('"Tell me about Imperial" includes the eligibility warning; programs without one get no empty row', () => {
    expect(retrieve('Tell me about Imperial', {}, seed, now).rows.map((x) => x.field)).toContain('eligibility_note');
    expect(retrieve('Tell me about TUM', {}, seed, now).rows.map((x) => x.field)).not.toContain('eligibility_note');
    expect(retrieve('Am I eligible for TUM?', {}, seed, now).rows.map((x) => x.field)).not.toContain('eligibility_note');
  });

  it('the eligibility warning never turns the Imperial deadline refusal into an answer', () => {
    expect(retrieve('What is the deadline for Imperial MSc Computing?', {}, seed, now).rows.map((x) => x.field)).toEqual(['deadline']);
  });
});

describe('student-facing notes on the live seed', () => {
  it('"ETH deadline?" mentions the 12:00 noon CET cut-off', async () => {
    const r = await collectAnswer({ question: 'ETH deadline?' }, deps());
    expect(r.rows[0].id).toBe('ethz-msc-cs:deadline');
    expect(r.rows[0].value).toBe(
      '30 Nov 2026 (5 days left) Note: Applications close at 12:00 noon CET on 30 November 2026. Late applications are not possible.',
    );
    expect(r.text).toContain('12:00 noon CET');
  });

  it('USF priority deadline, Würzburg semester contribution, Brookes fee year, CA half-day rule, US STEM OPT quote', () => {
    const value = (q: string, id: string) => retrieve(q, {}, seed, now).rows.find((x) => x.id === id)?.value ?? '';
    expect(value('USF deadline?', 'usf-mscs:deadline')).toMatch(/priority deadline of January 15/);
    expect(value('Würzburg tuition?', 'wuerzburg-msc-cs:tuition')).toMatch(/semester contribution/);
    expect(value('Brookes tuition?', 'brookes-msc-cs:tuition')).toMatch(/2027\/28 international fee/);
    expect(value('Canada citizenship rules?', 'ca-citizenship-rule')).toMatch(/0\.5 days/);
    expect(value('How long is OPT in the US?', 'us-post-study-work')).toMatch(/24-month extension of your post-completion OPT/);
  });

  it('review_note is NEVER part of any chat row (every program field and every country fact)', () => {
    const fields = Object.keys(FIELD_INFO).filter((f) => FIELD_INFO[f as keyof typeof FIELD_INFO].entity === 'program') as ProgramChatField[];
    const reviewNotes: string[] = [];
    const rows = [];
    for (const p of seed.programs) {
      const inst = seed.institutions.find((i) => i.id === p.institution_id);
      for (const f of fields) {
        const fact = p[f] as Fact<unknown>;
        if (fact?.review_note) reviewNotes.push(fact.review_note);
        for (const c of fact?.conflicts ?? []) if (c.review_note) reviewNotes.push(c.review_note);
        rows.push(programRow(p, inst, f, now));
      }
    }
    for (const cf of seed.countryFacts) {
      if (cf.review_note) reviewNotes.push(cf.review_note);
      rows.push(countryRow(cf.country, cf.key, cf, now));
    }
    expect(reviewNotes.length).toBeGreaterThan(10);
    const shown = JSON.stringify(rows);
    for (const n of reviewNotes) expect(shown).not.toContain(n);
  });

  it('the safety net accepts every live row repeated exactly (values, notes, dates, number words)', () => {
    const fields = Object.keys(FIELD_INFO).filter((f) => FIELD_INFO[f as keyof typeof FIELD_INFO].entity === 'program') as ProgramChatField[];
    const rows = [
      ...seed.programs.flatMap((p) => fields.map((f) => programRow(p, seed.institutions.find((i) => i.id === p.institution_id), f, now))),
      ...seed.countryFacts.map((cf) => countryRow(cf.country, cf.key, cf, now)),
    ];
    const failures = rows
      .map((r) => ({ id: r.id, bad: unsupportedFacts(formatFallbackAnswer([r]), [r]) }))
      .filter((x) => x.bad.length > 0);
    expect(failures).toEqual([]);
  });

  it('a note never makes an Unverified fact usable or sends its value to the browser (LJMU status)', async () => {
    const ljmu = seed.programs.find((p) => p.id === 'ljmu-msc-cs')!;
    expect(ljmu.status_note.note).toBeTruthy();
    expect(computeConfidence(ljmu.status_note, now)).toBe('Unverified');
    const r = await collectAnswer({ question: 'LJMU deadline?' }, deps());
    const status = r.rows.find((x) => x.field === 'status_note');
    expect(status).toMatchObject({ confidence: 'Unverified', value: null });
  });
});
