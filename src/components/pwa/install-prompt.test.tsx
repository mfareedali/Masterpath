/** "Install the app" popup: pure helpers, both card variants, and the layout mount (empty on the server). */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RootLayout from '@/app/layout';
import { DISMISS_DAYS, INSTALL_TITLE, IOS_STEPS, InstallPromptView, dismissalExpired, isIosSafari } from './install-prompt';

const DAY = 24 * 60 * 60 * 1000;
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

describe('isIosSafari', () => {
  it('matches iPhone Safari and iPadOS Safari (reported as a Mac with touch)', () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafari(IPAD_AS_MAC, 5)).toBe(true);
  });
  it('ignores other iOS browsers, desktop Safari and Android', () => {
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
    expect(isIosSafari(IPAD_AS_MAC, 0)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME)).toBe(false);
  });
});

describe('dismissalExpired', () => {
  const now = Date.UTC(2026, 10, 28);
  it('shows when never dismissed or the stored value is junk', () => {
    expect(dismissalExpired(null, now)).toBe(true);
    expect(dismissalExpired('nope', now)).toBe(true);
  });
  it(`stays hidden for ${DISMISS_DAYS} days after "Not now"`, () => {
    expect(dismissalExpired(String(now - DAY), now)).toBe(false);
    expect(dismissalExpired(String(now - (DISMISS_DAYS + 1) * DAY), now)).toBe(true);
  });
});

describe('InstallPromptView', () => {
  it('prompt mode: title, logo, Not now and Install buttons', () => {
    const html = renderToStaticMarkup(createElement(InstallPromptView, { mode: 'prompt' }));
    expect(html).toContain('data-install-prompt="prompt"');
    expect(html).toContain(INSTALL_TITLE);
    expect(html).toContain('logo-mark-light.png');
    expect(html).toContain('>Not now<');
    expect(html).toContain('>Install<');
    expect(html).toContain('aria-label="Close"');
  });
  it('iOS mode: explains Share then Add to Home Screen, no Install button', () => {
    const html = renderToStaticMarkup(createElement(InstallPromptView, { mode: 'ios' }));
    expect(html).toContain(IOS_STEPS);
    expect(html).toContain('>Got it<');
    expect(html).not.toContain('>Install<');
  });
});

describe('root layout', () => {
  it('mounts the popup but renders nothing on the server', () => {
    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement('p', null, 'x')));
    expect(html).not.toContain('data-install-prompt');
  });
});
