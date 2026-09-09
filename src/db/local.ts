import { emptyDatabase } from '@/core/db';
import { isEntityTable, type EntityPatch } from '@/core/patches';
import { SCHEMA_VERSION, type Database, type EntityTable, type Settings, type SyncOperation } from '@/core/types';
import {
  clearAll, commit, getAllWithKeys, getMeta, idbAvailable, setMeta,
  STORE_OPS, STORE_RECORDS, getAll,
} from './idb';

/**
 * The durable local store (R33). After initial setup every core action works over
 * downloaded data, and pending writes survive a reload.
 */

export const META_OWNER = 'ownerId';
export const META_DEVICE = 'deviceId';
export const META_CURSOR = 'serverCursor';
export const META_SETTINGS = 'settings';

export interface LoadedState {
  db: Database;
  pending: SyncOperation[];
  cursor: number;
  deviceId: string | null;
  ownerId: string | null;
}

export async function loadLocal(fallbackOwnerId: string, timeZone: string): Promise<LoadedState> {
  const now = new Date().toISOString();
  if (!idbAvailable()) {
    return { db: emptyDatabase(fallbackOwnerId, now, timeZone), pending: [], cursor: 0, deviceId: null, ownerId: null };
  }
  const [entries, ops, cursor, deviceId, ownerId, settings] = await Promise.all([
    getAllWithKeys<Record<string, unknown>>(STORE_RECORDS),
    getAll<SyncOperation>(STORE_OPS),
    getMeta<number>(META_CURSOR),
    getMeta<string>(META_DEVICE),
    getMeta<string>(META_OWNER),
    getMeta<Settings>(META_SETTINGS),
  ]);

  const db = emptyDatabase(ownerId ?? fallbackOwnerId, now, timeZone);
  if (settings) db.settings = { ...db.settings, ...settings };
  for (const { key, value } of entries) {
    const separator = key.indexOf(':');
    const table = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (!isEntityTable(table)) continue;
    (db[table as EntityTable] as Record<string, unknown>)[id] = value;
  }
  db.schemaVersion = SCHEMA_VERSION;
  return {
    db,
    pending: ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    cursor: cursor ?? 0,
    deviceId: deviceId ?? null,
    ownerId: ownerId ?? null,
  };
}

/** Persists a set of patches together with the sync operations they produced. */
export async function persistPatches(
  db: Database, patches: EntityPatch[], ops: SyncOperation[], meta?: Record<string, unknown>,
): Promise<void> {
  if (!idbAvailable()) return;
  const records = new Map<string, unknown | null>();
  const extraMeta: Record<string, unknown> = { ...meta };
  for (const patch of patches) {
    if (patch.table === 'settings') {
      extraMeta[META_SETTINGS] = db.settings;
      continue;
    }
    if (!isEntityTable(patch.table)) continue;
    const record = (db[patch.table] as Record<string, unknown>)[patch.id];
    records.set(`${patch.table}:${patch.id}`, record ?? null);
  }
  await commit({ records, ops, meta: extraMeta });
}

export async function removeRecords(keys: string[]): Promise<void> {
  if (!idbAvailable() || keys.length === 0) return;
  const records = new Map<string, unknown | null>();
  for (const key of keys) records.set(key, null);
  await commit({ records, ops: [] });
}

export async function acknowledgeOps(opIds: string[], cursor: number): Promise<void> {
  if (!idbAvailable()) return;
  await commit({ records: new Map(), ops: [], ackOpIds: opIds, meta: { [META_CURSOR]: cursor } });
}

/** Applies a batch of server records without re-queueing them for upload. */
export async function persistIncoming(db: Database, patches: EntityPatch[], cursor: number): Promise<void> {
  if (!idbAvailable()) return;
  const records = new Map<string, unknown | null>();
  const meta: Record<string, unknown> = { [META_CURSOR]: cursor };
  for (const patch of patches) {
    if (patch.table === 'settings') {
      meta[META_SETTINGS] = db.settings;
      continue;
    }
    if (!isEntityTable(patch.table)) continue;
    records.set(`${patch.table}:${patch.id}`, (db[patch.table] as Record<string, unknown>)[patch.id] ?? null);
  }
  await commit({ records, ops: [], meta });
}

export async function setLocalIdentity(ownerId: string, deviceId: string): Promise<void> {
  await setMeta(META_OWNER, ownerId);
  await setMeta(META_DEVICE, deviceId);
}

export async function resetLocal(): Promise<void> {
  if (!idbAvailable()) return;
  await clearAll();
}
