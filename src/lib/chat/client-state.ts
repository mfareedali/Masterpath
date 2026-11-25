/**
 * Folding streamed ChatEvents into the state of one answer (used by ChatPanel; pure and testable).
 */
import { MAX_QUESTION_CHARS } from './limits';
import type { ChatEvent, ChatMode, ChatPointer, ChatRow, ChatSuggestion, FallbackReason, RefusalReason } from './types';

export interface AnswerState {
  mode: ChatMode | null;
  reason: RefusalReason | FallbackReason | undefined;
  rows: ChatRow[];
  pointers: ChatPointer[];
  /** "Did you mean …?" chip (only on an unknown_name refusal). */
  suggestion: ChatSuggestion | null;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error: string | null;
}

export function initialAnswerState(): AnswerState {
  return { mode: null, reason: undefined, rows: [], pointers: [], suggestion: null, text: '', status: 'streaming', error: null };
}

/** A suggestion from the stream is used only when it is plain strings of a sane length (the chip resends it). */
export function readSuggestion(raw: unknown): ChatSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const ok = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;
  if (!ok(s.typed, 100) || !ok(s.label, 200) || !ok(s.question, MAX_QUESTION_CHARS)) return null;
  return { typed: s.typed, label: s.label, question: s.question };
}

export function applyChatEvent(s: AnswerState, e: ChatEvent): AnswerState {
  switch (e.type) {
    case 'meta':
      return {
        ...s,
        mode: e.mode,
        reason: e.reason,
        rows: e.rows,
        pointers: e.pointers ?? [],
        suggestion: e.mode === 'refusal' ? readSuggestion(e.suggestion) : null,
      };
    case 'text':
      return { ...s, text: s.text + e.delta };
    case 'reset':
      return { ...s, mode: e.mode, reason: e.reason, text: '' };
    case 'error':
      return { ...s, status: 'error', error: e.message };
    case 'done':
      return s.status === 'error' ? s : { ...s, status: 'done' };
  }
}

export const STOPPED_EARLY_MESSAGE = 'The answer stopped early. Please try again.';
export const NETWORK_ERROR_MESSAGE = 'Could not reach MastersPath. Check your internet connection and try again.';

/** Call when the stream has ended. A stream that ended without a "done" event is an error, never a silent cut. */
export function finishAnswer(s: AnswerState): AnswerState {
  if (s.status !== 'streaming') return s;
  return { ...s, status: 'error', error: STOPPED_EARLY_MESSAGE };
}

/** The model is asked for plain text; strip stray markdown markers so they never show up as symbols. */
export function cleanAnswerText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[*•][ \t]+/gm, '- ');
}

/** Friendly message for a non-OK HTTP status from /api/chat. */
export function httpErrorMessage(status: number, retryAfterSeconds?: number | null): string {
  if (status === 429) {
    return retryAfterSeconds
      ? `You are asking very fast. Please wait ${retryAfterSeconds} seconds and try again.`
      : 'You are asking very fast. Please wait a minute and try again.';
  }
  if (status === 413) return 'That question is too long. Please make it shorter.';
  if (status === 400) return 'Please type a question between 1 and 500 characters.';
  if (status === 403) return 'Please complete the security check and try again.';
  return 'Something went wrong. Please try again.';
}
