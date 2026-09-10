import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { withTransaction } from './db';

/**
 * Server half of the sync protocol (R34).
 *
 * Operations are idempotent by `opId`, so replaying a queue after a reconnect never
 * duplicates an item, a completion or a recurring occurrence. Changes to different
 * fields merge; a same-field clash is resolved by server-assigned order and the
 * displaced value is retained for 30 days so it stays recoverable.
 */

const CONFLICT_RETENTION_DAYS = 30;
const MAX_OPS_PER_REQUEST = 500;
const MAX_CHANGES_PER_PULL = 1000;

const ALLOWED_TABLES = new Set([
  'areas', 'projects', 'headings', 'tasks', 'checklistItems', 'tags', 'tagAssignments',
  'repeatTemplates', 'occurrenceLinks', 'reminders', 'settings',
]);

export interface IncomingOp {
  opId: string;
  deviceId: string;
  table: string;
  entityId: string;
  baseRevision: number;
  patch: Record<string, unknown>;
  createdAt: string;
}

export interface OutgoingChange {
  table: string;
  id: string;
  patch: Record<string, unknown>;
  create?: boolean;
  remove?: boolean;
}

export interface ConflictOut {
  id: string;
  ownerId: string;
  table: string;
  entityId: string;
  field: string;
  displacedValue: unknown;
  winningValue: unknown;
  detectedAt: string;
  expiresAt: string;
}

export interface SyncResult {
  cursor: number;
  applied: string[];
  changes: OutgoingChange[];
  conflicts: ConflictOut[];
  serverTime: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rejects anything that is not a well-formed operation, before it reaches the database. */
export function validateOps(value: unknown): { ops: IncomingOp[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'ops must be a list.' };
  if (value.length > MAX_OPS_PER_REQUEST) return { error: `At most ${MAX_OPS_PER_REQUEST} operations per request.` };
  const ops: IncomingOp[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) return { error: 'An operation is not an object.' };
    const { opId, deviceId, table, entityId, patch, createdAt } = raw;
    if (typeof opId !== 'string' || opId.length === 0 || opId.length > 128) return { error: 'Invalid opId.' };
    if (typeof deviceId !== 'string' || deviceId.length > 128) return { error: 'Invalid deviceId.' };
    if (typeof table !== 'string' || !ALLOWED_TABLES.has(table)) return { error: `Unknown table: ${String(table)}` };
    if (typeof entityId !== 'string' || entityId.length === 0 || entityId.length > 128) return { error: 'Invalid entityId.' };
    if (!isPlainObject(patch)) return { error: 'Invalid patch.' };
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return { error: 'Invalid createdAt.' };
    ops.push({
      opId, deviceId, table, entityId, patch, createdAt,
      baseRevision: typeof raw.baseRevision === 'number' ? raw.baseRevision : 0,
    });
  }
  return { ops };
}

interface EntityRow {
  data: Record<string, unknown>;
  rev: number;
  removed: boolean;
  last_device: string | null;
  updated_at: Date;
}

