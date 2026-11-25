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

/** Mobile bottom navigation: Home, Shortlist, Plan B, Check. Active tab = olive text + yellow indicator bar. */
export function BottomNav() {
  const pathname = usePathname() ?? '/';
  return (
    <nav
      aria-label="Main"
      className="on-chrome fixed inset-x-0 bottom-0 z-40 bg-chrome pb-[env(safe-area-inset-bottom)] shadow-sheet md:hidden"
    >
      <ul className="mx-auto grid h-bottom-nav max-w-screen-sm grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="relative">
              {active ? <span aria-hidden="true" className="absolute inset-x-6 top-0 h-1 rounded-b-full bg-accent" /> : null}
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full min-h-tap flex-col items-center justify-center gap-0.5 text-xs font-semibold no-underline ${
                  active ? 'text-on-chrome' : 'text-on-chrome-muted'
                }`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
                className={`inline-flex min-h-tap items-center border-b-4 px-3 text-sm font-semibold no-underline ${
                  active ? 'border-accent text-on-chrome' : 'border-transparent text-on-chrome-muted hover:text-on-chrome'
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
