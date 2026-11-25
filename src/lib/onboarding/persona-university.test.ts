import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '../data/seed-source';
import { PERSONA_A, PERSONA_B, PERSONA_B_STRENGTHS } from '../profile';
import { makeInstitution, verified } from '../test-fixtures';
import { personaPlan } from './persona';
import { EMPTY_STRENGTHS } from './strengths-form';
import { findHomeInstitution, homeUniversityOptions, recognitionLabel } from './university';

describe('personaPlan', () => {
  it('persona B saves the fictional strengths', () => {
    const plan = personaPlan('B', null);
    expect(plan.profile).toEqual(PERSONA_B);
    expect(plan.strengths).toEqual(PERSONA_B_STRENGTHS);
    expect(plan.strengths).not.toBe(PERSONA_B_STRENGTHS); // a copy, never the shared constant
  });

  it('persona A clears only demo strengths', () => {
    expect(personaPlan('A', null)).toEqual({ profile: PERSONA_A, strengths: null });
    expect(personaPlan('A', JSON.parse(JSON.stringify(PERSONA_B_STRENGTHS))).strengths).toEqual(EMPTY_STRENGTHS);
    const own = { ...EMPTY_STRENGTHS, other: ['Fixture award'] };
    expect(personaPlan('A', own).strengths).toBeNull();
  });

  it('persona profiles are marked and contain no passport/ID fields', () => {
    expect(personaPlan('A', null).profile.persona).toBe('A');
    expect(personaPlan('B', null).profile.persona).toBe('B');
    expect(Object.keys(personaPlan('B', null).profile).join(' ')).not.toMatch(/passport|cnic|id_number/i);
  });
});

describe('home university lookup', () => {
  const home = makeInstitution({ id: 'fixture-home', name: 'Fixture Home University', country: 'PK', kind: 'home' });
  const abroad = makeInstitution({ id: 'fixture-abroad', name: 'Fixture University', kind: 'destination' });
  const list = [abroad, home];

  it('finds by id, then by case-insensitive name', () => {
    expect(findHomeInstitution(list, { universityId: 'fixture-home' })).toBe(home);
    expect(findHomeInstitution(list, { universityName: '  fixture HOME university ' })).toBe(home);
    expect(findHomeInstitution(list, { universityId: 'missing', universityName: 'Fixture Home University' })).toBe(home);
  });

  it('ignores destination universities and unknown names', () => {
    expect(findHomeInstitution(list, { universityId: 'fixture-abroad' })).toBeNull();
    expect(findHomeInstitution(list, { universityName: 'Fixture University' })).toBeNull();
    expect(findHomeInstitution(list, { universityName: 'Unknown' })).toBeNull();
    expect(findHomeInstitution(list, {})).toBeNull();
  });

  it('lists only home universities, sorted', () => {
    const second = makeInstitution({ id: 'a-home', name: 'Another Fixture College', kind: 'home', country: 'PK' });
    expect(homeUniversityOptions([...list, second])).toEqual([
      { id: 'a-home', name: 'Another Fixture College' },
      { id: 'fixture-home', name: 'Fixture Home University' },
    ]);
  });

  it('works on the seed data: the demo university is found and its facts are unverified', () => {
    const { institutions } = loadSeedDataset();
    const options = homeUniversityOptions(institutions);
    expect(options.map((o) => o.id)).toContain(PERSONA_A.university_id);
    const inst = findHomeInstitution(institutions, { universityId: PERSONA_A.university_id });
    expect(inst?.name).toBe(PERSONA_A.university_name);
    expect(inst?.hec_status.value).toBeNull();
  });

  it('labels recognition statuses in plain words', () => {
    expect(recognitionLabel('listed')).toBe('Listed');
    expect(recognitionLabel('not_listed')).toBe('Not listed');
    expect(recognitionLabel(verified('listed' as const).value!)).toBe('Listed');
  });
});
