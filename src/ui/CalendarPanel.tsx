'use client';

import { useState } from 'react';
import { CACHE_STALE_MS } from '@/core/calendar';
import { useApp } from '@/state/store';
import { addSubscription, refreshSubscription, removeSubscription, setSubscriptionEnabled } from '@/state/calendar';
import { Button, IconButton } from './primitives';
import { AlertIcon, CalendarIcon, TrashIcon } from './icons';

/**
 * Calendar connection, selection and removal (R20).
 *
 * Events are shown read-only above tasks in Today and on the matching Upcoming day.
 * Nothing here can complete or reschedule a task, and removing a calendar clears its
 * cached events while leaving every task alone.
 */
export function CalendarPanel() {
  const subscriptions = useApp((s) => Object.values(s.db.calendarSubscriptions));
  const eventCount = useApp((s) => Object.keys(s.db.calendarEvents).length);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!url.trim()) return;
    setBusy(true);
    const id = addSubscription(title, url);
    await refreshSubscription(id, true);
    setTitle('');
    setUrl('');
    setBusy(false);
  };

  return (
    <div className="py-2">
      <p className="mb-3 text-[13.5px] text-muted">
        Connect a calendar by its secret iCalendar (<code className="rounded bg-surface-2 px-1">.ics</code>) address.
        In Google Calendar it is under Settings → your calendar → “Secret address in iCal format”; iCloud and Outlook
        both offer a published feed. Access is read-only and one-way: a calendar change can never complete or
        reschedule a task.
      </p>

      {subscriptions.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {subscriptions.map((subscription) => {
            const stale =
              subscription.lastRefreshedAt !== null &&
              Date.now() - Date.parse(subscription.lastRefreshedAt) > CACHE_STALE_MS;
            return (
              <li key={subscription.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <CalendarIcon size={15} className="text-[var(--upcoming)]" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{subscription.title}</span>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    <input
                      type="checkbox"
                      checked={subscription.enabled}
                      onChange={(event) => setSubscriptionEnabled(subscription.id, event.target.checked)}
                      className="h-4 w-4"
                    />
                    Show
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => void refreshSubscription(subscription.id, true)}>Refresh</Button>
                  <IconButton label={`Remove ${subscription.title}`} tone="danger" onClick={() => removeSubscription(subscription.id)}>
                    <TrashIcon />
                  </IconButton>
                </div>
                <p className="mt-1 truncate text-[12px] text-faint">{subscription.url}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {subscription.lastError ? (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <AlertIcon size={12} />{subscription.lastError}
                    </span>
                  ) : subscription.lastRefreshedAt ? (
                    <>
                      Last refreshed {new Date(subscription.lastRefreshedAt).toLocaleString()}
                      {stale ? ' — this data may be out of date' : ''}
                    </>
                  ) : (
                    'Not refreshed yet'
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      <form
        className="rounded-lg border border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <h3 className="text-[14px] font-semibold">Add a calendar</h3>
        <label className="mt-2 block text-[13px]">
          <span className="mb-1 block text-muted">Name</span>
          <input
            type="text"
            value={title}
            placeholder="Work"
            onChange={(event) => setTitle(event.target.value)}
            className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
          />
        </label>
        <label className="mt-2 block text-[13px]">
          <span className="mb-1 block text-muted">Feed address</span>
          <input
            type="url"
            required
            value={url}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            onChange={(event) => setUrl(event.target.value)}
            className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
          />
        </label>
        <div className="mt-3">
          <Button size="sm" variant="primary" type="submit" disabled={busy || !url.trim()}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </form>

      <p className="mt-3 text-[12.5px] text-faint">
        {eventCount} event{eventCount === 1 ? '' : 's'} cached for the next two months. The cache lives on this device
        only: it is never synced as task data and never appears in an export.
      </p>
    </div>
  );
}
