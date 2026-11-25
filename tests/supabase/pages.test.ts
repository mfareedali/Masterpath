/**
 * Privacy + Disclaimer pages: server-rendered to HTML (no DOM library) and checked for the promised content,
 * the product's copy rules, and one h1. Plus a scan of every file in this workstream for forbidden patterns.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisclaimerPage from '@/app/disclaimer/page';
import PrivacyPage from '@/app/privacy/page';
import { repoIssuesUrl } from '@/app/privacy/contact';

function render(Page: () => React.ReactElement): string {
  return renderToStaticMarkup(createElement(Page));
}

/** Visible copy only (tags and class names stripped). */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&[lr]dquo;|[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

/** "chance" is allowed only in the negation "never show admission chances" (shared BadgeLegend copy). */
const BANNED = [/guarantee/i, /fastest citizenship/i, /(?<!never show (?:admission )?)\bchances?\b/i, /\d\s*%/, /passport number/i, /probability/i];

function expectRules(html: string) {
  const copy = text(html);
  for (const re of BANNED) expect(copy, `banned wording ${re}`).not.toMatch(re);
  expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
  expect(html).not.toMatch(/dangerouslySetInnerHTML/);
  for (const m of html.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*>/g)) {
    expect(m[0], 'external links carry rel=noopener noreferrer nofollow').toMatch(/rel="noopener noreferrer nofollow"/);
  }
}

describe('Privacy page', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('states every promise from the brief', () => {
    const html = render(PrivacyPage);
    const copy = text(html);
    expectRules(html);
    expect(copy).toMatch(/cookie/i);
    expect(copy).toMatch(/localStorage/);
    expect(copy).toMatch(/row-level security/i);
    expect(copy).toMatch(/Anthropic/);
    expect(copy).toMatch(/public data rows/i);
    expect(copy).toMatch(/No profile data is attached/i);
    expect(copy).toMatch(/hashed client id/i);
    expect(copy).toMatch(/never stores raw IP addresses/i);
    expect(copy).toMatch(/passport, CNIC/i);
    expect(copy).toMatch(/never sell/i);
    expect(copy).toMatch(/hard delete/i);
    expect(copy).toMatch(/GitHub/);
    expect(html).toContain('href="/account"');
  });

  it('names GitHub issues without a link until a repo URL is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_REPO_URL', '');
    expect(render(PrivacyPage)).not.toMatch(/href="https:\/\/github\.com/);
    vi.stubEnv('NEXT_PUBLIC_REPO_URL', 'https://github.com/fixture-owner/masterspath');
    const html = render(PrivacyPage);
    expect(html).toContain('href="https://github.com/fixture-owner/masterspath/issues"');
    expectRules(html);
  });
});

describe('Disclaimer page', () => {
  it('states every point from the brief', () => {
    const html = render(DisclaimerPage);
    const copy = text(html);
    expectRules(html);
    expect(copy).toMatch(/not legal or immigration advice/i);
    expect(copy).toMatch(/out of date/i);
    expect(copy).toMatch(/check the official site/i);
    for (const label of ['Verified', 'Likely', 'Unverified', 'Conflict', 'Meets minimum', 'Below minimum', 'Competitive range unknown']) {
      expect(copy).toContain(label);
    }
    expect(copy).toMatch(/do not predict admission/i);
    expect(copy).toMatch(/never show percentages/i);
    expect(copy).toMatch(/compare/i);
    expect(copy).toMatch(/not a judgement about any person/i);
    expect(copy).toMatch(/MIT/);
    expect(copy).toMatch(/without warranty/i);
  });
});

describe('repoIssuesUrl', () => {
  it.each([
    ['https://github.com/owner/repo', 'https://github.com/owner/repo/issues'],
    ['https://github.com/owner/repo.git', 'https://github.com/owner/repo/issues'],
    ['https://github.com/owner/repo/tree/main', 'https://github.com/owner/repo/issues'],
    ['  https://GitHub.com/owner/repo/  ', 'https://github.com/owner/repo/issues'],
  ])('%s -> %s', (input, out) => expect(repoIssuesUrl(input)).toBe(out));

  it.each([null, undefined, '', 'github.com/owner/repo', 'http://github.com/owner/repo', 'https://evil.example/owner/repo', 'https://github.com/owner', 'https://user:pw@github.com/owner/repo', 'javascript:alert(1)', 'https://github.com/own er/repo'])(
    'rejects %j',
    (input) => expect(repoIssuesUrl(input as string | null | undefined)).toBeNull(),
  );
});

describe('workstream source scan', () => {
  const ROOTS = [
    'supabase',
    'scripts/seed-supabase.ts',
    'src/lib/supabase',
    'src/lib/data/supabase-source.ts',
    'src/app/account',
    'src/app/api/account',
    'src/app/auth',
    'src/app/privacy',
    'src/app/disclaimer',
    'src/proxy.ts',
  ];
  const files: string[] = [];
  const walk = (p: string) => {
    const full = join(process.cwd(), p);
    if (statSync(full).isDirectory()) for (const f of readdirSync(full)) walk(join(p, f));
    else files.push(p);
  };
  ROOTS.forEach(walk);

  it('found the files', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(files)('%s: no raw HTML injection, no default Tailwind palette, no ID-number fields', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=/);
    expect(src).not.toMatch(/\b(?:bg|text|border)-(?:red|gray|blue|green|slate|zinc|neutral|stone|amber|emerald|indigo|rose)-\d{2,3}\b/);
    expect(src).not.toMatch(/passport_?(?:no|number)|cnic_?(?:no|number)|national_id/i);
  });

  it('the service-role client is server-only and never imported by client components', () => {
    expect(readFileSync(join(process.cwd(), 'src/lib/supabase/admin.ts'), 'utf8')).toMatch(/^import 'server-only';/m);
    for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      if (/^['"]use client['"]/m.test(src)) {
        expect(src, file).not.toMatch(/supabase\/admin|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
      }
    }
  });
});
