'use client';

/**
 * Fit panel (client island). Runs the pure fit engine in the browser, so the program page itself stays static and
 * cacheable. A valid profile in the page's link (shortlist and Plan B links carry ?cgpa=…&scale=…) wins over the
 * profile saved on this device, as on /shortlist and /plan-b, so one link never shows two different labels; that
 * link profile is kept in memory only and is never saved. Otherwise the device profile is used.
 * Shows a fit label only, never a probability. Next steps (Plan B, the program's own route below its minimum,
 * entering another scale) sit next to the label and never change it.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { ConfidenceBadge, FitBadge } from '@/components/ui/badges';
import { ButtonLink } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { NotVerified, SourceLink } from '@/components/ui/fact';
import { loadProfile } from '@/lib/profile-client';
import { planBHrefFor, readFitProfileJson, type FitProfileState } from '@/lib/program/fit-profile';
import { buildFitView } from '@/lib/program/fit-view';
import type { ConversionRule, Program } from '@/lib/types';
import { useBrowserSnapshot } from './use-local-store';

function readProfileSnapshot(): string | null {
  try {
    return readFitProfileJson(location.search, loadProfile);
  } catch {
    return null;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-2 first:border-t-0">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-base text-ink">{children}</dd>
    </div>
  );
}

export interface FitPanelProps {
  program: Program;
  rules: ConversionRule[];
  /** ISO time when the server clock is pinned (MASTERSPATH_NOW), so client and server agree in demos. */
  pinnedNow?: string | null;
  /** Link shown with "Not verified yet". */
  officialUrl?: string | null;
}

export function FitPanel(props: FitPanelProps) {
  const raw = useBrowserSnapshot(readProfileSnapshot);
  const state = useMemo<FitProfileState | null | undefined>(
    () => (raw === undefined ? undefined : raw ? (JSON.parse(raw) as FitProfileState) : null),
    [raw],
  );
  return <FitPanelView {...props} state={state} />;
}

/**
 * The panel itself. `state` is undefined while loading (server render and hydration), null when there is no
 * profile, otherwise the profile and where it came from.
 */
