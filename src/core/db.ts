import { SCHEMA_VERSION, type Database, type Settings } from './types';

export function defaultSettings(ownerId: string, now: string, timeZone: string, locale = 'en-US'): Settings {
  return {
    id: 'settings',
    ownerId,
    locale,
    planningTimeZone: timeZone,
    theme: 'system',
    todayGrouping: 'flat',
    notificationsEnabled: false,
    typeToSearch: true,
    reducedMotion: false,
    sidebarCollapsed: false,
    listSorts: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function emptyDatabase(ownerId: string, now = new Date().toISOString(), timeZone = 'UTC'): Database {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(ownerId, now, timeZone),
    areas: {},
    projects: {},
    headings: {},
    tasks: {},
    checklistItems: {},
    tags: {},
    tagAssignments: {},
    repeatTemplates: {},
    occurrenceLinks: {},
    reminders: {},
    calendarSubscriptions: {},
    calendarEvents: {},
  };
}

/** Drops purged rows entirely; used after Trash retention expires (R06). */
export function purgeIds(db: Database, ids: string[]): Database {
  if (ids.length === 0) return db;
  const gone = new Set(ids);
  const next: Database = { ...db };
  for (const table of ['tasks', 'projects', 'headings', 'checklistItems'] as const) {
    const copy: Record<string, never> = {};
    let changed = false;
    for (const [id, value] of Object.entries(next[table])) {
      if (gone.has(id)) {
        changed = true;
        continue;
      }
      (copy as Record<string, unknown>)[id] = value;
    }
    if (changed) (next as unknown as Record<string, unknown>)[table] = copy;
  }
  return next;
}
