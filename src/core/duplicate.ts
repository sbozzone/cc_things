import { newId } from './ids';
import { byRank, FIRST_RANK, keyBetween } from './rank';
import { create, update, type EntityPatch, type WriteContext } from './patches';
import type { ChecklistItem, Database, DateOnly, Heading, PlanningState, Project, Task } from './types';

/**
 * Duplicate and promote (R10).
 *
 * Everything here mints fresh ids and leaves the original untouched, and every result is
 * a patch set, so Undo reverses a conversion exactly.
 */

export interface DuplicateOptions {
  /** Keep start dates, evening designations and deadlines, or clear them. */
  keepDates: boolean;
  /** Reset completed and canceled items back to open. */
  resetCompletion: boolean;
}

export const DEFAULT_DUPLICATE: DuplicateOptions = { keepDates: true, resetCompletion: true };

interface DateFields {
  planning: PlanningState;
  startDate: DateOnly | null;
  eveningDate: DateOnly | null;
  deadline: DateOnly | null;
}

function datesFor(source: DateFields, options: DuplicateOptions): DateFields {
  if (options.keepDates) {
    return {
      planning: source.planning,
      startDate: source.startDate,
      eveningDate: source.eveningDate,
      deadline: source.deadline,
    };
  }
  return {
    planning: source.planning === 'someday' ? 'someday' : 'anytime',
    startDate: null,
    eveningDate: null,
    deadline: null,
  };
}

function lifecycleFor(source: Pick<Task, 'status' | 'completedAt' | 'canceledAt'>, options: DuplicateOptions) {
  if (options.resetCompletion) return { status: 'open' as const, completedAt: null, canceledAt: null };
  return { status: source.status, completedAt: source.completedAt, canceledAt: source.canceledAt };
}

function checklistOf(db: Database, taskId: string): ChecklistItem[] {
  return Object.values(db.checklistItems)
    .filter((c) => c.taskId === taskId && c.deletedAt === null)
    .sort(byRank);
}

function tagIdsOf(db: Database, targetType: 'task' | 'project' | 'area', targetId: string): string[] {
  return Object.values(db.tagAssignments)
    .filter((a) => a.deletedAt === null && a.targetType === targetType && a.targetId === targetId)
    .map((a) => a.tagId);
}

function tagPatches(ctx: WriteContext, targetType: 'task' | 'project', targetId: string, tagIds: string[]): EntityPatch[] {
  return tagIds.map((tagId) => {
    const id = newId();
    return create('tagAssignments', id, {
      id, ownerId: ctx.ownerId, tagId, targetType, targetId,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    });
  });
}

/** Copies one task's records into a new task under `overrides`. */
function copyTask(
  db: Database, ctx: WriteContext, source: Task, options: DuplicateOptions,
  overrides: Partial<Task> & { rank: string },
): { patches: EntityPatch[]; id: string } {
  const id = newId();
  const copy: Task = {
    ...source,
    ...datesFor(source, options),
    ...lifecycleFor(source, options),
    isInToday: false,
    ...overrides,
    id,
    ownerId: ctx.ownerId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
  };
  const patches: EntityPatch[] = [create('tasks', id, copy as unknown as Record<string, unknown>)];

  for (const item of checklistOf(db, source.id)) {
    const rowId = newId();
    patches.push(create('checklistItems', rowId, {
      id: rowId, ownerId: ctx.ownerId, taskId: id, text: item.text,
      checked: options.resetCompletion ? false : item.checked,
      rank: item.rank, createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    }));
  }
  patches.push(...tagPatches(ctx, 'task', id, tagIdsOf(db, 'task', source.id)));
  return { patches, id };
}

function siblingRankAfter(items: { rank: string }[], afterRank: string): string {
  const sorted = [...items].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const index = sorted.findIndex((item) => item.rank === afterRank);
  const next = index >= 0 ? sorted[index + 1] : undefined;
  return keyBetween(afterRank, next?.rank ?? null);
}

export function duplicateTask(
  db: Database, ctx: WriteContext, taskId: string, options: DuplicateOptions = DEFAULT_DUPLICATE,
): { patches: EntityPatch[]; id: string | null } {
  const source = db.tasks[taskId];
  if (!source || source.deletedAt !== null) return { patches: [], id: null };

  const siblings = Object.values(db.tasks).filter(
    (t) => t.deletedAt === null && t.parentType === source.parentType &&
      (t.parentId ?? null) === (source.parentId ?? null) && (t.headingId ?? null) === (source.headingId ?? null),
  );
  // The copy sits directly after the original rather than at the end of the list.
  const result = copyTask(db, ctx, source, options, { rank: siblingRankAfter(siblings, source.rank) });
  return { patches: result.patches, id: result.id };
}

export function duplicateHeading(
  db: Database, ctx: WriteContext, headingId: string, options: DuplicateOptions = DEFAULT_DUPLICATE,
): { patches: EntityPatch[]; id: string | null } {
  const source = db.headings[headingId];
  if (!source || source.deletedAt !== null) return { patches: [], id: null };

  const siblings = Object.values(db.headings).filter((h) => h.projectId === source.projectId && h.deletedAt === null);
  const newHeadingId = newId();
  const heading: Heading = {
    ...source,
    id: newHeadingId,
    ownerId: ctx.ownerId,
    rank: siblingRankAfter(siblings, source.rank),
    archivedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
  };
  const patches: EntityPatch[] = [create('headings', newHeadingId, heading as unknown as Record<string, unknown>)];

  for (const task of Object.values(db.tasks).filter((t) => t.headingId === headingId && t.deletedAt === null).sort(byRank)) {
    patches.push(...copyTask(db, ctx, task, options, { rank: task.rank, headingId: newHeadingId }).patches);
  }
  return { patches, id: newHeadingId };
}

