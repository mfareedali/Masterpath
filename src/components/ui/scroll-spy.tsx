'use client';

/**
 * "On this page" bar that highlights the section in view with a sliding pill. Ported from the 21st.dev
 * "Scroll Spy" component (ddoemonn) without motion/react: the pill slides with a CSS transition, and reduced
 * motion makes it jump (globals.css).
 *
 * Progressive enhancement: the server renders plain `<a href="#id">` links, so it works without JS. After
 * hydration it tracks the scroll position, marks the active link with aria-current="location", keeps that chip
 * scrolled into view, and announces the section politely once the user stops scrolling.
 * Sections get their scroll margin from `.has-scroll-spy [id]` in globals.css (header + this bar).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ScrollSpySection {
  id: string;
  label: string;
}

/** Where the "reading line" sits, in px below the top of the viewport (sticky header + this bar). */
const DEFAULT_OFFSET = 128;
const SETTLE_MS = 450;
const RELEASE_MS = 900;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useScrollSpy(sections: readonly ScrollSpySection[], offset = DEFAULT_OFFSET) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const ids = sections.map((s) => s.id).join('|');
  const lock = useRef<string | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);

  const measure = useCallback((): string | null => {
    const list = ids ? ids.split('|') : [];
    let current: string | null = null;
    let last: string | null = null;
    for (const id of list) {
      const node = document.getElementById(id);
      if (!node) continue;
      last = id;
      current ??= id;
      if (node.getBoundingClientRect().top <= offset + 1) current = id;
    }
    // At the very bottom, the last section wins even if it is too short to reach the line.
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    return atEnd && last ? last : current;
  }, [ids, offset]);

  const sync = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const next = measure();
      if (lock.current) {
        if (lock.current === next) lock.current = null;
        return;
      }
      setActiveId((prev) => (prev === next ? prev : next));
    });
  }, [measure]);

  useEffect(() => {
    const abandon = () => {
      lock.current = null;
    };
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    window.addEventListener('wheel', abandon, { passive: true });
    window.addEventListener('touchstart', abandon, { passive: true });
    sync();
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('wheel', abandon);
      window.removeEventListener('touchstart', abandon);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (lockTimer.current) clearTimeout(lockTimer.current);
    };
  }, [sync]);

  const scrollTo = useCallback(
    (id: string) => {
      const node = document.getElementById(id);
      if (!node) return false;
      lock.current = id;
      setActiveId(id);
      node.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
      history.replaceState(null, '', `#${id}`);
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => {
        lock.current = null;
        sync();
      }, RELEASE_MS);
      return true;
    },
    [sync],
  );

  return { activeId, scrollTo };
}

export function ScrollSpy({
  sections,
  label = 'On this page',
  offset = DEFAULT_OFFSET,
  className = '',
}: {
  sections: readonly ScrollSpySection[];
  label?: string;
  offset?: number;
  className?: string;
}) {
  const { activeId, scrollTo } = useScrollSpy(sections, offset);
  const listRef = useRef<HTMLOListElement>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const started = useRef(false);

  // Slide the pill under the active link and keep that link visible in the horizontal row.
  useLayoutEffect(() => {
    const el = activeId ? links.current.get(activeId) : undefined;
    if (!el) {
      setThumb(null);
      return;
    }
    setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    const list = listRef.current;
    if (list) {
      const left = el.offsetLeft - 16;
      const right = el.offsetLeft + el.offsetWidth + 16 - list.clientWidth;
      if (list.scrollLeft > left) list.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
      else if (list.scrollLeft < right) list.scrollTo({ left: right, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, [activeId]);

  // Announce the section once scrolling settles (not on first load).
  useEffect(() => {
    if (!activeId) return;
    if (!started.current) {
      started.current = true;
      return;
    }
    const t = setTimeout(() => setAnnounce(sections.find((s) => s.id === activeId)?.label ?? ''), SETTLE_MS);
    return () => clearTimeout(t);
  }, [activeId, sections]);

  return (
    <nav aria-label={label} className={`sticky top-14 z-20 -mx-4 bg-page/95 px-4 py-2 backdrop-blur md:mx-0 md:rounded-card md:px-2 ${className}`}>
      <div className="rounded-chip border border-line bg-surface p-1 shadow-card">
        <ol ref={listRef} className="relative flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {thumb ? (
            <li
              aria-hidden="true"
              className="scroll-spy-thumb pointer-events-none absolute inset-y-0 left-0 rounded-chip bg-chrome"
              style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
            />
          ) : null}
          {sections.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id} className="relative shrink-0">
                <a
                  ref={(el) => {
                    if (el) links.current.set(s.id, el);
                    else links.current.delete(s.id);
                  }}
                  href={`#${s.id}`}
                  aria-current={active ? 'location' : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    if (scrollTo(s.id)) e.preventDefault();
                  }}
                  className={`relative inline-flex min-h-tap items-center whitespace-nowrap rounded-chip px-4 text-sm font-semibold no-underline transition-colors duration-150 ${
                    active ? (thumb ? 'text-on-chrome' : 'bg-chrome text-on-chrome') : 'text-ink hover:text-primary-ink'
                  }`}
                >
                  {s.label}
                </a>
              </li>
            );
          })}
        </ol>
      </div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </nav>
  );
}
