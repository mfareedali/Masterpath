import { describe, expect, it } from 'vitest';
import { PERSONA_B_STRENGTHS } from '../profile';
import {
  EMPTY_STRENGTHS,
  STRENGTH_LIMITS,
  addRow,
  cleanLine,
  cleanMultiline,
  emptyPublicationRow,
  emptyResearchRow,
  hasAnyStrengths,
  isDemoStrengths,
  normaliseLink,
  parseYear,
  removeRow,
  sanitizeStoredStrengths,
  sanitizeStrengths,
  splitLines,
  strengthsToValues,
  updateRow,
  validateStrengths,
  type StrengthsValues,
} from './strengths-form';

function form(over: Partial<StrengthsValues> = {}): StrengthsValues {
  return { publications: [emptyPublicationRow()], research: [emptyResearchRow()], other: '', free_text: '', ...over };
}

describe('normaliseLink', () => {
  it('keeps http(s) links', () => {
    expect(normaliseLink('https://fixture.example.edu/paper')).toBe('https://fixture.example.edu/paper');
    expect(normaliseLink('  http://fixture.example.edu ')).toBe('http://fixture.example.edu/');
  });
  it('adds https:// to a bare domain', () => {
    expect(normaliseLink('fixture.example.edu/abs/1')).toBe('https://fixture.example.edu/abs/1');
  });
  it('drops every other scheme and junk', () => {
    expect(normaliseLink('javascript:alert(1)')).toBeNull();
    expect(normaliseLink('JAVASCRIPT:alert(1)')).toBeNull();
    expect(normaliseLink('data:text/html,<b>x</b>')).toBeNull();
    expect(normaliseLink('mailto:someone@fixture.example.edu')).toBeNull();
    expect(normaliseLink('ftp://fixture.example.edu')).toBeNull();
    expect(normaliseLink('not a link')).toBeNull();
    expect(normaliseLink('https://user:pass@fixture.example.edu')).toBeNull();
    expect(normaliseLink('https://fixture.example.edu/' + 'a'.repeat(600))).toBeNull();
    expect(normaliseLink(42)).toBeNull();
    expect(normaliseLink('')).toBeNull();
  });
});

