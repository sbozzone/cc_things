import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from './db';
import { FIRST_RANK, keyBetween } from '@/core/rank';
import { capitalizeNewTitle } from '@/core/text';

/**
 * Shared machinery for the automation API (R30).
 *
 * Writes require an authenticated, scoped, revocable token; every request is validated;
 * and an idempotency key returns the original result rather than creating a second copy.
 */

export interface TokenSession {
  ownerId: string;
  tokenId: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Resolves a bearer token to an owner. Returns null for anything unrecognised or revoked. */
export async function tokenSession(request: Request): Promise<TokenSession | null> {
  const header = request.headers.get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  if (token.length < 20 || token.length > 200) return null;

  const rows = await query<{ id: string; owner_id: string }>(
    `select t.id, t.owner_id
       from automation_tokens t
       join accounts a on a.id = t.owner_id
      where t.token_hash = $1 and t.revoked_at is null and a.deleted_at is null`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  await query('update automation_tokens set last_used = now() where id = $1', [row.id]);
  return { ownerId: row.owner_id, tokenId: row.id };
}

/** Returns a stored response for a repeated idempotency key, so a retry is a no-op. */
export async function replayIdempotent(ownerId: string, key: string | null): Promise<unknown | null> {
  if (!key) return null;
  const rows = await query<{ response: unknown }>(
    'select response from idempotency_keys where owner_id = $1 and key = $2',
    [ownerId, key],
  );
  return rows[0]?.response ?? null;
}

export async function rememberIdempotent(ownerId: string, key: string | null, response: unknown): Promise<void> {
  if (!key) return;
  await query(
    `insert into idempotency_keys (key, owner_id, response) values ($1, $2, $3::jsonb)
     on conflict (owner_id, key) do nothing`,
    [key, ownerId, JSON.stringify(response)],
  );
}

export interface EntityWrite {
  table: string;
  id: string;
  data: Record<string, unknown>;
}

/** Writes records through the same entity table the sync engine uses, so clients pull them. */
export async function writeEntities(ownerId: string, writes: EntityWrite[], deviceId = 'automation'): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    for (const write of writes) {
      await client.query(
        `insert into entities (owner_id, table_name, entity_id, data, rev, seq, removed, last_device, updated_at)
         values ($1, $2, $3, $4::jsonb, 1, nextval('entity_seq'), false, $5, now())
         on conflict (owner_id, table_name, entity_id) do update
           set data = entities.data || excluded.data,
               rev = entities.rev + 1,
               seq = nextval('entity_seq'),
               last_device = excluded.last_device,
               updated_at = now()`,
        [ownerId, write.table, write.id, JSON.stringify(write.data), deviceId],
      );
    }
  });
}

export async function readEntities<T>(ownerId: string, table: string): Promise<T[]> {
  const rows = await query<{ data: T }>(
    'select data from entities where owner_id = $1 and table_name = $2 and removed = false',
    [ownerId, table],
  );
  return rows.map((row) => row.data);
}

export function newEntityId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 22);
}

export interface TaskInput {
  title: string;
  notes?: string;
  projectId?: string | null;
  areaId?: string | null;
  headingId?: string | null;
  startDate?: string | null;
  deadline?: string | null;
  someday?: boolean;
  tagIds?: string[];
  checklist?: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTaskInput(value: unknown): { input: TaskInput } | { error: string } {
  if (typeof value !== 'object' || value === null) return { error: 'Expected an object.' };
  const body = value as Record<string, unknown>;
  if (typeof body.title !== 'string' || body.title.trim().length === 0) return { error: 'A title is required.' };
  if (body.title.length > 1000) return { error: 'The title is too long.' };
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 50_000)) {
    return { error: 'Notes must be a string of at most 50000 characters.' };
  }
  for (const field of ['startDate', 'deadline']) {
    const date = body[field];
    if (date !== undefined && date !== null && (typeof date !== 'string' || !DATE_RE.test(date))) {
      return { error: `${field} must be a YYYY-MM-DD date.` };
    }
  }
  if (body.checklist !== undefined && (!Array.isArray(body.checklist) || body.checklist.some((row) => typeof row !== 'string'))) {
    return { error: 'checklist must be a list of strings.' };
  }
  return {
    input: {
      title: capitalizeNewTitle(body.title),
      notes: typeof body.notes === 'string' ? body.notes : '',
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      areaId: typeof body.areaId === 'string' ? body.areaId : null,
      headingId: typeof body.headingId === 'string' ? body.headingId : null,
      startDate: typeof body.startDate === 'string' ? body.startDate : null,
      deadline: typeof body.deadline === 'string' ? body.deadline : null,
      someday: body.someday === true,
      tagIds: Array.isArray(body.tagIds) ? (body.tagIds as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      checklist: Array.isArray(body.checklist) ? (body.checklist as string[]) : [],
    },
  };
}

/** Builds the records for one task, including its checklist rows and tag assignments. */
export function buildTask(ownerId: string, input: TaskInput, now: string): { writes: EntityWrite[]; id: string } {
  const id = newEntityId();
  const parentType = input.projectId ? 'project' : input.areaId ? 'area' : 'inbox';
  const parentId = input.projectId ?? input.areaId ?? null;
  const planning = input.someday ? 'someday' : input.startDate ? 'scheduled' : 'anytime';

  const writes: EntityWrite[] = [{
    table: 'tasks',
    id,
    data: {
      id, ownerId, title: input.title, notes: input.notes ?? '', status: 'open',
      processed: parentType !== 'inbox' || planning !== 'anytime',
      parentType, parentId, headingId: input.headingId ?? null,
      planning, startDate: input.startDate ?? null, eveningDate: null, deadline: input.deadline ?? null,
      rank: FIRST_RANK, todayRank: FIRST_RANK,
      completedAt: null, canceledAt: null, createdAt: now, updatedAt: now, deletedAt: null,
    },
  }];

  let cursor: string | null = null;
  for (const text of input.checklist ?? []) {
    if (!text.trim()) continue;
    const rank: string = cursor === null ? FIRST_RANK : keyBetween(cursor, null);
    cursor = rank;
    const rowId = newEntityId();
    writes.push({
      table: 'checklistItems',
      id: rowId,
      data: { id: rowId, ownerId, taskId: id, text: text.trim(), checked: false, rank, createdAt: now, updatedAt: now, deletedAt: null },
    });
  }
  for (const tagId of input.tagIds ?? []) {
    const assignmentId = newEntityId();
    writes.push({
      table: 'tagAssignments',
      id: assignmentId,
      data: { id: assignmentId, ownerId, tagId, targetType: 'task', targetId: id, createdAt: now, updatedAt: now, deletedAt: null },
    });
  }
  return { writes, id };
}

export function apiError(message: string, status: number, details?: unknown) {
  return Response.json({ error: { message, details: details ?? null } }, { status });
}