export async function applySync(
  ownerId: string, deviceId: string, cursor: number, ops: IncomingOp[],
): Promise<SyncResult> {
  return withTransaction(async (client) => {
    const applied: string[] = [];
    const conflicts: ConflictOut[] = [];

    for (const op of ops) {
      // The op id is the idempotency key: a replayed queue lands here and stops.
      const claim = await client.query(
        'insert into applied_ops (op_id, owner_id) values ($1, $2) on conflict (op_id) do nothing returning op_id',
        [op.opId, ownerId],
      );
      if (claim.rowCount === 0) {
        applied.push(op.opId);
        continue;
      }

      const existing = await client.query<EntityRow>(
        `select data, rev, removed, last_device, updated_at
           from entities
          where owner_id = $1 and table_name = $2 and entity_id = $3
          for update`,
        [ownerId, op.table, op.entityId],
      );
      const row = existing.rows[0];

      // Undo of a creation: retract the record outright.
      if (op.patch.__removed === true) {
        await writeEntity(client, ownerId, op, row?.data ?? {}, (row?.rev ?? 0) + 1, true);
        applied.push(op.opId);
        continue;
      }

      if (!row) {
        await writeEntity(client, ownerId, op, { id: op.entityId, ...op.patch }, 1, false);
        applied.push(op.opId);
        continue;
      }

      const stored = row.data;
      const storedDeleted = stored.deletedAt !== null && stored.deletedAt !== undefined;
      const restores = Object.prototype.hasOwnProperty.call(op.patch, 'deletedAt');

      if ((storedDeleted || row.removed) && !restores) {
        // Deletion wins over a stale edit; the edit is kept as recoverable content
        // rather than resurrecting the item (R34, ordering and recovery).
        for (const [field, value] of Object.entries(op.patch)) {
          conflicts.push(await recordConflict(client, ownerId, op, field, value, stored[field]));
        }
        applied.push(op.opId);
        continue;
      }

      const merged: Record<string, unknown> = { ...stored };
      for (const [field, value] of Object.entries(op.patch)) {
        const current = stored[field];
        const changedElsewhere =
          row.last_device !== null &&
          row.last_device !== op.deviceId &&
          row.updated_at.getTime() > Date.parse(op.createdAt) &&
          JSON.stringify(current) !== JSON.stringify(value);
        if (changedElsewhere) {
          // Server order decides the winner; the displaced value stays recoverable.
          conflicts.push(await recordConflict(client, ownerId, op, field, value, current));
        }
        merged[field] = value;
      }
      merged.id = op.entityId;
      await writeEntity(client, ownerId, op, merged, row.rev + 1, false);
      applied.push(op.opId);
    }

    const changes = await client.query<{ table_name: string; entity_id: string; data: Record<string, unknown>; removed: boolean; seq: string }>(
      `select table_name, entity_id, data, removed, seq
         from entities
        where owner_id = $1 and seq > $2
        order by seq asc
        limit ${MAX_CHANGES_PER_PULL}`,
      [ownerId, cursor],
    );

    let nextCursor = cursor;
    const out: OutgoingChange[] = [];
    for (const change of changes.rows) {
      nextCursor = Math.max(nextCursor, Number(change.seq));
      if (change.removed) out.push({ table: change.table_name, id: change.entity_id, patch: {}, remove: true });
      else out.push({ table: change.table_name, id: change.entity_id, patch: change.data, create: true });
    }

    await client.query('delete from conflicts where expires_at < now()');
    await client.query("delete from applied_ops where applied_at < now() - interval '90 days'");

    return { cursor: nextCursor, applied, changes: out, conflicts, serverTime: new Date().toISOString() };
  });
}

async function writeEntity(
  client: PoolClient, ownerId: string, op: IncomingOp,
  data: Record<string, unknown>, rev: number, removed: boolean,
): Promise<void> {
  await client.query(
    `insert into entities (owner_id, table_name, entity_id, data, rev, seq, removed, last_device, updated_at)
     values ($1, $2, $3, $4::jsonb, $5, nextval('entity_seq'), $6, $7, now())
     on conflict (owner_id, table_name, entity_id) do update
       set data = excluded.data,
           rev = excluded.rev,
           seq = nextval('entity_seq'),
           removed = excluded.removed,
           last_device = excluded.last_device,
           updated_at = now()`,
    [ownerId, op.table, op.entityId, JSON.stringify(data), rev, removed, op.deviceId],
  );
}

async function recordConflict(
  client: PoolClient, ownerId: string, op: IncomingOp,
  field: string, winningValue: unknown, displacedValue: unknown,
): Promise<ConflictOut> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + CONFLICT_RETENTION_DAYS * 86_400_000).toISOString();
  await client.query(
    `insert into conflicts (id, owner_id, table_name, entity_id, field, displaced_value, winning_value, expires_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [id, ownerId, op.table, op.entityId, field, JSON.stringify(displacedValue ?? null), JSON.stringify(winningValue ?? null), expiresAt],
  );
  return {
    id, ownerId, table: op.table, entityId: op.entityId, field,
    displacedValue, winningValue,
    detectedAt: new Date().toISOString(), expiresAt,
  };
}
