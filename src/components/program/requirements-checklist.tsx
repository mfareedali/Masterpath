'use client';

/**
 * Requirements checklist (client island). Items and their confidence come from the server (built from data rows);
 * only the ticks are stored, in localStorage 'mp_checklist_<programId>', so it works offline.
 */
import { useMemo } from 'react';
import { ConfidenceBadge } from '@/components/ui/badges';
import { Card } from '@/components/ui/card';
import {
  checklistStorageKey,
  parseChecked,
  progressText,
  serializeChecked,
  toggleChecked,
  type ChecklistItem,
} from '@/lib/program/checklist';
import { useLocalString, writeLocal } from './use-local-store';

export function RequirementsChecklist({ programId, items }: { programId: string; items: ChecklistItem[] }) {
  const storageKey = checklistStorageKey(programId);
  const raw = useLocalString(storageKey);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const checked = useMemo(() => parseChecked(raw, ids), [raw, ids]);
  const pct = items.length ? Math.round((checked.length / items.length) * 100) : 0;

  function toggle(id: string) {
    writeLocal(storageKey, serializeChecked(toggleChecked(checked, id)));
  }

  return (
    <section id="checklist" aria-labelledby="checklist-title" className="scroll-mt-20">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 id="checklist-title" className="text-xl font-bold">
            Requirements checklist
          </h2>
          <p className="text-sm font-semibold text-heading" aria-live="polite">
            {progressText(checked.length, items.length)}
          </p>
        </div>
        <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-chip bg-surface-tint">
          <div className="h-2 bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">Your ticks are saved on this phone only and work offline.</p>

        <ul className="mt-1 divide-y divide-line">
          {items.map((item) => {
            const done = checked.includes(item.id);
            const inputId = `check-${programId}-${item.id}`;
            return (
              <li key={item.id}>
                <label htmlFor={inputId} className="flex min-h-tap cursor-pointer items-start gap-3 py-3">
                  <input
                    id={inputId}
                    type="checkbox"
                    className="mt-0.5 h-6 w-6 shrink-0 accent-primary"
                    checked={done}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`font-semibold ${done ? 'text-muted line-through' : 'text-ink'}`}>{item.label}</span>
                      <ConfidenceBadge confidence={item.confidence} />
                    </span>
                    <span className="mt-0.5 block break-words text-sm text-muted">{item.detail}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
