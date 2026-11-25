import { describe, expect, it } from 'vitest';
import { conflicting, FIXED_NOW, likely, makeProgram, unverified, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import {
  buildChecklist,
  checklistStorageKey,
  parseChecked,
  progressText,
  serializeChecked,
  toggleChecked,
} from './checklist';

const now = FIXED_NOW;

describe('buildChecklist', () => {
  it('has the six items in order', () => {
    expect(buildChecklist(makeProgram(), now).map((i) => i.id)).toEqual(['sop', 'lor', 'cv', 'language', 'tests', 'transcript']);
  });

  it('never invents requirement numbers for the empty seed data', () => {
    for (const p of loadEmptySeedDataset().programs) {
      const items = buildChecklist(p, now);
      const lor = items.find((i) => i.id === 'lor')!;
      expect(lor.label).toBe('Letters of recommendation (LORs)');
      expect(lor.detail).toBe('Number of LORs not verified yet');
      for (const item of items) {
        expect(item.confidence).toBe('Unverified');
        expect(item.label).not.toMatch(/\d/);
        expect(item.detail).not.toMatch(/\d/);
      }
    }
  });

  it('uses the LOR count and texts from usable facts, with their confidence', () => {
    const items = buildChecklist(
      makeProgram({
        lor_count: verified(2),
        sop_requirements: likely('Fixture SOP, max two pages'),
        language_req: verified({ ielts_overall: 6.5, toefl_ibt: 90 }),
        tests_required: verified('Fixture: no GRE needed'),
        cv_requirements: verified('Fixture CV'),
      }),
      now,
    );
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.lor.label).toBe('Letters of recommendation: 2 letters');
    expect(byId.lor.confidence).toBe('Verified');
    expect(byId.sop.detail).toBe('Fixture SOP, max two pages');
    expect(byId.sop.confidence).toBe('Likely');
    expect(byId.language.detail).toBe('IELTS overall: 6.5; TOEFL iBT: 90');
    expect(byId.tests.detail).toBe('Fixture: no GRE needed');
    expect(byId.cv.detail).toBe('Fixture CV');
    expect(byId.transcript.confidence).toBe('Unverified');
  });

  it('does not use an unverified value (no source)', () => {
    const lor = buildChecklist(makeProgram({ lor_count: unverified(3) }), now).find((i) => i.id === 'lor')!;
    expect(lor.label).toBe('Letters of recommendation (LORs)');
    expect(lor.detail).toBe('Number of LORs not verified yet');
    expect(lor.confidence).toBe('Unverified');
  });

  it('flags conflicts instead of picking one value', () => {
    const lor = buildChecklist(makeProgram({ lor_count: conflicting(2, 3) }), now).find((i) => i.id === 'lor')!;
    expect(lor.confidence).toBe('Conflict');
    expect(lor.label).toBe('Letters of recommendation (LORs)');
    expect(lor.detail).toMatch(/Sources disagree/);
  });
});

describe('checklist storage helpers', () => {
  const ids = ['sop', 'lor', 'cv'];

  it('uses the mp_checklist_<programId> key', () => {
    expect(checklistStorageKey('fixture-msc-cs')).toBe('mp_checklist_fixture-msc-cs');
  });

  it('parses stored ids safely', () => {
    expect(parseChecked(null, ids)).toEqual([]);
    expect(parseChecked('', ids)).toEqual([]);
    expect(parseChecked('not json', ids)).toEqual([]);
    expect(parseChecked('{"sop":true}', ids)).toEqual([]);
    expect(parseChecked('["cv","sop","unknown",3]', ids)).toEqual(['sop', 'cv']);
  });

  it('toggles and serialises', () => {
    expect(toggleChecked([], 'sop')).toEqual(['sop']);
    expect(toggleChecked(['sop', 'cv'], 'sop')).toEqual(['cv']);
    expect(serializeChecked(['sop', 'sop', 'cv'])).toBe('["sop","cv"]');
    expect(parseChecked(serializeChecked(toggleChecked(['lor'], 'cv')), ids)).toEqual(['lor', 'cv']);
  });

  it('describes progress', () => {
    expect(progressText(2, 6)).toBe('2 of 6 done');
  });
});
