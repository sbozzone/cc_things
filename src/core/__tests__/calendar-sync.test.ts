import { describe, expect, it } from 'vitest';
import { calendarConfig, calendarMigrationPatches, incomingCalendarPatches, syncableCalendarPatch } from '../calendar-sync';
import { emptyDatabase } from '../db';
import { applyPatches } from '../patches';
import { exportDatabase, exportText } from '../portability';
import type { CalendarEvent, CalendarSubscription } from '../types';

const now = '2026-10-06T12:00:00Z';
const subscription: CalendarSubscription = {
  id: 'cal', ownerId: 'owner', providerId: 'ics', calendarId: 'cal', title: 'Work',
  url: 'https://example.com/private-calendar.ics', enabled: true, lastRefreshedAt: now,
  lastError: null, parserVersion: 2,
};
const event: CalendarEvent = {
  id: 'event', ownerId: 'owner', providerId: 'ics', calendarId: 'cal', eventId: 'meeting',
  instanceId: 'meeting:friday', title: 'Meeting', allDay: true, startDate: '2026-10-09',
  endDate: '2026-10-09', startInstant: null, endInstant: null, timeZone: null,
  sourceUrl: null, revision: null, canceled: false, lastRefreshedAt: now,
};

function connectedDatabase() {
  const db = emptyDatabase('owner', now);
  db.calendarSubscriptions.cal = { ...subscription };
  db.calendarEvents.event = { ...event };
  return db;
}

describe('private calendar configuration sync', () => {
  it('migrates existing connections once without uploading local metadata or another owner', () => {
    const db = connectedDatabase();
    db.calendarSubscriptions.other = { ...subscription, id: 'other', ownerId: 'another-owner' };
    const migration = calendarMigrationPatches(db, 'owner');
    expect(migration).toHaveLength(1);
    expect(syncableCalendarPatch(migration[0]!)).toMatchObject({ patch: calendarConfig(subscription) });
    expect(Object.keys(syncableCalendarPatch(migration[0]!)!.patch).sort())
      .toEqual(['id', 'ownerId', 'providerId', 'calendarId', 'title', 'url', 'enabled'].sort());
    expect(calendarMigrationPatches(applyPatches(db, migration), 'owner')).toEqual([]);
    expect(syncableCalendarPatch({ table: 'calendarEvents', id: 'event', patch: { title: 'Meeting' } })).toBeNull();
    expect(syncableCalendarPatch({ table: 'calendarSubscriptions', id: 'cal', patch: { lastRefreshedAt: now, lastError: null } })).toBeNull();
  });

  it('restores a connection on a new device with a fresh local cache instead of inheriting PC freshness', () => {
    const incoming = incomingCalendarPatches(emptyDatabase('owner', now), [
      { table: 'calendarSubscriptions', id: 'cal', patch: calendarConfig(subscription), create: true },
    ], 'owner');
    const db = applyPatches(emptyDatabase('owner', now), incoming.patches);
    expect(db.calendarSubscriptions.cal).toMatchObject({ configSynced: true, lastRefreshedAt: null, lastError: null });
    expect(incoming.refreshCalendars).toBe(true);
    expect(calendarMigrationPatches(db, 'owner')).toEqual([]);
  });

  it('adopts a disabled account connection instead of uploading a stale duplicate legacy feed', () => {
    const db = connectedDatabase();
    db.calendarSubscriptions.remote = { ...subscription, id: 'remote', calendarId: 'remote', enabled: false, configSynced: true };
    const migrations = calendarMigrationPatches(db, 'owner');
    expect(migrations.some((patch) => patch.create)).toBe(false);
    const next = applyPatches(db, migrations);
    expect(Object.keys(next.calendarSubscriptions)).toEqual(['remote']);
    expect(next.calendarSubscriptions.remote?.enabled).toBe(false);
    expect(next.calendarEvents).toEqual({});
    expect(calendarMigrationPatches(next, 'owner')).toEqual([]);
  });

  it('chooses one stable identity when this device has duplicate pre-upgrade connections', () => {
    const db = connectedDatabase();
    db.calendarSubscriptions.second = { ...subscription, id: 'second', calendarId: 'second' };
    const migrations = calendarMigrationPatches(db, 'owner');
    expect(migrations.filter((patch) => patch.create)).toHaveLength(1);
    const next = applyPatches(db, migrations);
    expect(Object.keys(next.calendarSubscriptions)).toEqual(['cal']);
    expect(calendarMigrationPatches(next, 'owner')).toEqual([]);
  });

  it('honors an account removal even when the old device connected that feed under a different id', () => {
    const db = connectedDatabase();
    const incoming = incomingCalendarPatches(db, [{
      table: 'calendarSubscriptions', id: 'remote',
      patch: { ...calendarConfig(subscription), id: 'remote', calendarId: 'remote' }, remove: true,
    }], 'owner');
    const next = applyPatches(db, incoming.patches);
    expect(next.calendarSubscriptions).toEqual({});
    expect(next.calendarEvents).toEqual({});
    expect(calendarMigrationPatches(next, 'owner')).toEqual([]);
    expect(incoming.patches.find((patch) => patch.id === 'remote')?.patch).toEqual({});
  });

  it('preserves local events and freshness when an unchanged account connection is pulled', () => {
    const db = connectedDatabase();
    const incoming = incomingCalendarPatches(db, [
      { table: 'calendarSubscriptions', id: 'cal', patch: calendarConfig(subscription), create: true },
    ], 'owner');
    const next = applyPatches(db, incoming.patches);
    expect(next.calendarSubscriptions.cal?.lastRefreshedAt).toBe(now);
    expect(next.calendarEvents.event).toEqual(event);
    expect(incoming.refreshCalendars).toBe(false);
  });

  it.each(['disable', 'remove', 'change feed'])('clears the local cache after a remote %s', (action) => {
    const db = connectedDatabase();
    const incoming = incomingCalendarPatches(db, [{
      table: 'calendarSubscriptions', id: 'cal',
      patch: action === 'disable' ? { enabled: false } : action === 'change feed' ? { url: 'https://example.com/new.ics' } : {},
      remove: action === 'remove',
    }], 'owner');
    const next = applyPatches(db, incoming.patches);
    expect(next.calendarEvents).toEqual({});
    expect(incoming.refreshCalendars).toBe(action === 'change feed');
    if (action === 'remove') expect(next.calendarSubscriptions.cal).toBeUndefined();
  });

  it('keeps feed secrets and downloaded calendar events out of JSON and text exports', () => {
    const db = connectedDatabase();
    expect(JSON.stringify(exportDatabase(db))).not.toContain(subscription.url);
    expect(exportText(db)).not.toContain(subscription.url);
    expect(exportDatabase(db).records).not.toHaveProperty('calendarSubscriptions');
    expect(exportDatabase(db).records).not.toHaveProperty('calendarEvents');
  });
});
