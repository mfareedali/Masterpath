'use client';

/**
 * "Report incorrect data" (client island). POSTs JSON to /api/report.
 * Server replies are fixed strings and are shown as plain text only.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { REPORT_ERRORS, REPORT_MESSAGE_MAX, REPORT_MESSAGE_MIN } from '@/lib/program/report-constants';
import { useHydrated } from './use-local-store';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string };

const inputClass =
  'mt-1 block w-full rounded-button border border-line bg-surface px-3 py-2 text-base text-ink focus:border-primary';

export function ReportForm({ programId, fields }: { programId: string; fields: { key: string; label: string }[] }) {
  const hydrated = useHydrated();
  const [field, setField] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  // Code points, like the server check and the database (an emoji counts as one character).
  const length = Array.from(message.trim()).length;
  const idPrefix = `report-${programId}`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!field) {
      setState({ kind: 'error', text: REPORT_ERRORS.badField });
      return;
    }
    if (length < REPORT_MESSAGE_MIN) {
      setState({ kind: 'error', text: REPORT_ERRORS.tooShort });
      return;
    }
    if (length > REPORT_MESSAGE_MAX) {
      setState({ kind: 'error', text: REPORT_ERRORS.tooLong });
      return;
    }
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program_id: programId, field, message: message.trim() }),
      });
      const data: unknown = await res.json().catch(() => null);
      const body = (data && typeof data === 'object' ? data : {}) as { message?: unknown; error?: unknown };
      if (res.ok) {
        setState({ kind: 'done', text: typeof body.message === 'string' ? body.message : 'Thanks. Your report was sent.' });
        setMessage('');
        setField('');
      } else {
        const fallback = res.status === 429 ? REPORT_ERRORS.rateLimited : REPORT_ERRORS.storeFailed;
        setState({ kind: 'error', text: typeof body.error === 'string' ? body.error : fallback });
      }
    } catch {
      setState({ kind: 'error', text: REPORT_ERRORS.offline });
    }
  }

  return (
    <section id="report" aria-labelledby={`${idPrefix}-title`} className="scroll-mt-20">
      <Card>
        <h2 id={`${idPrefix}-title`} className="text-xl font-bold">
          Report incorrect data
        </h2>
        <p className="mt-1 text-sm text-muted">
          Found a wrong or old fact? Tell us which one. If you can, add the correct value and the official page link.
          Please do not include personal details.
        </p>

        <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
          <div>
            <label htmlFor={`${idPrefix}-field`} className="text-sm font-semibold text-heading">
              Which fact is wrong?
            </label>
            <select
              id={`${idPrefix}-field`}
              name="field"
              required
              value={field}
              onChange={(e) => setField(e.target.value)}
              className={`${inputClass} min-h-tap`}
            >
              <option value="">Choose a fact</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${idPrefix}-message`} className="text-sm font-semibold text-heading">
              What is wrong?
            </label>
            <textarea
              id={`${idPrefix}-message`}
              name="message"
              required
              rows={4}
              minLength={REPORT_MESSAGE_MIN}
              maxLength={REPORT_MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby={`${idPrefix}-count`}
              className={inputClass}
            />
            <p id={`${idPrefix}-count`} className="mt-1 text-xs text-muted">
              {length} / {REPORT_MESSAGE_MAX} characters (at least {REPORT_MESSAGE_MIN})
            </p>
          </div>

          <Button type="submit" variant="secondary" disabled={!hydrated || state.kind === 'sending'}>
            {state.kind === 'sending' ? 'Sending…' : 'Send report'}
          </Button>
          <noscript>
            <p className="text-sm text-muted">Turn on JavaScript to send a report.</p>
          </noscript>

          <p
            role="status"
            aria-live="polite"
            className={
              state.kind === 'error'
                ? 'rounded-button bg-conflict-bg p-3 text-sm font-semibold text-conflict-fg'
                : state.kind === 'done'
                  ? 'rounded-button bg-verified-bg p-3 text-sm font-semibold text-verified-fg'
                  : 'sr-only'
            }
          >
            {state.kind === 'error' ? (
              <>
                <span aria-hidden="true">! </span>
                {state.text}
              </>
            ) : state.kind === 'done' ? (
              <>
                <span aria-hidden="true">✓ </span>
                {state.text}
              </>
            ) : state.kind === 'sending' ? (
              'Sending your report'
            ) : (
              ''
            )}
          </p>
        </form>
      </Card>
    </section>
  );
}
