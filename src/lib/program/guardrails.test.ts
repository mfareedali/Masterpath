/**
 * Static guardrails for the program page workstream: product rules that are easy to break by accident.
 * Scans the source files of src/app/program, src/components/program, src/app/api/report and src/lib/program.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const ROOTS = ['app/program', 'components/program', 'app/api/report', 'lib/program'].map((r) => join(SRC, r));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|mts)$/.test(name) ? [full] : [];
  });
}

const files = ROOTS.flatMap(walk).filter((f) => !f.endsWith('guardrails.test.ts'));
const sources = files.map((f) => ({ name: relative(SRC, f), text: readFileSync(f, 'utf8') }));
const appSources = sources.filter((s) => !/\.test\.tsx?$/.test(s.name));

describe('program workstream guardrails', () => {
  it('finds the source files', () => {
    expect(appSources.length).toBeGreaterThan(8);
  });

  it('never renders HTML from strings', () => {
    for (const s of sources) expect(s.text, s.name).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=/);
  });

  it('uses only brand tokens (the default Tailwind palette does not exist)', () => {
    const palette =
      /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|accent)-(?:red|gray|grey|blue|green|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|black)(?:-\d{2,3})?\b/;
    for (const s of appSources) expect(s.text, s.name).not.toMatch(palette);
  });

  it('never uses yellow text', () => {
    for (const s of appSources) expect(s.text, s.name).not.toMatch(/\btext-(?:accent|yellow-\d{3})\b/);
  });

  it('shows no admission probabilities or promises', () => {
    const banned = /(?:\d+\s*%\s*chance|chance of (?:getting in|acceptance)|admission probability|guaranteed admission|fastest citizenship)/i;
    for (const s of appSources) expect(s.text, s.name).not.toMatch(banned);
  });

  it('opens external links only through SourceLink / NotVerified', () => {
    for (const s of appSources) expect(s.text, s.name).not.toMatch(/target="_blank"/);
  });

  it('does not read cookies or searchParams on the static program page', () => {
    const page = appSources.find((s) => s.name.replace(/\\/g, '/') === 'app/program/[id]/page.tsx');
    expect(page).toBeDefined();
    const code = page!.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bcookies\(|searchParams|getRequestProfile|headers\(/);
    expect(page!.text).toMatch(/export const revalidate = 3600;/);
    expect(page!.text).toMatch(/export async function generateStaticParams/);
  });

  it('does not ask for passport or ID numbers', () => {
    for (const s of appSources) expect(s.text, s.name).not.toMatch(/passport|cnic|national id/i);
  });
});
