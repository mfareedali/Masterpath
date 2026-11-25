/**
 * Minimal robots.txt support (RFC 9309) for the evidence bot. Pure functions.
 *
 * Policy (deliberately conservative): within a set of groups the longest matching rule wins and Allow wins a tie.
 * Our own groups (naming our product token) are checked first: if one of their rules matches, it decides.
 * Otherwise the "*" groups decide, even when our own group exists (RFC 9309 would ignore "*" then; we honour
 * Disallow for both our user agent and "*"). No matching rule = allowed.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  /** Lower-cased user-agent values of the group. */
  agents: string[];
  rules: RobotsRule[];
}

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (current) current.rules.push({ allow: key === 'allow', pattern: value });
      lastWasAgent = false;
    }
    // Other lines (sitemap, crawl-delay, ...) neither start nor end a group.
  }
  return groups;
}

function normalizePercent(s: string): string {
  return s.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Length of `pattern` if it matches the start of `path` (with * wildcards and a trailing $ anchor), else -1. */
export function ruleMatchLength(pattern: string, path: string): number {
  if (!pattern) return -1;
  const anchored = pattern.endsWith('$');
  const body = normalizePercent(anchored ? pattern.slice(0, -1) : pattern);
  const re = new RegExp('^' + body.split('*').map(escapeRegex).join('.*') + (anchored ? '$' : ''));
  return re.test(normalizePercent(path)) ? pattern.length : -1;
}

function decide(rules: RobotsRule[], path: string): 'allow' | 'disallow' | 'none' {
  let best: { len: number; allow: boolean } | null = null;
  for (const r of rules) {
    const len = ruleMatchLength(r.pattern, path);
    if (len < 0) continue;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? (best.allow ? 'allow' : 'disallow') : 'none';
}

/**
 * True when `pathWithQuery` (e.g. "/study/masters?x=1") may be fetched by `productToken` under `robotsTxt`.
 * Honours Disallow rules for our product token AND for "*" (an explicit Allow in our own group wins).
 */
export function robotsAllows(robotsTxt: string, pathWithQuery: string, productToken = 'MastersPathIngest'): boolean {
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  if (path === '/robots.txt') return true;
  const token = productToken.toLowerCase();
  const groups = parseRobots(robotsTxt);
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && a.split('/')[0].trim() === token)).flatMap((g) => g.rules);
  const star = groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
  const mine = decide(own, path);
  if (mine !== 'none') return mine === 'allow';
  return decide(star, path) !== 'disallow';
}
