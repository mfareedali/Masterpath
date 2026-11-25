/**
 * Demo personas (fictional). Pure planning logic for the "Try the demo" buttons; the client component
 * applies the plan with saveProfile / saveStrengths. See DECISIONS.md #16.
 */
import { PERSONA_A, PERSONA_B, PERSONA_B_STRENGTHS } from '../profile';
import type { Profile, Strengths } from '../types';
import { EMPTY_STRENGTHS, isDemoStrengths } from './strengths-form';

export type PersonaId = 'A' | 'B';

export const PERSONAS: { id: PersonaId; title: string; summary: string }[] = [
  { id: 'A', title: 'Persona A', summary: '2.5 CGPA, CS, limited budget' },
  { id: 'B', title: 'Persona B', summary: 'Same as A, plus a preprint and a supervisor (research-led route)' },
];

export interface PersonaPlan {
  profile: Profile;
  /** Strengths to save, or null to leave stored strengths untouched. */
  strengths: Strengths | null;
}

/**
 * What loading a persona writes to this device.
 *  - B: profile + the fictional preprint/supervisor strengths.
 *  - A: profile only; if the stored strengths are persona B's demo strengths they are cleared,
 *       so persona A never shows B's fictional preprint. A student's own strengths are left alone.
 */
export function personaPlan(id: PersonaId, currentStrengths: Strengths | null): PersonaPlan {
  if (id === 'B') {
    return { profile: { ...PERSONA_B }, strengths: structuredCloneStrengths(PERSONA_B_STRENGTHS) };
  }
  return {
    profile: { ...PERSONA_A },
    strengths: isDemoStrengths(currentStrengths) ? structuredCloneStrengths(EMPTY_STRENGTHS) : null,
  };
}

function structuredCloneStrengths(s: Strengths): Strengths {
  return JSON.parse(JSON.stringify(s)) as Strengths;
}
