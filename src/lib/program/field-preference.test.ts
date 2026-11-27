/**
 * A university named without a programme means its programme in the student's field (chat and Consultant Check),
 * on the live seed where TUM, ETH, Imperial, Toronto and CMU have programmes in several fields.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { retrieve } from '@/lib/chat/retrieve';
import { runCheck } from '@/lib/consultant/compare';
import { preferField } from './field-preference';

const now = new Date('2026-11-27T12:00:00Z');
const seed = loadSeedDataset();
const ids = (question: string, field?: string | null) => [...new Set(retrieve(question, { field }, seed, now).programIds)];

describe('preferField', () => {
  const ps = [{ field: 'cs', id: 'a' }, { field: 'ee', id: 'b' }];
  it('keeps the programmes in the field, or all of them when none is in it', () => {
    expect(preferField(ps, 'ee').map((p) => p.id)).toEqual(['b']);
    expect(preferField(ps, 'other').map((p) => p.id)).toEqual(['a', 'b']);
    expect(preferField(ps, null).map((p) => p.id)).toEqual(['a']); // default field: Computer Science
    expect(preferField([ps[1]], 'cs').map((p) => p.id)).toEqual(['b']); // a single programme is never dropped
  });
});

describe('chat retrieval on the live seed', () => {
  it('"TUM deadline?" means the course in the student field', () => {
    expect(ids('What is the TUM deadline?')).toEqual(['tum-msc-informatics']);
    expect(ids('What is the TUM deadline?', 'ee')).toEqual(['tum-msc-communications-electronics-engineering']);
    expect(ids('What is the TUM deadline?', 'ds')).toEqual(['tum-msc-data-engineering-analytics']);
  });

  it('a programme named in the question wins over the field', () => {
    expect(ids('What is the deadline for Imperial Software Engineering?', 'cs')).toEqual(['imperial-msc-computing-se']);
  });

  it('cross-programme lists stay in the student field', () => {
    const rows = retrieve('Which deadlines are still open?', { field: 'ee' }, seed, now).rows.filter((r) => r.entity === 'program');
    expect(rows.length).toBeGreaterThan(0);
    const fields = new Set(rows.map((r) => seed.programs.find((p) => p.id === r.entity_id)?.field));
    expect([...fields]).toEqual(['ee']);
  });
});

describe('Consultant Check on the live seed', () => {
  it('a claim about "ETH" is checked against the course in the student field', () => {
    const programIds = (field: string | null) => runCheck('ETH deadline is 30 November', seed, now, field).claims.flatMap((c) => c.programIds ?? []);
    expect(programIds('ee')).toEqual(['ethz-msc-electrical-engineering']);
    expect(programIds(null)).toEqual(['ethz-msc-cs']);
  });
});
