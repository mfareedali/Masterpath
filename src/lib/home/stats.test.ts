import { describe, expect, it } from 'vitest';
import { FIXED_NOW, makeProgram, unverified, verified } from '../test-fixtures';
import { homeStats } from './stats';

describe('homeStats', () => {
  it('counts active programs, distinct universities and countries; ignores ruled-out programs', () => {
    const s = homeStats(
      [
        makeProgram({ id: 'a', institution_id: 'u1', country: 'UK' }),
        makeProgram({ id: 'b', institution_id: 'u1', country: 'UK' }),
        makeProgram({ id: 'c', institution_id: 'u2', country: 'DE' }),
        makeProgram({ id: 'd', institution_id: 'u3', country: 'US', status: 'ruled_out' }),
      ],
      FIXED_NOW,
    );
    expect(s.programs).toBe(3);
    expect(s.universities).toBe(2);
    expect(s.countries).toBe(2);
  });

  it('a fact is verified only when computeConfidence says so today (stale = not verified)', () => {
    const fresh = homeStats([makeProgram({ tuition: verified({ amount: 1, currency: 'GBP', period: 'year' }) })], FIXED_NOW);
    const stale = homeStats([makeProgram({ tuition: verified({ amount: 1, currency: 'GBP', period: 'year' }, 400) })], FIXED_NOW);
    const none = homeStats([makeProgram({ tuition: unverified() })], FIXED_NOW);
    expect(fresh.facts.verified - none.facts.verified).toBe(1);
    expect(stale.facts.verified).toBe(none.facts.verified);
    expect(fresh.facts.total).toBe(none.facts.total);
  });
});
