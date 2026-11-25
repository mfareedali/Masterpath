import { describe, expect, it } from 'vitest';
import { PERSONA_A } from '../profile';
import { profileShortlistPath } from './index';
import { SHARE_PRIVACY_LINE, absoluteShareUrl, shareShortlistText, whatsappShareHref } from './share';

const ORIGIN = 'https://masterspath.example';

describe('Share my shortlist', () => {
  const url = absoluteShareUrl(profileShortlistPath(PERSONA_A, { rank: 'deadline' }), ORIGIN)!;

  it('the link is on our own site and carries the profile params only', () => {
    expect(url.startsWith(`${ORIGIN}/shortlist?`)).toBe(true);
    const u = new URL(url);
    expect([...u.searchParams.keys()].sort()).toEqual(['budget', 'cgpa', 'countries', 'field', 'rank', 'scale']);
  });

  it('the text has no name or university, no outcome wording, and stays under 1,500 characters', () => {
    const text = shareShortlistText(url);
    expect(text).toContain(url);
    expect(text.length).toBeLessThan(1500);
    expect(decodeURIComponent(text)).not.toMatch(/Demo Private University|university_name|BS Computer Science|persona/i);
    expect(text).not.toMatch(/guarantee|chance|probabilit|admit|will get/i);
    expect(text).toMatch(/^My Masters shortlist on MastersPath \(free, open source\)\./);
  });

  it('WhatsApp link encodes the whole message', () => {
    const text = shareShortlistText(url);
    const wa = whatsappShareHref(text);
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(wa.slice('https://wa.me/?text='.length))).toBe(text);
  });

  it('absoluteShareUrl accepts same-site paths only', () => {
    expect(absoluteShareUrl('/shortlist?cgpa=2.5&scale=cgpa_4', ORIGIN)).toBe(`${ORIGIN}/shortlist?cgpa=2.5&scale=cgpa_4`);
    expect(absoluteShareUrl('//evil.example/x', ORIGIN)).toBeNull();
    expect(absoluteShareUrl('https://evil.example/x', ORIGIN)).toBeNull();
    expect(absoluteShareUrl('javascript:alert(1)', ORIGIN)).toBeNull();
    expect(absoluteShareUrl('shortlist', ORIGIN)).toBeNull();
  });

  it('the privacy line names what the link holds and what it never holds', () => {
    expect(SHARE_PRIVACY_LINE).toBe(
      'The link contains your grade, field, budget and countries. It never contains your name or university.',
    );
  });
});
