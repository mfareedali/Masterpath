/**
 * Server-render smoke tests (node environment, no DOM library) for one chat answer: the "Did you mean …?" chip
 * (proposal #21) and plain-text rendering of streamed values.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyChatEvent, initialAnswerState, type AnswerState } from '@/lib/chat/client-state';
import type { ChatEvent } from '@/lib/chat/types';
import { ChatAnswer } from './chat-answer';

function stateOf(events: ChatEvent[]): AnswerState {
  return events.reduce(applyChatEvent, initialAnswerState());
}

const suggestion = { typed: 'Imprial', label: 'Imperial College London', question: 'What is the deadline for Imperial?' };

const unknownName = stateOf([
  { type: 'meta', mode: 'refusal', reason: 'unknown_name', rows: [], pointers: [], suggestion },
  { type: 'text', delta: "I couldn't find 'Imprial' in MastersPath. Did you mean Imperial College London?" },
  { type: 'done' },
]);

function render(answer: AnswerState, onAsk?: (q: string) => void, retryDisabled = false): string {
  return renderToStaticMarkup(
    <ChatAnswer turn={{ id: 1, question: 'What is the deadline for Imprial?', answer }} sourcesHeadingLevel={2} onAsk={onAsk} retryDisabled={retryDisabled} />,
  );
}

describe('ChatAnswer: "Did you mean …?" refusal', () => {
  it('shows the code-built text, the "Name not found" title, and one chip with the corrected question', () => {
    const html = render(unknownName, () => {});
    expect(html).toContain('Name not found');
    expect(html).toContain('I couldn&#x27;t find &#x27;Imprial&#x27; in MastersPath. Did you mean Imperial College London?');
    expect(html).toContain('Tap to ask with this name:');
    expect(html.match(/<button type="button"[^>]*>What is the deadline for Imperial\?<\/button>/g)).toHaveLength(1);
    expect(html).toContain('No AI was used for this answer.');
  });

  it('the chip is disabled while another answer is streaming', () => {
    expect(render(unknownName, () => {}, true)).toMatch(/<button type="button"[^>]*disabled=""[^>]*>What is the deadline for Imperial\?<\/button>/);
  });

  it('no chip without an ask handler, while streaming, or without a suggestion', () => {
    expect(render(unknownName)).not.toContain('Tap to ask');
    const streaming = stateOf([
      { type: 'meta', mode: 'refusal', reason: 'unknown_name', rows: [], suggestion },
      { type: 'text', delta: "I couldn't find 'Imprial'." },
    ]);
    expect(render(streaming, () => {})).not.toContain('Tap to ask');
    const noData = stateOf([
      { type: 'meta', mode: 'refusal', reason: 'no_data', rows: [] },
      { type: 'text', delta: 'No data.' },
      { type: 'done' },
    ]);
    expect(render(noData, () => {})).not.toContain('Tap to ask');
  });

  it('a suggestion is rendered as text, never as HTML', () => {
    const evil = stateOf([
      {
        type: 'meta',
        mode: 'refusal',
        reason: 'unknown_name',
        rows: [],
        suggestion: { typed: '<b>x</b>', label: '<img src=x onerror=alert(1)>', question: '<script>alert(1)</script>' },
      },
      { type: 'text', delta: "I couldn't find '<b>x</b>'." },
      { type: 'done' },
    ]);
    const html = render(evil, () => {});
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('ChatAnswer: deadline status is shown exactly as the row value', () => {
  it('the passed text appears in "Sources used" as plain text', () => {
    const answer = stateOf([
      {
        type: 'meta',
        mode: 'fallback',
        reason: 'no_model',
        rows: [
          {
            id: 'fixture-msc-cs:deadline',
            entity: 'program',
            entity_id: 'fixture-msc-cs',
            entity_name: 'MSc Fixture Computing at Fixture University',
            field: 'deadline',
            label: 'Application deadline',
            value: '20 Nov 2026 (this date has passed; the next deadline is not verified yet)',
            confidence: 'Verified',
            source_url: 'https://fixture.example.edu/program',
            evidence_snippet: 'Fixture snippet',
            fetched_at: '2026-11-23',
            official_url: 'https://fixture.example.edu/program',
          },
        ],
      },
      { type: 'text', delta: 'Here are the facts from MastersPath:' },
      { type: 'done' },
    ]);
    const html = render(answer, () => {});
    expect(html).toContain('20 Nov 2026 (this date has passed; the next deadline is not verified yet)');
    expect(html).not.toContain('Tap to ask');
  });
});
