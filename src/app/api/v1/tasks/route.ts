import {
  apiError, buildTask, readEntities, rememberIdempotent, replayIdempotent,
  tokenSession, validateTaskInput, writeEntities,
} from '@/server/automation';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Automation API (R30). Stable ids, structured validation errors, pagination for
 * searches, and an idempotency key that returns the original id on a repeat.
 */

interface StoredTask {
  id: string; title: string; notes: string; status: string; parentType: string;
  parentId: string | null; headingId: string | null; planning: string;
  startDate: string | null; deadline: string | null; deletedAt: string | null;
  createdAt: string; updatedAt: string;
}

export async function GET(request: Request) {
  if (!syncConfigured()) return apiError('This deployment has no account backend.', 501);
  const session = await tokenSession(request);
  if (!session) return apiError('A valid bearer token is required.', 401);

  const url = new URL(request.url);
  const search = (url.searchParams.get('query') ?? '').trim().toLowerCase();
  const status = url.searchParams.get('status') ?? 'open';
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
  const cursor = url.searchParams.get('cursor');

  const tasks = (await readEntities<StoredTask>(session.ownerId, 'tasks'))
    .filter((task) => task.deletedAt === null)
    .filter((task) => (status === 'all' ? true : task.status === status))
    .filter((task) => (search ? `${task.title} ${task.notes}`.toLowerCase().includes(search) : true))
    .sort((a, b) => a.id.localeCompare(b.id));

  const start = cursor ? tasks.findIndex((task) => task.id === cursor) + 1 : 0;
  const page = tasks.slice(start, start + limit);
  const next = start + limit < tasks.length ? page[page.length - 1]?.id ?? null : null;

  return Response.json({
    data: page.map(shape),
    pagination: { limit, nextCursor: next, total: tasks.length },
  });
}

export async function POST(request: Request) {
  if (!syncConfigured()) return apiError('This deployment has no account backend.', 501);
  const session = await tokenSession(request);
  if (!session) return apiError('A valid bearer token is required.', 401);

  const idempotencyKey = request.headers.get('idempotency-key');
  const replay = await replayIdempotent(session.ownerId, idempotencyKey);
  // A repeated request with the same key returns the original id (R30).
  if (replay) return Response.json(replay);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('Expected a JSON body.', 400);
  }

  const validated = validateTaskInput(body);
  if ('error' in validated) return apiError(validated.error, 422);

  const { input } = validated;
  if (input.projectId) {
    const projects = await readEntities<{ id: string; deletedAt: string | null }>(session.ownerId, 'projects');
    // An invalid parent is an actionable error, and nothing partial is written.
    if (!projects.some((p) => p.id === input.projectId && p.deletedAt === null)) {
      return apiError('The project id does not exist in this account.', 422, { field: 'projectId' });
    }
  }

  const now = new Date().toISOString();
  const { writes, id } = buildTask(session.ownerId, input, now);
  await writeEntities(session.ownerId, writes);

  const response = { data: { id, title: input.title, createdAt: now } };
  await rememberIdempotent(session.ownerId, idempotencyKey, response);
  return Response.json(response, { status: 201 });
}

function shape(task: StoredTask) {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
    projectId: task.parentType === 'project' ? task.parentId : null,
    areaId: task.parentType === 'area' ? task.parentId : null,
    headingId: task.headingId,
    startDate: task.startDate,
    deadline: task.deadline,
    someday: task.planning === 'someday',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
