/**
 * Consultant Check form. A GET form (next/form): /check?claims=<text>.
 * Works without JavaScript (plain form submit); with JS it is a client-side navigation that shows loading.tsx.
 * Example chips are plain links that only prefill the box (/check?example=<id>).
 */
import Form from 'next/form';
import { buttonClass } from '@/components/ui/button';
import { ChipLink, ChipRow } from '@/components/ui/chip';
import { EXAMPLE_CLAIMS } from '@/lib/consultant/examples';
import { MAX_INPUT_CHARS } from '@/lib/consultant/extract';

const PLACEHOLDER = 'For example: Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years.';

export function CheckForm({
  defaultText,
  activeExample,
  headingId,
  heading,
}: {
  defaultText: string;
  activeExample: string | null;
  headingId: string;
  heading: string;
}) {
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-xl font-bold">
        {heading}
      </h2>
      <Form action="/check" className="space-y-3">
        <div>
          <label htmlFor="claims-input" className="block font-semibold text-heading">
            What did the agent or consultant tell you?
          </label>
          <p id="claims-hint" className="mt-1 text-sm text-muted">
            Paste their message, or write each promise on its own line. Up to {MAX_INPUT_CHARS.toLocaleString('en-GB')}{' '}
            characters. Please leave out phone, CNIC and passport numbers. We remove numbers that look like them.
          </p>
          <textarea
            // Remount when the prefill changes (example links), so the box shows the new text after a client navigation.
            key={defaultText}
            id="claims-input"
            name="claims"
            rows={6}
            maxLength={MAX_INPUT_CHARS}
            required
            defaultValue={defaultText}
            placeholder={PLACEHOLDER}
            aria-describedby="claims-hint"
            autoComplete="off"
            spellCheck
            className="mt-2 block w-full resize-y rounded-button border border-line-strong bg-surface p-3 text-base text-ink placeholder:text-muted"
          />
        </div>
        <button type="submit" className={buttonClass('primary', 'w-full sm:w-auto')}>
          Check these claims
        </button>
      </Form>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-heading">
          Or try a made-up example:
        </p>
        <ChipRow label="Made-up examples that fill the box">
          {EXAMPLE_CLAIMS.map((e) => (
            <ChipLink key={e.id} href={`/check?example=${e.id}`} active={activeExample === e.id} prefetch={false}>
              Example: {e.label}
            </ChipLink>
          ))}
        </ChipRow>
        <p className="text-xs text-muted">Examples only fill the box. Tap “Check these claims” to see the result.</p>
      </div>
    </section>
  );
}