export function FitPanelView({
  program,
  rules,
  pinnedNow = null,
  officialUrl = null,
  state,
}: FitPanelProps & { state: FitProfileState | null | undefined }) {
  const profile = state?.profile ?? null;
  const view = useMemo(() => {
    if (!profile) return null;
    const now = pinnedNow ? new Date(pinnedNow) : new Date();
    return buildFitView(profile, program, rules, now);
  }, [profile, program, rules, pinnedNow]);

  return (
    <section id="fit" aria-labelledby="fit-title" className="scroll-mt-20">
      <Card>
        <h2 id="fit-title" className="text-xl font-bold">
          Your fit
        </h2>
        {/* Rendered on the server too, so the first paint already shows real text (faster LCP on phones). */}
        <p className="mt-1 text-sm text-muted">
          We compare your grade with this program&apos;s published minimum. Your grade is saved on this device; we never
          ask for ID numbers, and we never show admission chances.{' '}
          <Link href="/privacy" className="font-semibold">
            How we use your data
          </Link>
        </p>
        <div aria-live="polite" className="mt-2">
          {state === undefined ? (
            <div aria-busy="true" aria-label="Loading your fit">
              <Skeleton className="mb-2 h-7 w-40" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : !profile || !view ? (
            <div>
              <p className="text-base text-ink">Add your CGPA to see your fit</p>
              <ButtonLink href="/onboarding" className="mt-3">
                Add your CGPA
              </ButtonLink>
            </div>
          ) : (
            <>
              <FitBadge label={view.fit.label} />
              <p className="mt-2 break-words text-base text-ink">{view.fit.reason.message}</p>

              {view.showPlanB ? (
                <p className="mt-1">
                  <Link
                    href={planBHrefFor(profile, program.id)}
                    className="inline-flex min-h-tap items-center font-semibold text-primary-ink"
                  >
                    See other routes (Plan B)<span aria-hidden="true">&nbsp;→</span>
                  </Link>
                </p>
              ) : null}

              {view.noConversion ? (
                <div className="mt-2 rounded-button border border-line bg-page p-3 text-sm text-ink" data-next-step="other-scale">
                  <p>
                    If your transcript also states your grade on another scale (for example a percentage or out of 4.0),
                    you can enter that instead.
                  </p>
                  <Link href="/onboarding" className="inline-flex min-h-tap items-center font-semibold text-primary-ink">
                    Enter your grade on another scale<span aria-hidden="true">&nbsp;→</span>
                  </Link>
                  {view.noConversion.summary ? (
                    <p className="break-words">The official minimum, in short: {view.noConversion.summary}</p>
                  ) : null}
                  {view.noConversion.evidence ? (
                    <details className="mt-1">
                      <summary className="min-h-tap cursor-pointer py-2 font-semibold text-link md:min-h-0 md:py-0">
                        Evidence from the official page
                      </summary>
                      <blockquote className="evidence-quote mt-1">{view.noConversion.evidence}</blockquote>
                    </details>
                  ) : null}
                </div>
              ) : null}

              {view.conditional ? (
                <div className="mt-3 rounded-button border border-line bg-page p-3" data-conditional-route="">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-heading">
                    <span>This program publishes a route below its minimum</span>
                    <ConfidenceBadge confidence={view.conditional.confidence} />
                  </p>
                  {view.conditional.lines.map((line, i) => (
                    <p key={i} className="mt-1 break-words text-sm text-ink">
                      {line}
                    </p>
                  ))}
                  {view.conditional.note ? (
                    <p className="mt-1 text-xs text-muted">Note: {view.conditional.note}</p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3">
                    <SourceLink url={view.conditional.sourceUrl} label="Source" />
                    <a href="#entry" className="inline-flex min-h-tap items-center text-sm font-semibold md:min-h-0">
                      See it under Entry requirements
                    </a>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    It does not change your fit label above, and it is not an offer. Read the official page for what
                    this route asks of you.
                  </p>
                </div>
              ) : null}

              <dl className="mt-3">
                <Row label="Your grade">
                  <span>{view.grade}</span>
                  <Link href="/onboarding" className="inline-flex min-h-tap items-center text-sm font-semibold md:min-h-0">
                    Edit
                  </Link>
                  {state?.source === 'link' ? (
                    <span className="basis-full text-sm text-muted">
                      From the link you opened. It is not saved on this device.
                    </span>
                  ) : null}
                </Row>

                {view.converted ? (
                  <Row label={`Converted to ${view.converted.scaleLabel}`}>
                    <span className="font-semibold">{view.converted.value}</span>
                    {view.converted.isRange ? <span className="text-sm text-muted">(a range, not one number)</span> : null}
                  </Row>
                ) : null}

                <Row label="Program minimum">
                  {view.minimum.kind === 'value' ? (
                    <>
                      <span>{view.minimum.text}</span>
                      <ConfidenceBadge confidence={view.minimum.confidence} />
                      <SourceLink url={view.minimum.sourceUrl} label="Source" />
                      {view.minimum.note ? (
                        <span className="basis-full text-xs text-muted">Note: {view.minimum.note}</span>
                      ) : null}
                    </>
                  ) : view.minimum.kind === 'conflict' ? (
                    <>
                      <span className="font-semibold text-conflict-fg">Sources disagree</span>
                      <ConfidenceBadge confidence="Conflict" />
                      <a href="#entry" className="inline-flex min-h-tap items-center text-sm font-semibold md:min-h-0">
                        See both values
                      </a>
                    </>
                  ) : (
                    <>
                      <NotVerified officialUrl={officialUrl} />
                      <ConfidenceBadge confidence={view.minimum.confidence} />
                    </>
                  )}
                </Row>

                {view.conversion ? (
                  <Row label="Grade conversion">
                    {view.conversion.kind === 'same_scale' ? (
                      <span>Same scale, no conversion needed</span>
                    ) : view.conversion.kind === 'sourced' ? (
                      <SourceLink url={view.conversion.url} label="Conversion rule source" />
                    ) : (
                      <span className="text-muted">Conversion rule source not verified yet</span>
                    )}
                  </Row>
                ) : null}
              </dl>

              {view.showNarrowHint ? (
                <p className="mt-2 text-sm text-muted">
                  This is a range because the lowest passing grade on your transcript is not known.{' '}
                  <Link href="/onboarding" className="font-semibold">
                    Add it to your profile
                  </Link>{' '}
                  to narrow it.
                </p>
              ) : null}

              {view.ruleNotes ? (
                <details className="mt-2">
                  <summary className="min-h-tap cursor-pointer py-2 text-sm font-semibold text-primary-ink">
                    How the conversion works
                  </summary>
                  <p className="whitespace-pre-line break-words text-sm text-ink">{view.ruleNotes}</p>
                </details>
              ) : null}

              <p className="mt-3 text-xs text-muted">
                This label only compares your grade with the published minimum. It is not a chance of admission, and
                your research or publications do not change it.
              </p>
            </>
          )}
        </div>
      </Card>
    </section>
  );
}
