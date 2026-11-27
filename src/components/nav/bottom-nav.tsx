'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { href: '/shortlist', label: 'Shortlist', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/plan-b', label: 'Plan B', icon: 'M6 3v12a4 4 0 0 0 4 4h8M14 15l4 4-4 4' },
  { href: '/check', label: 'Check', icon: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z' },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

/**
 * Mobile navigation dock: a floating forest-950 bar above the safe area with Home, Shortlist, Plan B, Check.
 * The active tab sits on an olive-100 pill (forest text), so it differs by fill and label, not colour alone.
 */
export function BottomNav() {
  const pathname = usePathname() ?? '/';
  return (
    <nav
      aria-label="Main"
      className="on-chrome fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 md:hidden"
    >
      <ul className="mx-auto grid h-bottom-nav max-w-sm grid-cols-4 gap-1 rounded-panel border border-on-chrome-muted/20 bg-chrome p-1.5 shadow-dock">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full min-h-tap flex-col items-center justify-center gap-0.5 rounded-card text-xs font-semibold no-underline transition-colors ${
                  active ? 'bg-accent-soft text-on-accent-soft' : 'text-on-chrome-muted hover:text-on-chrome'
                }`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop navigation in the header (bottom nav is hidden from md up). */
export function TopNav() {
  const pathname = usePathname() ?? '/';
  const items = [...NAV_ITEMS, { href: '/citizenship', label: 'Citizenship & cost', icon: '' }];
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-tap items-center rounded-chip px-3.5 text-sm font-semibold no-underline transition-colors ${
                  active ? 'bg-accent-soft text-on-accent-soft' : 'text-on-chrome-muted hover:bg-on-chrome/10 hover:text-on-chrome'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
