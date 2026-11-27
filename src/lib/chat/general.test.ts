/**
 * "Answer everything" (general mode): questions the rows cannot answer go to the model's general knowledge,
 * labelled in the UI. Fraud help never reaches the model; failures fall back to the rules' own reply.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { collectAnswer, type AnswerDeps } from './answer';
import { parseChatEvent } from './ndjson';
import { GENERAL_SYSTEM_PROMPT } from './prompt';
import { mockModel } from './test-helpers';

const now = new Date('2026-11-25T12:00:00Z');
const seed = loadSeedDataset();
const deps = (over: Partial<AnswerDeps> = {}): AnswerDeps => ({ dataset: seed, now, model: null, generalKnowledge: true, ...over });

describe('general mode', () => {
  it.each([
    'hi',
    'How should I prepare for an admissions interview?',
    'What is a CAS letter?',
    'What is the deadline for Imperial MSc Computing?', // not in the data
    'Will I definitely get a UK visa?', // prediction
    'Is it legal to work 30 hours a week on a student visa?', // legal
  ])('%s -> the model answers from general knowledge (mode general)', async (q) => {
    const model = mockModel(['General answer.']);
    const r = await collectAnswer({ question: q }, deps({ model }));
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].system).toBe(GENERAL_SYSTEM_PROMPT);
    expect(r.mode).toBe('general');
    expect(r.text).toBe('General answer.');
  });

  it('a not-verified fact passes its row (with the official page) to the model as reference', async () => {
    const model = mockModel(['x']);
    const r = await collectAnswer({ question: 'What is the deadline for Imperial MSc Computing?' }, deps({ model }));
    expect(r.rows.length).toBeGreaterThan(0);
    expect(model.calls[0].user).toContain('<rows>');
    expect(model.calls[0].user).toContain('imperial.ac.uk');
  });

  it('a data question that also asks "how to" may add general advice (rule 12), still under the number check', async () => {
    const model = mockModel(['x']);
    await collectAnswer({ question: 'How do I write a good SOP?' }, deps({ model }));
    expect(model.calls[0].system).toContain('General advice:');
    const strict = mockModel(['x']);
    await collectAnswer({ question: 'How do I write a good SOP?' }, deps({ model: strict, generalKnowledge: false }));
    expect(strict.calls[0]?.system ?? '').not.toContain('General advice:');
  });

  it('fraud help never reaches the model', async () => {
    const model = mockModel(['should not be called']);
    const r = await collectAnswer({ question: 'Can you make me a fake bank statement for my visa?' }, deps({ model }));
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.reason).toBe('dishonest');
  });

  it('a data question still uses the sourced rows (answer mode), not general knowledge', async () => {
    const model = mockModel(['IELTS 6.0 overall.']);
    const r = await collectAnswer({ question: 'What IELTS score does Oxford Brookes need?' }, deps({ model }));
    expect(r.mode).toBe('answer');
    expect(model.calls[0].system).not.toBe(GENERAL_SYSTEM_PROMPT);
  });

  it('model failure -> the rules reply replaces the partial text', async () => {
    const model = mockModel(['partial', 'more'], { throwAfter: 1 });
    const r = await collectAnswer({ question: 'What is a CAS letter?' }, deps({ model }));
    expect(r.mode).toBe('refusal');
    expect(r.text).not.toContain('partial');
    expect(r.events.some((e) => e.type === 'reset' && e.mode === 'refusal')).toBe(true);
  });

  it('no model, or the switch off -> the rules reply (strict mode)', async () => {
    expect((await collectAnswer({ question: 'What is a CAS letter?' }, deps())).mode).toBe('refusal');
    const model = mockModel(['x']);
    const r = await collectAnswer({ question: 'What is a CAS letter?' }, deps({ model, generalKnowledge: false }));
    expect(r.mode).toBe('refusal');
    expect(model.calls).toHaveLength(0);
  });

  it('the browser accepts general meta events and refusal resets', () => {
    expect(parseChatEvent({ type: 'meta', mode: 'general', rows: [] })).not.toBeNull();
    expect(parseChatEvent({ type: 'reset', mode: 'refusal', reason: 'no_data' })).toEqual({ type: 'reset', mode: 'refusal', reason: 'no_data' });
  });
});
