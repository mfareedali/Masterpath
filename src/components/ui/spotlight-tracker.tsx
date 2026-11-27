'use client';

/**
 * Sets --spot-x / --spot-y (px) on the hovered tile matching `selector`, for the CSS spotlight in globals.css
 * (`.bento-card`). One delegated pointermove listener per grid; touch and pen are ignored (no phantom hover).
 * Decorative only: nothing depends on it, and without JS the tiles still highlight on hover.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function SpotlightTracker({ selector, children }: { selector: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const card = (e.target as Element | null)?.closest<HTMLElement>(selector);
      if (!card || !root.contains(card) || frame) return;
      const { clientX, clientY } = e;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--spot-x', `${clientX - rect.left}px`);
        card.style.setProperty('--spot-y', `${clientY - rect.top}px`);
      });
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [selector]);

  return <div ref={ref}>{children}</div>;
}
