import { safeHref } from '@/lib/format';
import { configuredIssuesUrl } from './contact';

/** Links to the repository's GitHub issues when NEXT_PUBLIC_REPO_URL is set; plain text otherwise (never a guessed URL). */
export function IssuesLink({ children }: { children: React.ReactNode }) {
  const href = safeHref(configuredIssuesUrl());
  if (!href) return <>{children}</>;
  return (
    <a href={href} rel="noopener noreferrer nofollow" className="font-semibold break-words">
      {children}
    </a>
  );
}
