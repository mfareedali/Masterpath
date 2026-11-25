/**
 * "Did you mean …?" for a university name that is close to one we hold ("Brooks" -> Oxford Brookes University).
 * Server component, plain text only. The link reruns the check with the corrected text (an internal link, so olive,
 * never the blue reserved for official sources). Nothing is checked against a guessed name until the student taps it.
 */
import Link from 'next/link';
import { Callout } from '@/components/ui/card';
import type { NameSuggestion } from '@/lib/consultant/suggest';

/** /check?claims=<corrected text>: the same GET request the form makes. */
export function suggestionHref(s: NameSuggestion): string {
  return `/check?claims=${encodeURIComponent(s.correctedText)}`;
}

export function NameSuggestionNote({ suggestion }: { suggestion: NameSuggestion }) {
  return (
    <Callout tone="neutral">
      <p className="break-words">
        We could not match “{suggestion.typed}”. Did you mean {suggestion.label}?
      </p>
      <p className="mt-1">
        <Link href={suggestionHref(suggestion)} prefetch={false} className="inline-flex min-h-tap items-center font-semibold underline">
          Yes, check again with {suggestion.label}
        </Link>
      </p>
      <p className="text-xs text-muted">We never check a claim against a name we guessed. The link reruns the check with the corrected name.</p>
    </Callout>
  );
}