export function duplicateProject(
  db: Database, ctx: WriteContext, projectId: string, options: DuplicateOptions = DEFAULT_DUPLICATE,
): { patches: EntityPatch[]; id: string | null } {
  const source = db.projects[projectId];
  if (!source || source.deletedAt !== null) return { patches: [], id: null };

  const siblings = Object.values(db.projects).filter((p) => p.deletedAt === null && (p.areaId ?? null) === (source.areaId ?? null));
  const newProjectId = newId();
  const project: Project = {
    ...source,
    ...datesFor(source, options),
    ...(options.resetCompletion ? { status: 'open' as const, completedAt: null, canceledAt: null } : {}),
    id: newProjectId,
    ownerId: ctx.ownerId,
    rank: siblingRankAfter(siblings, source.rank),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
  };
  const patches: EntityPatch[] = [create('projects', newProjectId, project as unknown as Record<string, unknown>)];
  patches.push(...tagPatches(ctx, 'project', newProjectId, tagIdsOf(db, 'project', projectId)));

  const headingMap = new Map<string, string>();
  for (const heading of Object.values(db.headings).filter((h) => h.projectId === projectId && h.deletedAt === null).sort(byRank)) {
    const copyId = newId();
    headingMap.set(heading.id, copyId);
    patches.push(create('headings', copyId, {
      ...heading, id: copyId, ownerId: ctx.ownerId, projectId: newProjectId,
      archivedAt: options.resetCompletion ? null : heading.archivedAt,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    }));
  }
  for (const task of Object.values(db.tasks).filter((t) => t.parentType === 'project' && t.parentId === projectId && t.deletedAt === null).sort(byRank)) {
    patches.push(...copyTask(db, ctx, task, options, {
      rank: task.rank,
      parentId: newProjectId,
      headingId: task.headingId ? headingMap.get(task.headingId) ?? null : null,
    }).patches);
  }
  return { patches, id: newProjectId };
}

/**
 * Converts a task into a project, turning its checklist rows into child tasks. The
 * original task is removed, so the conversion is a move rather than a copy — Undo
 * restores it exactly.
 */
export function taskToProject(db: Database, ctx: WriteContext, taskId: string): { patches: EntityPatch[]; id: string | null } {
  const task = db.tasks[taskId];
  if (!task || task.deletedAt !== null) return { patches: [], id: null };

  const projectId = newId();
  const areaId = task.parentType === 'area' ? task.parentId : task.parentType === 'project' && task.parentId
    ? db.projects[task.parentId]?.areaId ?? null
    : null;
  const siblings = Object.values(db.projects).filter((p) => p.deletedAt === null && (p.areaId ?? null) === areaId).sort(byRank);
  const last = siblings[siblings.length - 1];

  const patches: EntityPatch[] = [create('projects', projectId, {
    id: projectId, ownerId: ctx.ownerId, areaId, title: task.title, notes: task.notes,
    status: task.status, planning: task.planning, startDate: task.startDate,
    eveningDate: task.eveningDate, deadline: task.deadline,
    rank: last ? keyBetween(last.rank, null) : FIRST_RANK,
    completedAt: task.completedAt, canceledAt: task.canceledAt,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  })];

  // Direct tags move across; inherited ones are recalculated from the new parent.
  patches.push(...tagPatches(ctx, 'project', projectId, tagIdsOf(db, 'task', taskId)));

  // Checklist rows become child tasks, in order, keeping their checked state.
  for (const item of checklistOf(db, taskId)) {
    const childId = newId();
    patches.push(create('tasks', childId, {
      id: childId, ownerId: ctx.ownerId, title: item.text, notes: '',
      status: item.checked ? 'completed' : 'open', processed: true,
      parentType: 'project', parentId: projectId, headingId: null,
      planning: 'anytime', startDate: null, eveningDate: null, deadline: null,
      rank: item.rank, todayRank: item.rank,
      completedAt: item.checked ? ctx.now : null, canceledAt: null,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    }));
    patches.push(update('checklistItems', item.id, { deletedAt: ctx.now }, ctx));
  }

  patches.push(update('tasks', taskId, { deletedAt: ctx.now }, ctx));
  return { patches, id: projectId };
}

/** Converts a heading into a project of its own, taking its tasks with it. */
export function headingToProject(db: Database, ctx: WriteContext, headingId: string): { patches: EntityPatch[]; id: string | null } {
  const heading = db.headings[headingId];
  if (!heading || heading.deletedAt !== null) return { patches: [], id: null };

  const sourceProject = db.projects[heading.projectId];
  const areaId = sourceProject?.areaId ?? null;
  const projectId = newId();
  const siblings = Object.values(db.projects).filter((p) => p.deletedAt === null && (p.areaId ?? null) === areaId).sort(byRank);
  const last = siblings[siblings.length - 1];

  const patches: EntityPatch[] = [create('projects', projectId, {
    id: projectId, ownerId: ctx.ownerId, areaId, title: heading.title, notes: '',
    status: 'open', planning: 'anytime', startDate: null, eveningDate: null, deadline: null,
    rank: last ? keyBetween(last.rank, null) : FIRST_RANK,
    completedAt: null, canceledAt: null,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  })];

  // The tasks move rather than being copied, keeping their ids, notes and dates.
  for (const task of Object.values(db.tasks).filter((t) => t.headingId === headingId && t.deletedAt === null).sort(byRank)) {
    patches.push(update('tasks', task.id, { parentType: 'project', parentId: projectId, headingId: null, processed: true }, ctx));
  }
  patches.push(update('headings', headingId, { deletedAt: ctx.now }, ctx));
  return { patches, id: projectId };
}
