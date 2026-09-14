'use client';

import { addDays } from '@/core/dates';
import { CACHE_STALE_MS, CALENDAR_PARSER_VERSION, parseIcs, toCacheRecords } from '@/core/calendar';
import { newId } from '@/core/ids';
import type { EntityPatch } from '@/core/patches';
import type { CalendarSubscription } from '@/core/types';
import { useApp } from './store';

/**
 * Calendar cache maintenance (R21).
 *
 * The window is deliberately bounded, the cache is refreshed when it is older than five
 * minutes, and every refresh replaces that calendar's instances so a moved or cancelled
 * event never leaves a duplicate row behind.
 */

const WINDOW_BEFORE_DAYS = 7;
const WINDOW_AFTER_DAYS = 60;

export function addSubscription(title: string, url: string): string {
  const state = useApp.getState();
  const id = newId('cal_');
  const subscription: CalendarSubscription = {
    id,
    ownerId: state.ownerId,
    providerId: 'ics',
    calendarId: id,
    title: title.trim() || 'Calendar',
    url: url.trim(),
    enabled: true,
    lastRefreshedAt: null,
    lastError: null,
  };
  // Calendar selection and its cache stay device-local: they are never synced as tasks
  // and never leave in an export (R35).
  state.dispatch([{ table: 'calendarSubscriptions', id, patch: subscription as unknown as Record<string, unknown>, create: true }], { local: true });
  return id;
}

export function setSubscriptionEnabled(id: string, enabled: boolean): void {
  const state = useApp.getState();
  const patches: EntityPatch[] = [{ table: 'calendarSubscriptions', id, patch: { enabled } }];
  if (!enabled) patches.push(...clearCachePatches(id));
  state.dispatch(patches, { local: true });
}

/** Removing a calendar clears its cached events but never touches a task (R20). */
export function removeSubscription(id: string): void {
  const state = useApp.getState();
  state.dispatch(
    [{ table: 'calendarSubscriptions', id, patch: {}, remove: true }, ...clearCachePatches(id)],
    { local: true },
  );
}

function clearCachePatches(calendarId: string): EntityPatch[] {
  const { db } = useApp.getState();
  return Object.values(db.calendarEvents)
    .filter((event) => event.calendarId === calendarId)
    .map((event) => ({ table: 'calendarEvents' as const, id: event.id, patch: {}, remove: true }));
}

export async function refreshSubscription(id: string, force = false): Promise<void> {
  const state = useApp.getState();
  const subscription = state.db.calendarSubscriptions[id];
  if (!subscription || !subscription.enabled) return;
  if (!force && subscription.lastRefreshedAt) {
    const age = Date.now() - Date.parse(subscription.lastRefreshedAt);
    if (age < CACHE_STALE_MS) return;
  }

  try {
    const response = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: subscription.url }),
    });
    const body = (await response.json()) as { text?: string; error?: string; fetchedAt?: string };
    if (!response.ok || !body.text) {
      useApp.getState().dispatch(
        [{ table: 'calendarSubscriptions', id, patch: { lastError: body.error ?? 'Could not refresh.' } }],
        { local: true },
      );
      return;
    }

    const today = useApp.getState().today;
    const windowStart = addDays(today, -WINDOW_BEFORE_DAYS);
    const windowEnd = addDays(today, WINDOW_AFTER_DAYS);
    const refreshedAt = body.fetchedAt ?? new Date().toISOString();
    const records = toCacheRecords(
      parseIcs(body.text, windowStart, windowEnd, useApp.getState().db.settings.planningTimeZone),
      useApp.getState().ownerId,
      subscription.providerId,
      subscription.calendarId,
      refreshedAt,
    );

    const current = useApp.getState().db.calendarEvents;
    const keep = new Set(records.map((record) => record.id));
    const patches: EntityPatch[] = [];
    for (const event of Object.values(current)) {
      // Instances that vanished from the feed are removed, not left behind.
      if (event.calendarId === subscription.calendarId && !keep.has(event.id)) {
        patches.push({ table: 'calendarEvents', id: event.id, patch: {}, remove: true });
      }
    }
    for (const record of records) {
      patches.push({ table: 'calendarEvents', id: record.id, patch: record as unknown as Record<string, unknown>, create: true });
    }
    patches.push({
      table: 'calendarSubscriptions',
      id,
      patch: { lastRefreshedAt: refreshedAt, lastError: null, parserVersion: CALENDAR_PARSER_VERSION },
    });
    useApp.getState().dispatch(patches, { local: true });
  } catch {
    useApp.getState().dispatch(
      [{ table: 'calendarSubscriptions', id, patch: { lastError: 'Could not reach the calendar provider.' } }],
      { local: true },
    );
  }
}

/** Refreshes every enabled calendar whose cache has gone stale. Called on app focus. */
export async function refreshStaleCalendars(): Promise<void> {
  const { db } = useApp.getState();
  for (const subscription of Object.values(db.calendarSubscriptions)) {
    if (subscription.enabled && subscription.parserVersion !== CALENDAR_PARSER_VERSION) {
      await refreshSubscription(subscription.id, true);
    } else if (subscription.enabled) {
      await refreshSubscription(subscription.id);
    }
  }
}
