'use client';

/**
 * Chat that answers ONLY from MastersPath database rows (screen 9).
 *
 * Code decides, the model explains, no data means no answer: the server refuses before any AI call when the data
 * cannot answer ("not verified yet" + the official link). Answers stream in as PLAIN TEXT; each one lists the
 * rows it used under "Sources used" with confidence badges and source links.
 *
 * Props contract (used by the program page, the citizenship page and /ask):
 *   programId?:    default program when the question names none
 *   country?:      default country (2-letter code) when the question names none
 *   title?:        heading text
 *   suggestions?:  example questions, shown as chips (one tap asks)
 *   headingLevel?: 1 on a page where the chat is the main content (/ask), else 2 (default; rendered as a card)
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { startChat } from '@/lib/chat/client-fetch';
import {
  NETWORK_ERROR_MESSAGE,
  STOPPED_EARLY_MESSAGE,
  applyChatEvent,
  finishAnswer,
  initialAnswerState,
  type AnswerState,
} from '@/lib/chat/client-state';
import { MAX_QUESTION_CHARS } from '@/lib/chat/limits';
import { Button } from '@/components/ui/button';
import { ChatAnswer, SUGGESTION_CLASS, type ChatTurn } from './chat-answer';
import { TurnstileWidget } from './turnstile-widget';

export interface ChatPanelProps {
  programId?: string;
  country?: string;
  title?: string;
  suggestions?: readonly string[];
  headingLevel?: 1 | 2;
}

/** Older answers beyond this are dropped (keeps the page light on mid-range phones). */
const MAX_TURNS = 5;

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export const CHAT_DISCLAIMER = 'Answers come only from MastersPath data. Not legal or immigration advice.';

export function ChatPanel({ programId, country, title = 'Ask about this data', suggestions = [], headingLevel = 2 }: ChatPanelProps) {
  const uid = useId();
  const headingId = `${uid}-title`;
  const inputId = `${uid}-question`;
  const hintId = `${uid}-hint`;

  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const nextId = useRef(0);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onToken = useCallback((t: string | null) => {
    setToken(t);
    if (t) {
      setTurnstileFailed(false);
      setNotice(null);
    }
  }, []);
  const onTurnstileError = useCallback(() => setTurnstileFailed(true), []);

  const ask = useCallback(
    async (raw: string) => {
      const q = raw.trim().slice(0, MAX_QUESTION_CHARS);
      if (!q || busyRef.current) return;
      if (TURNSTILE_SITE_KEY && !token) {
        setNotice(
          turnstileFailed
            ? 'The security check could not load. Check your internet connection and reload the page.'
            : 'Please wait a moment for the security check to finish, then ask again.',
        );
        return;
      }

      const id = ++nextId.current;
      const update = (fn: (a: AnswerState) => AnswerState) =>
        setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, answer: fn(t.answer) } : t)));

      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      setQuestion('');
      setTurns((ts) => [{ id, question: q, answer: initialAnswerState() }, ...ts].slice(0, MAX_TURNS));
      // Close the phone keyboard so the answer is visible.
      inputRef.current?.blur();

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await startChat(
          { question: q, programId, country, turnstileToken: token ?? undefined },
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          const message = res.message;
          update((a) => applyChatEvent(a, { type: 'error', message }));
          return;
        }
        for await (const batch of res.batches) {
          update((a) => batch.reduce(applyChatEvent, a));
        }
        update(finishAnswer);
      } catch {
        if (ctrl.signal.aborted) return;
        update((a) => applyChatEvent(a, { type: 'error', message: a.text ? STOPPED_EARLY_MESSAGE : NETWORK_ERROR_MESSAGE }));
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
        if (TURNSTILE_SITE_KEY) setResetKey((k) => k + 1); // tokens are single use
      }
    },
    [programId, country, token, turnstileFailed],
  );

  const retry = useCallback(
    (turn: ChatTurn) => {
      setTurns((ts) => ts.filter((t) => t.id !== turn.id));
      void ask(turn.question);
    },
    [ask],
  );

  const page = headingLevel === 1;
  const Heading = page ? 'h1' : 'h2';
  const remaining = MAX_QUESTION_CHARS - question.length;

  return (
    <section
      aria-labelledby={headingId}
      className={page ? 'space-y-4' : 'space-y-4 rounded-card border border-line bg-surface p-4 shadow-card'}
    >
      <header>
        <Heading id={headingId} className={page ? 'text-2xl font-bold md:text-3xl' : 'text-lg font-bold'}>
          {title}
        </Heading>
        <p className="mt-1 text-sm text-muted">
          Ask in plain words. If a fact is not verified in our data, I will say so and link the official page. I never guess.
        </p>
      </header>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
          Your question
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            name="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={MAX_QUESTION_CHARS}
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Type your question"
            aria-describedby={hintId}
            className="min-h-tap w-full min-w-0 flex-1 rounded-button border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
          />
          <Button type="submit" disabled={busy || question.trim() === ''} className="shrink-0">
            {busy ? 'Asking…' : 'Ask'}
          </Button>
        </div>
        <p id={hintId} className="text-xs text-muted">
          {CHAT_DISCLAIMER}
          {remaining <= 100 ? <span className="ml-1">({remaining} characters left)</span> : null}
        </p>
        {TURNSTILE_SITE_KEY ? (
          <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} onToken={onToken} onError={onTurnstileError} resetKey={resetKey} />
        ) : null}
        {notice ? (
          <p role="alert" className="text-sm font-semibold text-conflict-fg">
            {notice}
          </p>
        ) : null}
      </form>

      {suggestions.length > 0 ? (
        <div>
          <p id={`${uid}-try`} className="mb-2 text-sm font-semibold text-muted">
            Try asking
          </p>
          {/* Wrapping chips (not a scrolling row) so every example is visible on a 360px screen. */}
          <ul aria-labelledby={`${uid}-try`} className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s} className="max-w-full">
                <button type="button" className={SUGGESTION_CLASS} disabled={busy} onClick={() => void ask(s)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div aria-live="polite" className="space-y-6">
        {turns.map((t) => (
          <ChatAnswer
            key={t.id}
            turn={t}
            sourcesHeadingLevel={page ? 2 : 3}
            onRetry={() => retry(t)}
            retryDisabled={busy}
            onAsk={(q) => void ask(q)}
          />
        ))}
      </div>

      {turns.length > 1 && !busy ? (
        <Button variant="ghost" onClick={() => setTurns([])}>
          Clear answers
        </Button>
      ) : null}
    </section>
  );
}
