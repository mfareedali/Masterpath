/**
 * When a question or a consultant's message names a university but not one of its programmes, prefer the
 * programmes in the student's own field: a CS student asking "Imperial deadline?" means Imperial's CS course, not its
 * Software Engineering or AI course. Pure; used by the chat retrieval and the Consultant Check.
 *
 * - Only narrows: if none of the candidates is in the field, all of them stay (nothing is hidden).
 * - A programme the text names explicitly is chosen BEFORE this step (by name), whatever its field.
 * - No profile: the app's default field (Computer Science), the same default the profile form uses.
 */
import type { Program } from '../types';

export const DEFAULT_PREFERRED_FIELD = 'cs';

export function preferField<T extends Pick<Program, 'field'>>(programs: readonly T[], field: string | null | undefined): T[] {
  if (programs.length <= 1) return [...programs];
  const want = field || DEFAULT_PREFERRED_FIELD;
  const inField = programs.filter((p) => p.field === want);
  return inField.length > 0 ? inField : [...programs];
}
