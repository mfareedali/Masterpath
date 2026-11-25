/**
 * Consultant Check — plain-text summaries for WhatsApp and the clipboard. Pure, no I/O.
 * Plain text only (never HTML); the share text stays within SHARE_MAX_CHARS.
 */
import type { CheckResult, CheckSummary } from './compare';
import { collectQuestions, resultLabel } from './compare';

export const SHARE_MAX_CHARS = 1500;
export const SHARE_FOOTER = 'Checked with MastersPath (free, open source). Not legal advice.';

const CANT_VERIFY_SHARE = "Can't verify yet";

/**
 * The plain verdict for one share line: the result's own label, so a verdict that rests on our summary (no exact
 * words from the official page) is never shared as "official page".
 */
function shareVerdict(r: CheckResult): string {
  return r.verdict === 'cant_verify' ? CANT_VERIFY_SHARE : resultLabel(r);
}

const CLAIM_SNIPPET_MAX = 80;
const MAX_CLAIM_LINES = 10;
const MAX_QUESTIONS = 5;

/** Shorten to `max` characters on a word boundary, with an ellipsis. */
export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/**
 * WhatsApp text: one line per claim, the key questions, and the footer.
 * Optional `url` (absolute https) is appended so friends can run their own check.
 */
export function buildShareText(results: readonly CheckResult[], opts: { url?: string | null; maxChars?: number } = {}): string {
  const max = opts.maxChars ?? SHARE_MAX_CHARS;
  const url = opts.url && /^https:\/\//.test(opts.url) ? opts.url : null;
  const tail = [SHARE_FOOTER, ...(url ? [url] : [])].join('\n');

  const claimLines = results.slice(0, MAX_CLAIM_LINES).map((r) => `- ${shareVerdict(r)}: "${truncate(r.claim, CLAIM_SNIPPET_MAX)}"`);
  if (results.length > MAX_CLAIM_LINES) claimLines.push(`- and ${results.length - MAX_CLAIM_LINES} more`);

  const head = 'I compared what I was told about studying abroad with official pages:';
  const questions = collectQuestions(results, MAX_QUESTIONS);

  const assemble = (lines: string[], qs: string[]) =>
    [head, ...lines, ...(qs.length ? ['', 'Questions to ask in writing:', ...qs.map((q, i) => `${i + 1}. ${q}`)] : []), '', tail].join('\n');

  let lines = claimLines;
  let qs = questions;
  let text = assemble(lines, qs);
  // Drop questions first, then claim lines, until it fits.
  while (text.length > max && qs.length > 0) {
    qs = qs.slice(0, -1);
    text = assemble(lines, qs);
  }
  while (text.length > max && lines.length > 1) {
    lines = lines.slice(0, -1);
    text = assemble(lines, qs);
  }
  if (text.length > max) {
    // Last resort (tiny limits): keep the footer intact.
    const room = Math.max(0, max - tail.length - 2);
    text = `${truncate([head, ...lines].join('\n'), room)}\n\n${tail}`.slice(0, max);
  }
  return text;
}

/** https://wa.me/?text=<encoded> — opens WhatsApp with the text ready to send to anyone. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * One plain sentence for the results summary (also read out by screen readers). The counts include verdicts that
 * rest on our summary of an official page, so it says "the official information we hold", not "official pages".
 */
export function summarySentence(s: CheckSummary): string {
  if (s.total === 0) return 'We could not find a claim to check.';
  const claims = `${s.total} ${s.total === 1 ? 'claim' : 'claims'}`;
  const parts = [
    `${s.conflict} ${s.conflict === 1 ? 'differs' : 'differ'}`,
    `${s.cant_verify} we can't verify yet`,
    `${s.matches} ${s.matches === 1 ? 'matches' : 'match'}`,
  ];
  return `We checked ${claims} against the official information we hold: ${parts.join(', ')}.`;
}

/** Text for "Copy all questions": a polite message the student can send to the agent. */
export function buildQuestionsText(questions: readonly string[]): string {
  if (questions.length === 0) return '';
  return [
    'Thank you for your help. Before I decide, could you please answer these in writing, with links to the official pages?',
    '',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');
}
