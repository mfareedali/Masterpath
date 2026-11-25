/**
 * Demo-critical invariants on TODAY's real seed data (/data/*.seed.json).
 * If a data change breaks the live demo story, these tests say so. Behaviour with empty data is tested
 * elsewhere against the frozen fixture (loadEmptySeedDataset).
 */
import { describe, expect, it } from 'vitest';
import { collectAnswer } from '@/lib/chat/answer';
import { computeConfidence } from '@/lib/confidence';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { computeFit } from '@/lib/fit';
import { buildPlanB, strengthsForProfile } from '@/lib/planb';
import { PERSONA_A } from '@/lib/profile';

const now = new Date('2026-11-25T12:00:00Z');
const seed = loadSeedDataset();
const program = (id: string) => {
  const p = seed.programs.find((x) => x.id === id);
  if (!p) throw new Error(`missing ${id}`);
  return p;
};

describe('live seed: demo persona A (CGPA 2.5/4) has verified "Below minimum" targets', () => {
  it.each([
    ['brookes-msc-cs', 'Likely'], // the page gives GPA 2.7 without naming the scale, so it is read as /4.0 (inferred)
    ['usf-mscs', 'Verified'],
  ])('%s is Below minimum from a %s official minimum', (id, expected) => {
    const p = program(id);
    expect(computeConfidence(p.min_gpa_rule, now)).toBe(expected);
    const fit = computeFit(PERSONA_A, p, seed.conversionRules, now);
    expect(fit.label).toBe('Below minimum');
    expect(fit.required?.source_url).toMatch(/^https:\/\//);
  });

  it('programs without a published minimum stay "Competitive range unknown" (never guessed)', () => {
    const fit = computeFit(PERSONA_A, program('tum-msc-informatics'), seed.conversionRules, now);
    expect(fit.reason.code).toBe('MIN_NOT_VERIFIED');
  });
});

describe('live seed: Plan B for persona A', () => {
  const plan = buildPlanB({
    profile: PERSONA_A,
    programs: seed.programs,
    institutions: seed.institutions,
    rules: seed.conversionRules,
    fx: seed.fxRates,
    now,
    strengths: strengthsForProfile(PERSONA_A),
  });

  it('has Below-minimum targets to choose from', () => {
    expect(plan.belowMinimum.map((t) => t.program.id)).toEqual(expect.arrayContaining(['brookes-msc-cs', 'usf-mscs']));
  });

  it('warns on the QMUL pre-master\'s route instead of pushing it', () => {
    const r = [...plan.ranked, ...plan.notRanked].find((x) => x.program.id === 'qmul-premasters-cs');
    expect(r).toBeDefined();
    expect(r!.gate.warnings.map((w) => w.message)).toContain('The official page does not guarantee progression to the Masters');
  });

  it('never offers the ruled-out LJMU program, and always includes Improve and reapply', () => {
    expect([...plan.ranked, ...plan.notRanked].some((x) => x.program.id === 'ljmu-msc-cs')).toBe(false);
    expect(plan.improve.steps.length).toBeGreaterThan(0);
  });
});

describe('live seed: the chat refusal demo', () => {
  it('refuses the Imperial MSc Computing deadline (not in the database) without calling the model', async () => {
    const calls: unknown[] = [];
    const model = {
      stream: async function* (req: unknown) {
        calls.push(req);
        yield { type: 'text' as const, delta: 'The deadline is 6 January 2027.' };
      },
    };
    expect(program('imperial-msc-computing').deadline.value).toBeNull();
    const r = await collectAnswer(
      { question: 'What is the application deadline for Imperial MSc Computing?' },
      { dataset: seed, now, model: model as never },
    );
    expect(calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.text).toMatch(/not verified/i);
    expect(r.text).not.toMatch(/\b20\d\d\b/);
  });
});

describe('live seed: Oxford Brookes Pakistan notice is shown with evidence', () => {
  it('status_note is Verified and quotes the official page', () => {
    const f = program('brookes-msc-cs').status_note;
    expect(computeConfidence(f, now)).toBe('Verified');
    expect(f.evidence_snippet).toMatch(/Pakistan/);
  });
});
