import { applyPatches, type EntityPatch } from './patches';
import type { CalendarSubscription, Database } from './types';

/** Only account-owned connection settings travel through sync. Feed caches stay local. */
export const CALENDAR_CONFIG_FIELDS = ['id', 'ownerId', 'providerId', 'calendarId', 'title', 'url', 'enabled'] as const;

export function calendarConfig(subscription: CalendarSubscription): Record<string, unknown> {
  return Object.fromEntries(CALENDAR_CONFIG_FIELDS.map((field) => [field, subscription[field]]));
}

export function calendarFeedKey(subscription: Pick<CalendarSubscription, 'providerId' | 'url'>): string {
  const raw = subscription.url.trim().replace(/^webcal:/i, 'https:');
  let url = raw;
  try { url = new URL(raw).href; } catch { /* Invalid feeds remain separate until corrected. */ }
  return `${subscription.providerId}:${url}`;
}

/** Strip cache metadata and downloaded events before constructing upload operations. */
export function syncableCalendarPatch(patch: EntityPatch): EntityPatch | null {
  if (patch.table === 'calendarEvents') return null;
  if (patch.table !== 'calendarSubscriptions' || patch.remove) return patch;
  const config = Object.fromEntries(Object.entries(patch.patch).filter(([field]) =>
    (CALENDAR_CONFIG_FIELDS as readonly string[]).includes(field)));
  return Object.keys(config).length > 0 ? { ...patch, patch: config } : null;
}

/** The marker commits atomically with the pending operation, so a reload cannot queue it twice. */
export function calendarMigrationPatches(db: Database, ownerId: string): EntityPatch[] {
  const patches: EntityPatch[] = [];
  const connections = Object.values(db.calendarSubscriptions).filter((subscription) => subscription.ownerId === ownerId)
    .sort((a, b) => Number(Boolean(b.configSynced)) - Number(Boolean(a.configSynced)) || a.id.localeCompare(b.id));
  const adopted = new Set<string>();
  for (const subscription of connections) {
    const key = calendarFeedKey(subscription);
    if (subscription.configSynced) {
      adopted.add(key);
      continue;
    }
    if (adopted.has(key)) {
      // A pulled account connection wins over a stale pre-upgrade device copy,
      // including its disabled setting. Remove only the redundant local identity.
      patches.push({ table: 'calendarSubscriptions', id: subscription.id, patch: {}, remove: true });
      for (const event of Object.values(db.calendarEvents)) {
        if (event.calendarId === subscription.calendarId) patches.push({ table: 'calendarEvents', id: event.id, patch: {}, remove: true });
      }
      continue;
    }
    adopted.add(key);
    patches.push({
      table: 'calendarSubscriptions', id: subscription.id,
      patch: { ...calendarConfig(subscription), configSynced: true }, create: true,
    });
  }
  return patches;
}

/** Restore account connections while preserving this device's independent cache and freshness. */
export function incomingCalendarPatches(db: Database, incoming: EntityPatch[], ownerId: string): {
  patches: EntityPatch[]; refreshCalendars: boolean;
} {
  const patches: EntityPatch[] = [];
  let current = db;
  let refreshCalendars = false;
  for (const change of incoming) {
    if (change.table === 'calendarEvents') continue;
    if (change.table !== 'calendarSubscriptions') {
      patches.push(change);
      continue;
    }
    const existing = current.calendarSubscriptions[change.id];
    const config = syncableCalendarPatch(change);
    if (!config) continue;
    const next = { ...existing, ...config.patch, id: change.id, ownerId } as CalendarSubscription;
    const changed = !existing || existing.url !== next.url || existing.providerId !== next.providerId ||
      existing.calendarId !== next.calendarId || existing.enabled !== next.enabled;
    const normalized: EntityPatch = change.remove ? { ...change, patch: {} } : {
      ...config, create: true,
      patch: {
        ...config.patch, id: change.id, ownerId, configSynced: true,
        ...(!existing || changed ? { lastRefreshedAt: null, lastError: null, parserVersion: 0 } : {}),
      },
    };
    const clearsCache = change.remove || !next.enabled || changed;
    const batch: EntityPatch[] = [normalized];
    if (change.remove && typeof next.url === 'string' && typeof next.providerId === 'string') {
      // Removal can arrive under the account identity while a pre-upgrade device
      // still has that feed under its own local id. Do not migrate it back in.
      for (const legacy of Object.values(current.calendarSubscriptions)) {
        if (legacy.id === change.id || legacy.configSynced || legacy.ownerId !== ownerId) continue;
        if (calendarFeedKey(legacy) !== calendarFeedKey(next)) continue;
        batch.push({ table: 'calendarSubscriptions', id: legacy.id, patch: {}, remove: true });
        for (const event of Object.values(current.calendarEvents)) {
          if (event.calendarId === legacy.calendarId) batch.push({ table: 'calendarEvents', id: event.id, patch: {}, remove: true });
        }
      }
    }
    if (clearsCache) {
      for (const event of Object.values(current.calendarEvents)) {
        if (event.calendarId === existing?.calendarId || event.calendarId === next.calendarId) {
          batch.push({ table: 'calendarEvents', id: event.id, patch: {}, remove: true });
        }
      }
    }
    if (!change.remove && next.enabled && changed) refreshCalendars = true;
    patches.push(...batch);
    current = applyPatches(current, batch);
  }
  return { patches, refreshCalendars };
}
