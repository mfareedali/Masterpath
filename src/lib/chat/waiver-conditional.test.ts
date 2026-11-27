/**
 * New program fields in the chat: language_waiver ("IELTS waiver", "without IELTS", "MOI", "medium of instruction",
 * "English proficiency letter") and conditional_admission ("low CGPA", "conditional", "provisional",
 * "below the minimum", "with 2.5"). Asked directly they are normal rows; beside the English requirement / minimum
 * grade of a named program they are companion rows, added only when sourced. They never decide anything:
 * the chat shows no fit label, and a missing companion never causes a refusal.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { FIXED_NOW, likely, loadEmptySeedDataset, unverified, verified } from '@/lib/test-fixtures';
import { collectAnswer } from './answer';
import { detectFields, normalizeQuestion } from './fields';
import { detectUnsafeIntent, guard } from './guard';
import { SYSTEM_PROMPT } from './prompt';
import { retrieve } from './retrieve';
import { fixtureDataset, mockModel } from './test-helpers';

const seed = loadSeedDataset();
const now = new Date('2026-11-24T12:00:00Z');
const fieldsOf = (q: string) => detectFields(normalizeQuestion(q)).fields;
const rowsOf = (q: string, scope = {}) => retrieve(q, scope, seed, now).rows;

describe('detectFields', () => {
  it.each([
    'Is there an IELTS waiver at CMU?',
    'Can I apply without IELTS?',
    'Does ETH accept MOI?',
    'Is a medium of instruction certificate accepted?',
    'Will Toronto accept an English proficiency letter?',
    'Can the IELTS be waived for a Pakistani degree?',
    'Do I need IELTS or is there an exemption?',
    'My degree was taught in English, do I need TOEFL?',
  ])('"%s" -> language_waiver first, never a fee waiver', (q) => {
    const f = fieldsOf(q);
    expect(f[0]).toBe('language_waiver');
    expect(f).not.toContain('scholarship_info');
  });

  it('a tuition / fee waiver is still a funding question', () => {
    expect(fieldsOf('Is there a tuition waiver at USF?')).toEqual(['scholarship_info']);
    expect(fieldsOf('Any fee waiver?')).toEqual(['scholarship_info']);
  });

  it.each([
    'Does NYIT offer conditional admission?',
    'Is there provisional admission at UCCS?',
    'Which universities accept low CGPA?',
    'What if I am below the minimum grade?',
    'What can I do with 2.5 CGPA?',
    'Options with a CGPA of 2.4?',
  ])('"%s" -> conditional_admission only (the grade words go with it)', (q) => {
    expect(fieldsOf(q)).toEqual(['conditional_admission']);
  });

  it('a minimum asked for separately stays an explicit field next to the route', () => {
    expect(fieldsOf('My CGPA is below the minimum, any option?')).toEqual(['conditional_admission', 'min_gpa_rule']);
  });

  it('"with 2 years of experience" is not a grade', () => {
    expect(fieldsOf('Can I apply to TUM with 2 years of experience?')).not.toContain('conditional_admission');
  });

  it('plain requirement questions are unchanged', () => {
    expect(fieldsOf('What IELTS score do I need?')).toEqual(['language_req']);
    expect(fieldsOf('What is the minimum CGPA for ETH?')).toEqual(['min_gpa_rule']);
  });

  it('asking for this student’s outcome is still a prediction refusal', () => {
    expect(detectUnsafeIntent('Can I get conditional admission at NYIT?')).toBe('prediction');
    expect(detectUnsafeIntent('Can I get admission at TUM with a 2.5 CGPA?')).toBe('prediction');
    expect(detectUnsafeIntent('Does NYIT offer conditional admission?')).toBeNull();
    expect(detectUnsafeIntent('Is there an IELTS waiver at CMU?')).toBeNull();
  });
});

describe('language_waiver on the live seed', () => {
  it('"Does CMU accept MOI?" -> the Verified waiver row (no waivers, MOI not accepted)', () => {
    const [row, ...rest] = rowsOf('Does CMU accept MOI?');
    expect(rest).toEqual([]); // CMU's English requirement is not verified, so no companion
    expect(row).toMatchObject({ id: 'cmu-mscs:language_waiver', label: 'English test waiver', confidence: 'Verified' });
    expect(row.value).toMatch(/medium-of-instruction \(MOI\) certificates are not accepted/);
  });

  it('"Is an English proficiency letter accepted at Toronto?" -> waiver row + the sourced English requirement beside it', () => {
    expect(rowsOf('Is an English proficiency letter accepted at Toronto?').map((r) => r.id)).toEqual([
      'utoronto-mscac:language_waiver',
      'utoronto-mscac:language_req',
    ]);
  });

  it('"Can I apply to TUM without IELTS?" -> TUM has no waiver data: code refusal, model never called', async () => {
    const model = mockModel(['TUM waives IELTS.']);
    const r = await collectAnswer({ question: 'Can I apply to TUM without IELTS?' }, { dataset: seed, now, model });
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.reason).toBe('not_verified');
    expect(r.text).toMatch(/English test waiver rule for MSc Informatics at Technical University of Munich is not verified yet/);
  });

  it('a list across programs shows only the programs whose waiver rule is sourced (no "not verified" padding)', () => {
    const rows = rowsOf('Which universities accept a medium of instruction letter?');
    expect(rows.map((r) => r.entity_id).sort()).toEqual(
      ['cmu-mscs', 'ethz-msc-cs', 'imperial-msc-computing', 'nyit-mscs', 'uiuc-mscs', 'utoronto-mscac', 'wuerzburg-msc-cs'].sort(),
    );
    expect(rows.every((r) => r.field === 'language_waiver' && r.confidence === 'Verified')).toBe(true);
  });

  it('companion: the waiver sits beside a usable English requirement, and never beside an empty one', () => {
    expect(rowsOf('What IELTS score does Toronto need?').map((r) => r.field)).toEqual(['language_req', 'language_waiver']);
    // CMU's requirement is not verified: the refusal stays a refusal (the companion is not added).
    expect(rowsOf('What IELTS score does CMU need?').map((r) => r.field)).toEqual(['language_req']);
    // Brookes has no waiver in the data: the /ask chip still returns exactly one row.
    expect(rowsOf('What IELTS score does Oxford Brookes need?').map((r) => r.id)).toEqual(['brookes-msc-cs:language_req']);
  });

  it('no companion rows in a list across every program', () => {
    expect(rowsOf('What IELTS score do I need?').map((r) => r.field)).not.toContain('language_waiver');
  });
});

describe('conditional_admission on the live seed', () => {
  it('"Does NYIT offer conditional admission?" -> the official route in its own words, plus the lowest grade it names', () => {
    const rows = rowsOf('Does NYIT offer conditional admission?');
    // The programme's own minimum (2.85, verified 2026-11-27) is returned beside the route.
    expect(rows.map((r) => r.id)).toContain('nyit-mscs:conditional_admission');
    const row = rows.find((r) => r.id === 'nyit-mscs:conditional_admission')!;
    expect(row).toMatchObject({ label: 'Conditional or provisional admission', confidence: 'Verified' });
    expect(row.value).toMatch(/^Undergraduate GPA between 2\.5 and 2\.84: /);
    expect(row.value).toMatch(/Lowest grade this route names: 2\.5 \(CGPA \(out of 4\.0\)\)\.$/);
  });

  it('UCCS names no floor: the text only, no invented lowest grade', () => {
    const [row] = rowsOf('Is there provisional admission at UCCS?');
    expect(row.id).toBe('uccs-mscs:conditional_admission');
    expect(row.value).toMatch(/No lower floor is stated\.$/);
    expect(row.value).not.toMatch(/Lowest grade/);
  });

  it('Würzburg is on the German scale: the weakest grade it names, with the scale spelled out', () => {
    const [row] = rowsOf('Is there provisional admission at Wurzburg?');
    expect(row.value).toMatch(/Weakest grade this route names: 4 \(German grade \(1\.0 best – 4\.0 pass\)\)\.$/);
  });

  it('"Which universities accept low CGPA?" and "with 2.5" list exactly the three official routes', () => {
    for (const q of ['Which universities accept low CGPA?', 'What can I do with 2.5 CGPA?']) {
      expect(rowsOf(q).map((r) => r.id), q).toEqual([
        'wuerzburg-msc-cs:conditional_admission',
        'nyit-mscs:conditional_admission',
        'uccs-mscs:conditional_admission',
      ]);
    }
  });

  it('a minimum that is not verified stays a refusal: the conditional route is not attached to rescue it', () => {
    const d = guard('What is the minimum GPA for Wurzburg?', retrieve('What is the minimum GPA for Wurzburg?', {}, seed, now));
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') expect(d.rows.map((r) => r.field)).toEqual(['min_gpa_rule']);
  });

  it('no row ever carries a fit label or an admission chance', () => {
    const shown = JSON.stringify([
      ...rowsOf('Which universities accept low CGPA?'),
      ...rowsOf('Which universities accept a medium of instruction letter?'),
    ]);
    // Fit labels are decided by the fit engine on other pages; the chat never produces one.
    expect(shown).not.toMatch(/Meets minimum|Below minimum|Competitive range unknown/);
    // No outcome wording at all: code adds none, and the stored NYIT text uses the snippet's own word ("opportunity").
    expect(shown).not.toMatch(/chance/i);
    expect(shown).toContain('you may be given the opportunity to demonstrate qualifications for full matriculation');
  });

  it('the prompt says a route or waiver never means the student qualifies or meets the minimum', () => {
    expect(SYSTEM_PROMPT).toMatch(/Never say the student qualifies for it, and never say it changes whether they meet the regular minimum/);
  });
});

describe('fixtures', () => {
  it('companion only when sourced: a Likely conditional route is added beside a usable minimum, an Unverified one is not', () => {
    const gpa = verified({ scale: 'cgpa_4' as const, min: 3, text: 'Fixture minimum' });
    const withRoute = fixtureDataset({ min_gpa_rule: gpa, conditional_admission: likely({ scale: 'cgpa_4' as const, min: 2.5, text: 'Fixture route' }) });
    expect(retrieve('Minimum GPA at Fixture University?', {}, withRoute, FIXED_NOW).rows.map((r) => r.field)).toEqual([
      'min_gpa_rule',
      'conditional_admission',
    ]);
    const unsourced = fixtureDataset({ min_gpa_rule: gpa, conditional_admission: unverified({ scale: 'cgpa_4' as const, min: 2, text: 'x' }) });
    expect(retrieve('Minimum GPA at Fixture University?', {}, unsourced, FIXED_NOW).rows.map((r) => r.field)).toEqual(['min_gpa_rule']);
  });

  it('asked directly for a named program with no data -> a "not verified yet" row, never dropped', () => {
    const r = retrieve('Is there an IELTS waiver at Fixture University?', {}, fixtureDataset(), FIXED_NOW);
    expect(r.rows.map((x) => [x.field, x.value, x.confidence])).toEqual([['language_waiver', null, 'Unverified']]);
  });

  it('frozen empty seed: a list with nothing sourced keeps every row, so the refusal names them', () => {
    const empty = loadEmptySeedDataset();
    const q = 'Which universities accept MOI?';
    const d = guard(q, retrieve(q, {}, empty, FIXED_NOW));
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') expect(d.text).toMatch(/English test waiver rule is not verified yet for any of the 14 programs/);
  });
});
