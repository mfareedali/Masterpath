'use client';

/**
 * Rotating headline phrase with a per-character blur stagger (after the 21st.dev "Text Cycle" pattern), built
 * without motion libraries: each change remounts the phrase and CSS (`.cycle-char`) animates the letters in.
 *
 * - The server renders the first phrase, so the headline is complete without JS.
 * - Every phrase is stacked invisibly in the same grid cell, so the line keeps the width of the longest phrase
 *   (no layout shift while cycling).
 * - Decorative: the h1 carries the full sentence for screen readers; this element is aria-hidden.
 * - Under prefers-reduced-motion it never cycles.
 */
import { useEffect, useState } from 'react';

export function TextCycle({ phrases, interval = 2800, className = '' }: { phrases: readonly string[]; interval?: number; className?: string }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (phrases.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % phrases.length), interval);
    return () => clearInterval(t);
  }, [phrases.length, interval]);

  const current = phrases[i] ?? '';
  return (
    <span aria-hidden="true" className={`inline-grid ${className}`}>
      {phrases.map((p) => (
        <span key={p} className="invisible col-start-1 row-start-1 whitespace-nowrap">
          {p}
        </span>
      ))}
      <span key={current} className="col-start-1 row-start-1 whitespace-nowrap">
        {Array.from(current).map((ch, n) => (
          <span key={n} className="cycle-char" style={{ ['--n' as string]: n }}>
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </span>
    </span>
  );
}
