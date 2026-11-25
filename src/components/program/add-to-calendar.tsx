'use client';

/**
 * "Add deadline to my calendar" (client leaf). The server passes a ready event (only for a usable deadline that
 * had not passed when the page was built); the browser builds the .ics on click with its own clock and downloads
 * it from a Blob. Nothing is sent anywhere. A cached page opened after the date hides the button.
 */
import { useState, useSyncExternalStore } from 'react';
import { buttonClass } from '@/components/ui/button';
import { clientNow } from '@/components/ui/days-left';
import { buildIcs, isPassedDate, type CalendarEvent } from '@/lib/calendar';

const noopSubscribe = () => () => {};

export function AddToCalendar({ event, pinnedNow = null }: { event: CalendarEvent; pinnedNow?: string | null }) {
  // Server snapshot: not passed (the server only passes events that had not passed), so the button is in the HTML.
  const passed = useSyncExternalStore(
    noopSubscribe,
    () => isPassedDate(event.date, clientNow(pinnedNow)),
    () => false,
  );
  const [status, setStatus] = useState<'idle' | 'done' | 'failed'>('idle');
  if (passed) return null;

  function onClick() {
    try {
      const ics = buildIcs([event], clientNow(pinnedNow));
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = event.filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('done');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={onClick} className={buttonClass('secondary', 'text-sm')}>
        Add deadline to my calendar
      </button>
      <span role="status" className="text-xs text-muted">
        {status === 'done'
          ? 'Calendar file downloaded. Open it to add the reminder.'
          : status === 'failed'
            ? 'Your browser blocked the download. Add the date by hand.'
            : ''}
      </span>
    </span>
  );
}
