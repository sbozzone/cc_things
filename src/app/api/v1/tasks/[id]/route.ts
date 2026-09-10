import { apiError, readEntities, tokenSession, writeEntities } from '@/server/automation';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface StoredTask {
  id: string; title: string; notes: string; status: string; deletedAt: string | null;
  parentType: string; parentId: string | null; headingId: string | null;
  planning: string; startDate: string | null; deadline: string | null;
}

/** Retrieve one task (R30, property retrieval). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!syncConfigured()) return apiError('This deployment has no account backend.', 501);
  const session = await tokenSession(request);
  if (!session) return apiError('A valid bearer token is required.', 401);

  const { id } = await context.params;
  const task = (await readEntities<StoredTask>(session.ownerId, 'tasks')).find((t) => t.id === id && t.deletedAt === null);
  if (!task) return apiError('No task with that id in this account.', 404);
  return Response.json({ data: task });
}

/** Update, complete, cancel or move a task. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!syncConfigured()) return apiError('This deployment has no account backend.', 501);
  const session = await tokenSession(request);
  if (!session) return apiError('A valid bearer token is required.', 401);

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError('Expected a JSON body.', 400);
  }

  const tasks = await readEntities<StoredTask>(session.ownerId, 'tasks');
  const task = tasks.find((t) => t.id === id && t.deletedAt === null);
  if (!task) return apiError('No task with that id in this account.', 404);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };

  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 1000);
  if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 50_000);
  if (typeof body.status === 'string') {
    if (!['open', 'completed', 'canceled'].includes(body.status)) {
      return apiError('status must be open, completed or canceled.', 422, { field: 'status' });
    }
    patch.status = body.status;
    patch.completedAt = body.status === 'completed' ? now : null;
    patch.canceledAt = body.status === 'canceled' ? now : null;
  }
  for (const field of ['startDate', 'deadline'] as const) {
    if (body[field] === undefined) continue;
    const value = body[field];
    if (value !== null && (typeof value !== 'string' || !DATE_RE.test(value))) {
      return apiError(`${field} must be a YYYY-MM-DD date or null.`, 422, { field });
    }
    patch[field] = value;
    if (field === 'startDate') {
      patch.planning = value === null ? 'anytime' : 'scheduled';
      if (value === null) patch.eveningDate = null;
    }
  }
  if (body.projectId !== undefined) {
    if (body.projectId === null) {
      patch.parentType = 'inbox';
      patch.parentId = null;
      patch.headingId = null;
    } else {
      const projects = await readEntities<{ id: string; deletedAt: string | null }>(session.ownerId, 'projects');
      if (!projects.some((p) => p.id === body.projectId && p.deletedAt === null)) {
        return apiError('The project id does not exist in this account.', 422, { field: 'projectId' });
      }
      patch.parentType = 'project';
      patch.parentId = body.projectId;
      patch.processed = true;
    }
  }
  if (body.deleted === true) patch.deletedAt = now;

  await writeEntities(session.ownerId, [{ table: 'tasks', id, data: patch }]);
  return Response.json({ data: { id, ...patch } });
}
