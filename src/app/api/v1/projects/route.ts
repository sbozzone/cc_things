import {
  apiError, buildTask, newEntityId, readEntities, rememberIdempotent, replayIdempotent,
  tokenSession, writeEntities, type EntityWrite,
} from '@/server/automation';
import { syncConfigured } from '@/server/env';
import { FIRST_RANK, keyBetween } from '@/core/rank';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Structured project creation with headings and tasks in one call (R30). */
export async function POST(request: Request) {
  if (!syncConfigured()) return apiError('This deployment has no account backend.', 501);
  const session = await tokenSession(request);
  if (!session) return apiError('A valid bearer token is required.', 401);

  const idempotencyKey = request.headers.get('idempotency-key');
  const replay = await replayIdempotent(session.ownerId, idempotencyKey);
  if (replay) return Response.json(replay);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError('Expected a JSON body.', 400);
  }

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return apiError('A project title is required.', 422, { field: 'title' });
  }
  const areaId = typeof body.areaId === 'string' ? body.areaId : null;
  if (areaId) {
    const areas = await readEntities<{ id: string; deletedAt: string | null }>(session.ownerId, 'areas');
    // Validate before writing anything, so a bad parent never leaves a partial project.
    if (!areas.some((a) => a.id === areaId && a.deletedAt === null)) {
      return apiError('The area id does not exist in this account.', 422, { field: 'areaId' });
    }
  }

  const now = new Date().toISOString();
  const projectId = newEntityId();
  const writes: EntityWrite[] = [{
    table: 'projects',
    id: projectId,
    data: {
      id: projectId, ownerId: session.ownerId, areaId, title: body.title.trim().slice(0, 1000),
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 50_000) : '',
      status: 'open', planning: typeof body.startDate === 'string' ? 'scheduled' : 'anytime',
      startDate: typeof body.startDate === 'string' ? body.startDate : null,
      eveningDate: null, deadline: typeof body.deadline === 'string' ? body.deadline : null,
      rank: FIRST_RANK, completedAt: null, canceledAt: null,
      createdAt: now, updatedAt: now, deletedAt: null,
    },
  }];

  const addTasks = (list: unknown, headingId: string | null) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const title = typeof entry === 'string' ? entry : (entry as { title?: unknown })?.title;
      if (typeof title !== 'string' || !title.trim()) continue;
      const built = buildTask(session.ownerId, { title, projectId, headingId }, now);
      writes.push(...built.writes);
    }
  };

  addTasks(body.tasks, null);

  let headingCursor: string | null = null;
  if (Array.isArray(body.headings)) {
    for (const raw of body.headings) {
      const heading = raw as { title?: unknown; tasks?: unknown };
      if (typeof heading.title !== 'string' || !heading.title.trim()) continue;
      const headingRank: string = headingCursor === null ? FIRST_RANK : keyBetween(headingCursor, null);
      headingCursor = headingRank;
      const headingId = newEntityId();
      writes.push({
        table: 'headings',
        id: headingId,
        data: {
          id: headingId, ownerId: session.ownerId, projectId, title: heading.title.trim().slice(0, 1000),
          rank: headingRank, archivedAt: null, createdAt: now, updatedAt: now, deletedAt: null,
        },
      });
      addTasks(heading.tasks, headingId);
    }
  }

  await writeEntities(session.ownerId, writes);
  const response = { data: { id: projectId, title: body.title, createdAt: now, records: writes.length } };
  await rememberIdempotent(session.ownerId, idempotencyKey, response);
  return Response.json(response, { status: 201 });
}
