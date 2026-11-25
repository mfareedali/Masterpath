/**
 * Proposal #21 (chat part): a misspelled university name ("Imprial", "Brooks", "Toranto") is never answered with a
 * guessed match. When exactly one institution is a near miss, the chat refuses in code (no model call):
 * "I couldn't find 'Imprial' in MastersPath. Did you mean Imperial College London?" and sends a suggestion that
 * the chip resends as the corrected question.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { FIXED_NOW, makeInstitution, makeProgram, verified } from '@/lib/test-fixtures';
import { collectAnswer, type AnswerDeps } from './answer';
import { applyChatEvent, initialAnswerState, readSuggestion } from './client-state';
import { guard, unknownNameText } from './guard';
import { normalizeQuestion } from './fields';
import { retrieve, suggestInstitution, type ChatDataset } from './retrieve';
import { mockModel } from './test-helpers';

const seed = loadSeedDataset();
const now = new Date('2026-11-24T12:00:00Z');
const deps = (over: Partial<AnswerDeps> = {}): AnswerDeps => ({ dataset: seed, now, model: null, ...over });
const suggest = (q: string) => suggestInstitution(q, normalizeQuestion(q), seed.institutions);

describe('suggestInstitution', () => {
  it.each([
    ['What is the deadline for Imprial?', 'Imprial', 'Imperial College London', 'What is the deadline for Imperial?'],
    ['Brooks ki fees kitni hai?', 'Brooks', 'Oxford Brookes University', 'Brookes ki fees kitni hai?'],
    ['Toranto deadline', 'Toranto', 'University of Toronto', 'Toronto deadline'],
    ['IELTS for Carnagie Mellon?', 'Carnagie', 'Carnegie Mellon University', 'IELTS for Carnegie Mellon?'],
    ['Cardif tuition', 'Cardif', 'Cardiff University', 'Cardiff tuition'],
  ])('"%s" -> did you mean %s -> %s', (q, typed, label, question) => {
    expect(suggest(q)).toEqual({ typed, label, question });
  });

  it.each([
    'TUM ki fees kitni hai?', // acronyms never fuzzy-match
    'Oxford deadline', // the University of Oxford is not Oxford Brookes: never suggested
    'What is the weather like in Lahore?',
    'How long can I work in the UK after my Masters?',
    'Is the course taught in English?',
  ])('"%s" -> no suggestion', (q) => {
    expect(suggest(q)).toBeNull();
  });
});

describe('retrieve + guard', () => {
  it('a near miss retrieves NO rows (never a guessed answer, never a list of every program)', () => {
    const r = retrieve('What is the deadline for Imprial?', {}, seed, now);
    expect(r.rows).toEqual([]);
    expect(r.programIds).toEqual([]);
    expect(r.suggestion?.label).toBe('Imperial College London');
  });

  it('even on a program page, a near miss is asked about, not answered with the page’s program', () => {
    const r = retrieve('Is the deadline for Imprial known?', { programId: 'tum-msc-informatics' }, seed, now);
    expect(r.rows).toEqual([]);
    expect(r.suggestion?.question).toBe('Is the deadline for Imperial known?');
  });

  it('exact names are untouched: "Oxford Brooks" is a known spelling, and TUM still works', () => {
    const brooks = retrieve('Oxford Brooks ki fees kitni hai?', {}, seed, now);
    expect(brooks.suggestion).toBeNull();
    expect(brooks.programIds).toEqual(['brookes-msc-cs']);
    expect(brooks.rows.map((r) => r.id)).toEqual(['brookes-msc-cs:tuition']);
    expect(retrieve('TUM ki fees kitni hai?', {}, seed, now).programIds).toEqual(['tum-msc-informatics']);
  });

  it('guard: refusal "unknown_name" with the exact wording, no rows, no pointers, the suggestion attached', () => {
    const q = 'What is the deadline for Imprial?';
    const d = guard(q, retrieve(q, {}, seed, now));
    expect(d).toEqual({
      mode: 'refusal',
      reason: 'unknown_name',
      text: "I couldn't find 'Imprial' in MastersPath. Did you mean Imperial College London?",
      rows: [],
      pointers: [],
      suggestion: { typed: 'Imprial', label: 'Imperial College London', question: 'What is the deadline for Imperial?' },
    });
    expect(unknownNameText({ typed: 'Toranto', label: 'University of Toronto', question: 'x' })).toBe(
      "I couldn't find 'Toranto' in MastersPath. Did you mean University of Toronto?",
    );
  });

  it('a prediction is still refused as a prediction first', () => {
    const q = 'Will Imprial accept me?';
    const d = guard(q, retrieve(q, {}, seed, now));
    expect(d.mode === 'refusal' && d.reason).toBe('prediction');
  });
});

describe('answerQuestion: refusal mode, no model call; the corrected question is answered', () => {
  it('streams meta(refusal, unknown_name, suggestion) -> text -> done and never calls the model', async () => {
    const model = mockModel(['Imperial deadline is 15 January.']);
    const r = await collectAnswer({ question: 'What is the deadline for Imprial?' }, deps({ model }));
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.reason).toBe('unknown_name');
    expect(r.text).toBe("I couldn't find 'Imprial' in MastersPath. Did you mean Imperial College London?");
    expect(r.rows).toEqual([]);
    expect(r.events.map((e) => e.type)).toEqual(['meta', 'text', 'done']);
    const meta = r.events[0];
    expect(meta.type === 'meta' && meta.suggestion).toEqual({
      typed: 'Imprial',
      label: 'Imperial College London',
      question: 'What is the deadline for Imperial?',
    });
  });

  it('the chip’s corrected question gets the normal answer (here: the Imperial refusal demo, with its official page)', async () => {
    const r = await collectAnswer({ question: 'What is the deadline for Imperial?' }, deps({ model: mockModel() }));
    expect(r.reason).toBe('not_verified');
    expect(r.rows.map((x) => x.id)).toEqual(['imperial-msc-computing:deadline']);
  });

  it('other refusals and answers carry no suggestion', async () => {
    for (const q of ['What is the deadline for Imperial MSc Computing?', 'Will I get a UK visa?', 'ETH deadline?']) {
      const r = await collectAnswer({ question: q }, deps());
      const meta = r.events[0];
      expect(meta.type === 'meta' && meta.suggestion, q).toBeUndefined();
    }
  });

  it('fixture: only institutions in the dataset are suggested, and a word too far from every name gets none', () => {
    const dataset: ChatDataset = {
      programs: [makeProgram({ institution_id: 'cardiff', deadline: verified('2027-01-15') })],
      institutions: [makeInstitution({ id: 'cardiff', name: 'Cardiff University' })],
      countryFacts: [],
    };
    expect(retrieve('Cardif deadline', {}, dataset, FIXED_NOW).suggestion?.label).toBe('Cardiff University');
    expect(retrieve('Imprial deadline', {}, dataset, FIXED_NOW).suggestion).toBeNull(); // Imperial is not in this dataset
    expect(retrieve('Crdf deadline', {}, dataset, FIXED_NOW).suggestion).toBeNull(); // short words never fuzzy-match
  });
});

describe('client state: the suggestion is read defensively', () => {
  const good = { typed: 'Imprial', label: 'Imperial College London', question: 'What is the deadline for Imperial?' };

  it('a refusal meta with a well-formed suggestion sets it', () => {
    const s = applyChatEvent(initialAnswerState(), { type: 'meta', mode: 'refusal', reason: 'unknown_name', rows: [], suggestion: good });
    expect(s.suggestion).toEqual(good);
  });

  it('malformed or oversized suggestions are dropped; non-refusal metas never carry one', () => {
    expect(readSuggestion({ ...good, question: 42 })).toBeNull();
    expect(readSuggestion({ ...good, question: 'x'.repeat(501) })).toBeNull();
    expect(readSuggestion({ ...good, label: '  ' })).toBeNull();
    expect(readSuggestion('Imperial')).toBeNull();
    const answer = applyChatEvent(initialAnswerState(), { type: 'meta', mode: 'answer', rows: [], suggestion: good });
    expect(answer.suggestion).toBeNull();
    expect(initialAnswerState().suggestion).toBeNull();
  });
});
