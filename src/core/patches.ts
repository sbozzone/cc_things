import type { Database, EntityTable, Instant } from './types';

/**
 * Every change — a local edit, an import, or a delta arriving from the server — is
 * expressed as the same patch shape. That symmetry is what lets a replayed queue
 * converge instead of duplicating work (R33, R34).
 */
export interface EntityPatch {
  table: EntityTable | 'settings';
  id: string;
  /** Field-level changes. On a create this is the complete record. */
  patch: Record<string, unknown>;
  create?: boolean;
}

export interface WriteContext {
  ownerId: string;
  now: Instant;
  today: string;
  timeZone: string;
}

const TABLES: EntityTable[] = [
  'areas', 'projects', 'headings', 'tasks', 'checklistItems', 'tags', 'tagAssignments',
  'repeatTemplates', 'occurrenceLinks', 'reminders', 'calendarSubscriptions', 'calendarEvents',
];

export function isEntityTable(name: string): name is EntityTable {
  return (TABLES as string[]).includes(name);
}

/**
 * Applies patches to a database value, copying only the tables that change so React
 * can compare by reference.
 */
export function applyPatches(db: Database, patches: EntityPatch[]): Database {
  if (patches.length === 0) return db;
  const next: Database = { ...db };
  const touched = new Set<string>();

  for (const p of patches) {
    if (p.table === 'settings') {
      next.settings = { ...next.settings, ...(p.patch as Partial<typeof next.settings>) };
      continue;
    }
    if (!isEntityTable(p.table)) continue;
    if (!touched.has(p.table)) {
      (next as unknown as Record<string, unknown>)[p.table] = {
        ...(next as unknown as Record<string, Record<string, unknown>>)[p.table],
      };
      touched.add(p.table);
    }
    const table = (next as unknown as Record<string, Record<string, unknown>>)[p.table] as Record<string, unknown>;
    const existing = table[p.id] as Record<string, unknown> | undefined;
    if (!existing && !p.create) {
      // A patch for a record we have never seen still materializes it, so an
      // out-of-order sync delta does not silently vanish.
      table[p.id] = { id: p.id, ...p.patch };
      continue;
    }
    table[p.id] = { ...(existing ?? {}), ...p.patch, id: p.id };
  }
  return next;
}

/** Convenience for building an update patch that always stamps `updatedAt`. */
export function update(
  table: EntityTable | 'settings',
  id: string,
  patch: Record<string, unknown>,
  ctx: WriteContext,
): EntityPatch {
  return { table, id, patch: { ...patch, updatedAt: ctx.now } };
}

export function create(table: EntityTable | 'settings', id: string, record: Record<string, unknown>): EntityPatch {
  return { table, id, patch: record, create: true };
}
