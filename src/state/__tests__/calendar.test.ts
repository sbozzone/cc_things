import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDatabase } from '@/core/db';
import { applyPatches, type EntityPatch } from '@/core/patches';
import type { Database } from '@/core/types';
import { CALENDAR_PARSER_VERSION } from '@/core/calendar';
import { refreshStaleCalendars, refreshSubscription, setSubscriptionEnabled } from '../calendar';

let state: { ownerId: string; today: string; db: Database; dispatch: (patches: EntityPatch[]) => void };
vi.mock('../store', () => ({ useApp: { getState: () => state } }));

const now = '2026-10-06T12:00:00.000Z';
const feed = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:day-off@example.com',
  'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261010',
  'SUMMARY:Day off', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  state = {
    ownerId: 'owner', today: '2026-10-06', db: emptyDatabase('owner', now, 'America/Indianapolis'),
    dispatch: (patches) => { state.db = applyPatches(state.db, patches); },
  };
  state.db.calendarSubscriptions.cal = {
    id: 'cal', ownerId: 'owner', providerId: 'ics', calendarId: 'cal', title: 'Work',
    url: 'https://example.com/work.ics', enabled: true, lastRefreshedAt: null, lastError: null,
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: feed, fetchedAt: now }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('calendar refresh lifecycle', () => {
  it('loads a saved connection with no cache when the app starts', async () => {
    await refreshStaleCalendars();
    expect(Object.values(state.db.calendarEvents)).toMatchObject([
      { title: 'Day off', startDate: '2026-10-09', endDate: '2026-10-09' },
    ]);
    expect(state.db.calendarSubscriptions.cal?.lastError).toBeNull();
  });

  it('fetches a recently refreshed calendar immediately when its emptied cache is re-enabled', async () => {
    const subscription = state.db.calendarSubscriptions.cal!;
    subscription.enabled = false;
    subscription.lastRefreshedAt = now;
    subscription.parserVersion = CALENDAR_PARSER_VERSION;
    setSubscriptionEnabled('cal', true);
    await vi.waitFor(() => expect(Object.values(state.db.calendarEvents)).toHaveLength(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'removed', 'signed out'])('ignores a feed arriving after its connection is %s', async (change) => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = refreshSubscription('cal', true);
    if (change === 'disabled') state.db.calendarSubscriptions.cal!.enabled = false;
    if (change === 'removed') delete state.db.calendarSubscriptions.cal;
    if (change === 'signed out') state.ownerId = 'another-owner';
    finish(new Response(JSON.stringify({ text: feed, fetchedAt: now })));
    await pending;
    expect(Object.values(state.db.calendarEvents)).toHaveLength(0);
    if (change === 'removed') expect(state.db.calendarSubscriptions.cal).toBeUndefined();
  });
});
