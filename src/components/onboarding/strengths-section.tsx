'use client';

/**
 * Optional "Add your strengths" step (P1). Collapsible (details/summary), controlled by the onboarding form.
 * Strengths never change the fit label; they only help research-led routes and the SOP.
 */
import type { Ref } from 'react';
import { Callout } from '@/components/ui/card';
import { Field, INPUT_CLASS, TEXTAREA_CLASS } from './field';
import {
  AUTHOR_POSITIONS,
  PUBLICATION_STATUSES,
  STRENGTH_LIMITS,
  addRow,
  emptyPublicationRow,
  emptyResearchRow,
  removeRow,
  updateRow,
  type PublicationRow,
  type ResearchRow,
  type StrengthsValues,
} from '@/lib/onboarding/strengths-form';

const SMALL_BUTTON =
  'btn-secondary-type inline-flex min-h-tap items-center justify-center gap-1 rounded-button border px-3 text-sm transition-colors';

interface Props {
  idPrefix: string;
  values: StrengthsValues;
  errors: Record<string, string>;
  defaultOpen: boolean;
  onChange: (next: StrengthsValues) => void;
  ref?: Ref<HTMLDetailsElement>;
}

export function StrengthsSection({ idPrefix, values, errors, defaultOpen, onChange, ref }: Props) {
  const id = (k: string) => `${idPrefix}-${k.replace(/\./g, '-')}`;
  const err = (k: string) => errors[k];

  function setPub<K extends keyof PublicationRow>(i: number, key: K, v: PublicationRow[K]) {
    onChange({ ...values, publications: updateRow(values.publications, i, key, v) });
  }
  function setRes<K extends keyof ResearchRow>(i: number, key: K, v: ResearchRow[K]) {
    onChange({ ...values, research: updateRow(values.research, i, key, v) });
  }

  return (
    <details ref={ref} open={defaultOpen} className="group rounded-card border border-line bg-surface shadow-card">
      <summary className="flex min-h-tap cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden justify-between gap-3 px-4 py-3 text-lg font-bold text-heading">
        <span>Add your strengths (optional)</span>
        <span aria-hidden="true" className="text-primary-ink transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>

      <div className="space-y-6 border-t border-line px-4 pb-5 pt-4">
        <Callout tone="neutral" title="Strengths never change your fit label">
          They can matter for research-led routes and for your statement of purpose (SOP). Add only what is true and
          what you can show.
        </Callout>

        <noscript>
          <p className="text-sm text-muted">Saving strengths needs JavaScript. Your grade, field and budget still work.</p>
        </noscript>

        {/* Publications */}
        <fieldset className="space-y-3">
          <legend className=" text-base font-bold text-heading">Publications</legend>
          {values.publications.map((row, i) => (
            <fieldset key={i} className="space-y-3 rounded-button border border-line bg-page p-3">
              <legend className="px-1 text-sm font-bold text-heading">Publication {i + 1}</legend>
              <Field id={id(`publications.${i}.title`)} label="Title" error={err(`publications.${i}.title`)}>
                {(c) => (
                  <input
                    {...c}
                    type="text"
                    value={row.title}
                    maxLength={STRENGTH_LIMITS.title}
                    onChange={(e) => setPub(i, 'title', e.target.value)}
                    className={INPUT_CLASS}
                  />
                )}
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field id={id(`publications.${i}.venue`)} label="Journal, conference or server" optional>
                  {(c) => (
                    <input
                      {...c}
                      type="text"
                      value={row.venue}
                      maxLength={STRENGTH_LIMITS.venue}
                      onChange={(e) => setPub(i, 'venue', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
                <Field id={id(`publications.${i}.year`)} label="Year" optional error={err(`publications.${i}.year`)}>
                  {(c) => (
                    <input
                      {...c}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={row.year}
                      maxLength={4}
                      onChange={(e) => setPub(i, 'year', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
                <Field id={id(`publications.${i}.status`)} label="Status" error={err(`publications.${i}.status`)}>
                  {(c) => (
                    <select
                      {...c}
                      value={row.status}
                      onChange={(e) => setPub(i, 'status', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">Choose…</option>
                      {PUBLICATION_STATUSES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id={id(`publications.${i}.author_position`)} label="Your author position" optional>
                  {(c) => (
                    <select
                      {...c}
                      value={row.author_position}
                      onChange={(e) => setPub(i, 'author_position', e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">Not sure</option>
                      {AUTHOR_POSITIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              <Field id={id(`publications.${i}.link`)} label="Link" optional error={err(`publications.${i}.link`)}>
                {(c) => (
                  <input
                    {...c}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://"
                    value={row.link}
                    maxLength={STRENGTH_LIMITS.link}
                    onChange={(e) => setPub(i, 'link', e.target.value)}
                    className={`${INPUT_CLASS} break-all`}
                  />
                )}
              </Field>
              <button
                type="button"
                onClick={() => onChange({ ...values, publications: removeRow(values.publications, i, emptyPublicationRow) })}
                className={`${SMALL_BUTTON} border-line bg-surface text-primary-ink hover:bg-surface-tint`}
              >
                {values.publications.length > 1 ? `Remove publication ${i + 1}` : 'Clear this publication'}
              </button>
            </fieldset>
          ))}
          {values.publications.length < STRENGTH_LIMITS.rows ? (
            <button
              type="button"
              onClick={() => onChange({ ...values, publications: addRow(values.publications, emptyPublicationRow()) })}
              className={`${SMALL_BUTTON} border-primary bg-surface text-primary-ink hover:bg-surface-tint`}
            >
              <span aria-hidden="true">+</span> Add another publication
            </button>
          ) : null}
        </fieldset>

        {/* Research experience */}
        <fieldset className="space-y-3">
          <legend className=" text-base font-bold text-heading">Research experience</legend>
          {values.research.map((row, i) => (
            <fieldset key={i} className="space-y-3 rounded-button border border-line bg-page p-3">
              <legend className="px-1 text-sm font-bold text-heading">Research {i + 1}</legend>
              <div className="grid gap-3 md:grid-cols-2">
                <Field id={id(`research.${i}.lab`)} label="Lab or group" optional>
                  {(c) => (
                    <input
                      {...c}
                      type="text"
                      value={row.lab}
                      maxLength={STRENGTH_LIMITS.institution}
                      onChange={(e) => setRes(i, 'lab', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
                <Field id={id(`research.${i}.supervisor`)} label="Supervisor" optional>
                  {(c) => (
                    <input
                      {...c}
                      type="text"
                      value={row.supervisor}
                      maxLength={STRENGTH_LIMITS.short}
                      onChange={(e) => setRes(i, 'supervisor', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
                <Field id={id(`research.${i}.institution`)} label="Institution" optional>
                  {(c) => (
                    <input
                      {...c}
                      type="text"
                      value={row.institution}
                      maxLength={STRENGTH_LIMITS.institution}
                      onChange={(e) => setRes(i, 'institution', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
                <Field id={id(`research.${i}.role`)} label="Your role" optional>
                  {(c) => (
                    <input
                      {...c}
                      type="text"
                      value={row.role}
                      maxLength={STRENGTH_LIMITS.short}
                      placeholder="e.g. Research assistant"
                      onChange={(e) => setRes(i, 'role', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
                <Field id={id(`research.${i}.dates`)} label="Dates" optional>
                  {(c) => (
                    <input
                      {...c}
                      type="text"
                      value={row.dates}
                      maxLength={STRENGTH_LIMITS.dates}
                      placeholder="e.g. Jan 2025 – Jun 2026"
                      onChange={(e) => setRes(i, 'dates', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
                <Field id={id(`research.${i}.link`)} label="Link" optional error={err(`research.${i}.link`)}>
                  {(c) => (
                    <input
                      {...c}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://"
                      value={row.link}
                      maxLength={STRENGTH_LIMITS.link}
                      onChange={(e) => setRes(i, 'link', e.target.value)}
                      className={`${INPUT_CLASS} break-all`}
                    />
                  )}
                </Field>
              </div>
              <button
                type="button"
                onClick={() => onChange({ ...values, research: removeRow(values.research, i, emptyResearchRow) })}
                className={`${SMALL_BUTTON} border-line bg-surface text-primary-ink hover:bg-surface-tint`}
              >
                {values.research.length > 1 ? `Remove research ${i + 1}` : 'Clear this research'}
              </button>
            </fieldset>
          ))}
          {values.research.length < STRENGTH_LIMITS.rows ? (
            <button
              type="button"
              onClick={() => onChange({ ...values, research: addRow(values.research, emptyResearchRow()) })}
              className={`${SMALL_BUTTON} border-primary bg-surface text-primary-ink hover:bg-surface-tint`}
            >
              <span aria-hidden="true">+</span> Add more research
            </button>
          ) : null}
        </fieldset>

        <Field
          id={id('other')}
          label="Other strengths"
          optional
          hint="One per line: jobs, awards, certifications, test scores, recommenders."
          error={err('other')}
        >
          {(c) => (
            <textarea
              {...c}
              rows={4}
              value={values.other}
              maxLength={STRENGTH_LIMITS.listItems * (STRENGTH_LIMITS.listItem + 1)}
              onChange={(e) => onChange({ ...values, other: e.target.value })}
              className={TEXTAREA_CLASS}
            />
          )}
        </Field>

        <Field id={id('free_text')} label="Anything else you want to mention" optional>
          {(c) => (
            <textarea
              {...c}
              rows={4}
              value={values.free_text}
              maxLength={STRENGTH_LIMITS.freeText}
              onChange={(e) => onChange({ ...values, free_text: e.target.value })}
              className={TEXTAREA_CLASS}
            />
          )}
        </Field>
      </div>
    </details>
  );
}
