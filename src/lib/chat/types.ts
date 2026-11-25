/**
 * Chat types. The chat answers ONLY from database rows: code retrieves and decides, the model only explains.
 * Pure types, safe on server and client.
 */
import type { Confidence, CountryFactKey, Program } from '@/lib/types';

/** Program fields the chat can answer about (all are Fact<...> columns on Program). */
export type ProgramChatField = Extract<
  keyof Program,
  | 'deadline'
  | 'tuition'
  | 'living_cost'
  | 'language_req'
  | 'min_gpa_rule'
  | 'lor_count'
  | 'sop_requirements'
  | 'cv_requirements'
  | 'tests_required'
  | 'scholarship_info'
  | 'duration_months'
  | 'intake'
  | 'research_considered'
  | 'progression_guaranteed'
  | 'progression_requirement'
  | 'admissions_email'
  | 'status_note'
  | 'eligibility_note'
  | 'conditional_admission'
  | 'language_waiver'
>;

export type ChatField = ProgramChatField | CountryFactKey;

/** One other source for the same fact (only present when sources disagree). */
export interface ChatRowSource {
  value: string | null;
  source_url: string | null;
  evidence_snippet: string | null;
  fetched_at: string | null;
}

/** A single database fact, flattened to plain text for the guard, the prompt and the UI. */
export interface ChatRow {
  /** Stable id, e.g. "tum-msc-informatics:deadline" or a country-fact id. */
  id: string;
  entity: 'program' | 'country';
  /** Program id or country code. */
  entity_id: string;
  /** "MSc Informatics at Technical University of Munich" or "Germany". */
  entity_name: string;
  field: ChatField;
  /** "Application deadline" */
  label: string;
  /** Plain-text value, or null when the database has no value. */
  value: string | null;
  /** Always computed with computeConfidence(fact, now). */
  confidence: Confidence;
  source_url: string | null;
  evidence_snippet: string | null;
  fetched_at: string | null;
  /** Official page to check when the value is missing (program page, else university homepage, else fact source). */
  official_url: string | null;
  /** Every source with a value, primary first — only when confidence is Conflict. */
  sources?: ChatRowSource[];
  /** Ready-to-copy email to admissions — only when confidence is Conflict. Plain text. */
  email_draft?: string;
}

export type ChatMode = 'refusal' | 'answer' | 'fallback';

export type RefusalReason =
  | 'not_verified'
  | 'conflict'
  | 'no_data'
  | 'prediction'
  | 'legal'
  | 'dishonest'
  /** The question names no university exactly, but one name is a near miss: we ask, we never guess. */
  | 'unknown_name';

export type FallbackReason = 'no_model' | 'budget' | 'model_error' | 'model_refusal' | 'unsupported_numbers' | 'empty';

/** Internal app links shown under a refusal. Only fixed app routes, never data. */
export interface ChatPointer {
  href: '/check' | '/shortlist' | '/citizenship';
  label: string;
}

/**
 * A "Did you mean …?" correction, built in code from the institution list (never from a data value).
 * The chat never answers for the guessed name: the student taps the chip to ask the corrected question.
 */
export interface ChatSuggestion {
  /** The word the student typed, e.g. "Imprial". */
  typed: string;
  /** The institution it is close to, e.g. "Imperial College London". */
  label: string;
  /** The student's question with that word corrected; sent as a new question when the chip is tapped. */
  question: string;
}

/** Events streamed to the browser as NDJSON lines. */
export type ChatEvent =
  | {
      type: 'meta';
      mode: ChatMode;
      reason?: RefusalReason | FallbackReason;
      rows: ChatRow[];
      pointers?: ChatPointer[];
      /** Only on an 'unknown_name' refusal. */
      suggestion?: ChatSuggestion;
    }
  | { type: 'text'; delta: string }
  /** The text streamed so far must be discarded and replaced by what follows (deterministic fallback). */
  | { type: 'reset'; mode: 'fallback'; reason: FallbackReason }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Request body accepted by POST /api/chat (validated with zod in the route). */
export interface ChatRequest {
  question: string;
  programId?: string;
  country?: string;
  turnstileToken?: string;
}