describe('text cleaning', () => {
  it('trims, collapses whitespace, strips control characters and caps length', () => {
    expect(cleanLine('  A   title\u0007 here ', 100)).toBe('A title here');
    expect(cleanLine('   ', 100)).toBeNull();
    expect(cleanLine('abcdef', 3)).toBe('abc');
    expect(cleanLine(null, 10)).toBeNull();
  });
  it('keeps line breaks in multi-line text', () => {
    expect(cleanMultiline(' line one\r\nline two\n\n\n\nline three ', 200)).toBe('line one\nline two\n\nline three');
    expect(cleanMultiline('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });
  it('splits one-per-line lists, dropping blanks and duplicates', () => {
    expect(splitLines('IELTS 7.0 (fixture)\n\n  Teaching assistant \nielts 7.0 (FIXTURE)\n')).toEqual([
      'IELTS 7.0 (fixture)',
      'Teaching assistant',
    ]);
    const many = Array.from({ length: 30 }, (_, i) => `item ${i}`).join('\n');
    expect(splitLines(many)).toHaveLength(STRENGTH_LIMITS.listItems);
  });
});

describe('parseYear', () => {
  it('accepts 4-digit years in range', () => {
    expect(parseYear('2026')).toBe(2026);
    expect(parseYear('')).toBeNull();
    expect(parseYear('26')).toBeNaN();
    expect(parseYear('1800')).toBeNaN();
    expect(parseYear('20x6')).toBeNaN();
  });
});

describe('validateStrengths', () => {
  it('accepts a blank form', () => {
    expect(validateStrengths(form())).toEqual({});
  });
  it('requires a title and status on a started publication row', () => {
    const errors = validateStrengths(
      form({ publications: [{ ...emptyPublicationRow(), venue: 'Fixture Workshop' }] }),
    );
    expect(errors['publications.0.title']).toBeTruthy();
    expect(errors['publications.0.status']).toBeTruthy();
  });
  it('flags bad years and non-http links', () => {
    const errors = validateStrengths(
      form({
        publications: [{ ...emptyPublicationRow(), title: 'T', status: 'preprint', year: '99', link: 'javascript:x' }],
        research: [{ ...emptyResearchRow(), lab: 'Fixture Lab', link: 'not a link' }],
      }),
    );
    expect(errors['publications.0.year']).toBeTruthy();
    expect(errors['publications.0.link']).toBeTruthy();
    expect(errors['research.0.link']).toBeTruthy();
  });
  it('limits the number of other-strength lines', () => {
    const other = Array.from({ length: STRENGTH_LIMITS.listItems + 1 }, (_, i) => `line ${i}`).join('\n');
    expect(validateStrengths(form({ other })).other).toBeTruthy();
  });
});

describe('sanitizeStrengths', () => {
  it('trims, drops empty rows and keeps only http(s) links', () => {
    const s = sanitizeStrengths(
      form({
        publications: [
          {
            title: '  Fixture paper on   small models ',
            venue: ' Fixture Workshop ',
            year: '2026',
            status: 'under_review',
            author_position: 'first',
            link: 'javascript:alert(1)',
          },
          emptyPublicationRow(),
          { ...emptyPublicationRow(), title: 'No status row' },
        ],
        research: [
          emptyResearchRow(),
          {
            lab: ' Fixture Lab ',
            supervisor: 'Dr Fixture',
            institution: '',
            link: 'fixture.example.edu/lab',
            role: 'RA',
            dates: '2025',
          },
        ],
        other: 'Fixture award\n\nFixture certificate\n',
        free_text: '  I like research.  ',
      }),
    );
    expect(s.publications).toEqual([
      {
        title: 'Fixture paper on small models',
        venue: 'Fixture Workshop',
        year: 2026,
        status: 'under_review',
        author_position: 'first',
        link: null,
      },
    ]);
    expect(s.research).toEqual([
      {
        lab: 'Fixture Lab',
        supervisor: 'Dr Fixture',
        institution: null,
        link: 'https://fixture.example.edu/lab',
        role: 'RA',
        dates: '2025',
      },
    ]);
    expect(s.other).toEqual(['Fixture award', 'Fixture certificate']);
    expect(s.free_text).toBe('I like research.');
  });

  it('caps the number of rows and the text lengths', () => {
    const pubs = Array.from({ length: 15 }, (_, i) => ({ ...emptyPublicationRow(), title: `P${i}`, status: 'published' }));
    const s = sanitizeStrengths(form({ publications: pubs, free_text: 'z'.repeat(5000) }));
    expect(s.publications).toHaveLength(STRENGTH_LIMITS.rows);
    expect(s.free_text).toHaveLength(STRENGTH_LIMITS.freeText);
  });

  it('keeps lists the form does not edit, sanitised', () => {
    const s = sanitizeStrengths(form(), {
      ...EMPTY_STRENGTHS,
      collaborators: [' Dr Fixture ', ''],
      code_data_links: ['https://fixture.example.edu/code', 'javascript:alert(1)'],
    });
    expect(s.collaborators).toEqual(['Dr Fixture']);
    expect(s.code_data_links).toEqual(['https://fixture.example.edu/code']);
  });

  it('produces empty strengths from a blank form', () => {
    const s = sanitizeStrengths(form());
    expect(hasAnyStrengths(s)).toBe(false);
    expect(s).toEqual(EMPTY_STRENGTHS);
  });
});

describe('stored strengths', () => {
  it('sanitises untrusted stored JSON', () => {
    expect(sanitizeStoredStrengths(null)).toBeNull();
    expect(sanitizeStoredStrengths('x')).toBeNull();
    expect(sanitizeStoredStrengths([])).toBeNull();
    const s = sanitizeStoredStrengths({
      publications: [{ title: 'Ok', status: 'published', link: 'javascript:1' }, 'junk', { title: '', status: 'x' }],
      research: 'nope',
      other: ['a', 5, ''],
      free_text: 12,
    });
    expect(s?.publications).toEqual([
      { title: 'Ok', venue: null, year: null, status: 'published', author_position: null, link: null },
    ]);
    expect(s?.research).toEqual([]);
    expect(s?.other).toEqual(['a', '5']);
  });

  it('round-trips persona B strengths through the form', () => {
    const v = strengthsToValues(PERSONA_B_STRENGTHS);
    expect(v.publications[0].title).toBe(PERSONA_B_STRENGTHS.publications[0].title);
    expect(v.publications[0].status).toBe('preprint');
    expect(v.research[0].supervisor).toBe(PERSONA_B_STRENGTHS.research[0].supervisor);
    const back = sanitizeStrengths(v, PERSONA_B_STRENGTHS);
    expect(back.publications).toEqual(PERSONA_B_STRENGTHS.publications);
    // The whole object survives a save unchanged, including the hidden "Fictional demo data." note.
    expect(back).toEqual(PERSONA_B_STRENGTHS);
    expect(isDemoStrengths(back)).toBe(true);
  });

  it('drops a research row whose visible fields are all blank, even with a hidden note', () => {
    const blanked = form({ research: [{ ...emptyResearchRow(), note: 'Fictional demo data.' }] });
    expect(sanitizeStrengths(blanked).research).toEqual([]);
    expect(sanitizeStoredStrengths({ research: [{ note: 'only a note' }] })?.research).toEqual([]);
  });

  it('always gives at least one empty row of each kind', () => {
    const v = strengthsToValues(null);
    expect(v.publications).toEqual([emptyPublicationRow()]);
    expect(v.research).toEqual([emptyResearchRow()]);
    expect(v.other).toBe('');
  });

  it('recognises the demo strengths', () => {
    expect(isDemoStrengths(JSON.parse(JSON.stringify(PERSONA_B_STRENGTHS)))).toBe(true);
    expect(isDemoStrengths(EMPTY_STRENGTHS)).toBe(false);
    expect(isDemoStrengths(null)).toBe(false);
  });
});

describe('row helpers', () => {
  it('adds up to the limit, removes and updates immutably', () => {
    const rows = [emptyPublicationRow()];
    const two = addRow(rows, emptyPublicationRow());
    expect(two).toHaveLength(2);
    expect(rows).toHaveLength(1);
    const full = Array.from({ length: STRENGTH_LIMITS.rows }, emptyPublicationRow);
    expect(addRow(full, emptyPublicationRow())).toHaveLength(STRENGTH_LIMITS.rows);
    expect(removeRow(two, 0, emptyPublicationRow)).toHaveLength(1);
    expect(removeRow(rows, 0, emptyPublicationRow)).toEqual([emptyPublicationRow()]);
    const updated = updateRow(two, 1, 'title', 'New');
    expect(updated[1].title).toBe('New');
    expect(two[1].title).toBe('');
  });
});
