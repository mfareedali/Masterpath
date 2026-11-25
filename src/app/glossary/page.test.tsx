/**
 * /glossary (proposal #40): server-rendered without a DOM library. One h1, one anchor per term, plain text,
 * internal links only (olive, never blue), meanings with no digits, and a footer link from the root layout.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RootLayout from '@/app/layout';
import { GLOSSARY, GLOSSARY_GROUPS } from '@/lib/glossary';
import GlossaryPage, { dynamic, metadata } from './page';

const html = renderToStaticMarkup(createElement(GlossaryPage));

/** The way React escapes text content. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/** Visible copy only (tags stripped, React's entities decoded so '&#x27;' is not read as digits). */
function text(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('/glossary page', () => {
  it('is static and titled Glossary', () => {
    expect(dynamic).toBe('force-static');
    expect(metadata.title).toBe('Glossary');
  });

  it('has exactly one h1 and one h2 per group', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html.match(/<h2[\s>]/g)).toHaveLength(GLOSSARY_GROUPS.length);
  });

  it('gives every term its own anchor, with its term and definition as text', () => {
    for (const e of GLOSSARY) {
      expect(html.match(new RegExp(`id="${e.id}"`, 'g')), e.id).toHaveLength(1);
      expect(html, e.id).toContain(escapeHtml(e.term));
      expect(html, e.id).toContain(escapeHtml(e.definition));
    }
    expect(html.match(/<dt[\s>]/g)).toHaveLength(GLOSSARY.length);
    expect(html.match(/<dd[\s>]/g)).toHaveLength(GLOSSARY.length);
  });

  it('jump links point at each section on this page', () => {
    for (const g of GLOSSARY_GROUPS) {
      expect(html).toContain(`href="#${g.id}"`);
      expect(html).toContain(`id="${g.id}"`);
    }
  });

  it('no definition on the page contains a digit (no facts)', () => {
    const dds = [...html.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => text(m[1]));
    expect(dds).toHaveLength(GLOSSARY.length);
    for (const d of dds) expect(d).not.toMatch(/\d/);
  });

  it('only internal links: no external URLs, nothing styled as an official source', () => {
    for (const m of html.matchAll(/href="([^"]*)"/g)) expect(m[1]).toMatch(/^#[a-z0-9-]+$/);
    expect(html).not.toMatch(/rel="[^"]*nofollow/);
    expect(html).not.toMatch(/\b(?:text|bg|border)-(?:link|evidence|blue|sky)/);
  });

  it('says it is meanings only and not legal or immigration advice, with no chance or promise wording', () => {
    const copy = text(html);
    expect(copy).toMatch(/not legal or immigration advice/);
    expect(copy).toMatch(/do not give amounts, dates or requirements/);
    expect(copy).not.toMatch(/guarantee|\bchances?\b|probab/i);
    expect(html).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('root layout footer', () => {
  it('links to the glossary (internal, olive) next to the other footer links', () => {
    const page = renderToStaticMarkup(<RootLayout><p>body</p></RootLayout>);
    const footer = page.slice(page.indexOf('<footer'), page.indexOf('</footer>'));
    expect(footer).toMatch(/<a [^>]*href="\/glossary"[^>]*>Glossary<\/a>/);
    expect(footer).not.toMatch(/href="\/glossary"[^>]*rel=/);
    for (const href of ['/disclaimer', '/privacy', '/about', '/account', '/roadmap']) expect(footer).toContain(`href="${href}"`);
  });
});
