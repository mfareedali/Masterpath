/**
 * Where to send privacy questions. The public repository does not exist yet (DECISIONS.md #20), so no GitHub URL is
 * hard-coded: set NEXT_PUBLIC_REPO_URL (e.g. https://github.com/<owner>/<repo>) once it does. Until then the pages
 * name GitHub issues without a link. Pure, so it is unit-tested.
 */

const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/** "https://github.com/<owner>/<repo>[.git][/...]" -> "https://github.com/<owner>/<repo>/issues"; anything else -> null. */
export function repoIssuesUrl(repoUrl: string | null | undefined): string | null {
  if (!repoUrl) return null;
  let u: URL;
  try {
    u = new URL(repoUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com' || u.username || u.password || u.port) return null;
  const [owner, rawRepo] = u.pathname.split('/').filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/i, '');
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo) || repo === '.' || repo === '..') return null;
  return `https://github.com/${owner}/${repo}/issues`;
}

/** Read with a literal process.env expression so Next inlines it at build time. */
export function configuredIssuesUrl(): string | null {
  return repoIssuesUrl(process.env.NEXT_PUBLIC_REPO_URL);
}
