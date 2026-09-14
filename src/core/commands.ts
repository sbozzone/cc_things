import { addDays, resolveInstant, today as todayOf } from './dates';
import { newId } from './ids';
import { byRank, FIRST_RANK, keyBetween } from './rank';
import { canArchiveHeading, computeProcessed } from './membership';
import { wouldCycle } from './tags';
import { create, update, type EntityPatch, type WriteContext } from './patches';
import type {
  Area, ChecklistItem, Database, DateOnly, Heading, LifecycleStatus, PlanningState,
  Project, Tag, TagTargetType, Task, TaskParentType,
} from './types';
import type { Clock } from './clock';

/**
 * User-facing commands (R01–R10, R22–R26). Each returns patches rather than mutating,
 * so the store can commit the record and its pending sync operation in one durable
 * local transaction (R33).
 */

export function contextFor(clock: Clock, ownerId: string): WriteContext {
  return { ownerId, now: new Date(clock.now()).toISOString(), today: todayOf(clock), timeZone: clock.timeZone() };
}

export interface AddTarget {
  parentType: TaskParentType;
  parentId: string | null;
  headingId: string | null;
  planning?: PlanningState;
  startDate?: DateOnly | null;
  deadline?: DateOnly | null;
  /** Adds the new task to the current My Day without scheduling it permanently. */
  myDay?: boolean;
  evening?: boolean;
}

const RETENTION_DAYS = 30;

/* -------------------------------------------------------------- ordering */

function siblingTasks(db: Database, target: { parentType: TaskParentType; parentId: string | null; headingId: string | null }): Task[] {
  return Object.values(db.tasks)
    .filter((t) =>
      t.deletedAt === null &&
      t.parentType === target.parentType &&
      (t.parentId ?? null) === (target.parentId ?? null) &&
      (t.headingId ?? null) === (target.headingId ?? null))
    .sort(byRank);
}

function rankAtEnd(items: { rank: string }[]): string {
  const last = items[items.length - 1];
  return last ? keyBetween(last.rank, null) : FIRST_RANK;
}

function rankAtStart(items: { rank: string }[]): string {
  const first = items[0];
  return first ? keyBetween(null, first.rank) : FIRST_RANK;
}

function todayRankAtStart(db: Database): string {
  const inToday = Object.values(db.tasks)
    .filter((t) => t.deletedAt === null && t.status === 'open' && t.isInToday === true)
    .sort((a, b) => (a.todayRank < b.todayRank ? -1 : a.todayRank > b.todayRank ? 1 : 0));
  const first = inToday[0];
  return first ? keyBetween(null, first.todayRank) : FIRST_RANK;
}

/* ----------------------------------------------------------------- tasks */

export interface NewTaskInput {
  title: string;
  notes?: string;
  target: AddTarget;
  /** Insert at the top of the destination rather than the end. */
  atTop?: boolean;
  deadline?: DateOnly | null;
  tagIds?: string[];
  checklist?: string[];
}

export function createTask(db: Database, ctx: WriteContext, input: NewTaskInput): { patches: EntityPatch[]; id: string } {
  const id = newId();
  const target = input.target;
  const siblings = siblingTasks(db, target);
  const planning: PlanningState = target.planning ?? (target.startDate ? 'scheduled' : 'anytime');
  const startDate = planning === 'scheduled' ? target.startDate ?? ctx.today : null;

  const task: Task = {
    id,
    ownerId: ctx.ownerId,
    title: input.title.trim(),
    notes: input.notes ?? '',
    status: 'open',
    processed: target.myDay === true,
    parentType: target.parentType,
    parentId: target.parentId,
    headingId: target.headingId,
    planning,
    startDate,
    eveningDate: target.evening ? (startDate ?? (target.myDay ? ctx.today : null)) : null,
    deadline: input.deadline ?? target.deadline ?? null,
    isInToday: target.myDay ?? false,
    rank: input.atTop ? rankAtStart(siblings) : rankAtEnd(siblings),
    todayRank: todayRankAtStart(db),
    completedAt: null,
    canceledAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
  };
  task.processed = computeProcessed(task);

  const patches: EntityPatch[] = [create('tasks', id, task as unknown as Record<string, unknown>)];
  for (const tagId of input.tagIds ?? []) patches.push(...assignTag(db, ctx, tagId, 'task', id));
  if (input.checklist?.length) patches.push(...appendChecklist(db, ctx, id, input.checklist));
  return { patches, id };
}

export function updateTask(db: Database, ctx: WriteContext, id: string, fields: Partial<Task>): EntityPatch[] {
  const task = db.tasks[id];
  if (!task) return [];
  const merged = { ...task, ...fields };
  return [update('tasks', id, { ...fields, processed: computeProcessed(merged) }, ctx)];
}

/** Selects or removes a task from the current My Day without changing its dates. */
export function setTaskInToday(db: Database, ctx: WriteContext, id: string, isInToday: boolean): EntityPatch[] {
  const task = db.tasks[id];
  if (!task || task.deletedAt !== null || task.status !== 'open') return [];
  return [update('tasks', id, {
    isInToday,
    // Choosing an Inbox suggestion is a planning decision, so it should leave Inbox.
    processed: isInToday ? true : task.processed,
    todayRank: isInToday ? todayRankAtStart(db) : task.todayRank,
  }, ctx)];
}

export function updateTag(db: Database, ctx: WriteContext, id: string, fields: Partial<Tag>): EntityPatch[] {
  if (!db.tags[id]) return [];
  return [update('tags', id, fields, ctx)];
}

/** Persists an explicit order while leaving every item's parent and heading unchanged. */
export function orderItems(
  db: Database, ctx: WriteContext, ids: string[], scope: 'structural' | 'today' = 'structural',
): EntityPatch[] {
  let rank: string | null = null;
  const patches: EntityPatch[] = [];
  for (const id of ids) {
    const task = db.tasks[id];
    const project = db.projects[id];
    if (!task && !project) continue;
    rank = keyBetween(rank, null);
    patches.push(update(task ? 'tasks' : 'projects', id, {
      [task && scope === 'today' ? 'todayRank' : 'rank']: rank,
    }, ctx));
  }
  return patches;
}

export interface WhenInput {
  planning: PlanningState;
  startDate?: DateOnly | null;
  /** Only meaningful together with a start date on the planning day. */
  evening?: boolean;
}

/**
 * The single "When" control (R15). Clearing When returns a processed item to Anytime
 * and leaves the deadline alone. Clearing a start also clears its reminder.
 */
export function setWhen(db: Database, ctx: WriteContext, id: string, when: WhenInput): EntityPatch[] {
  const task = db.tasks[id];
  if (!task) return [];
  const startDate = when.planning === 'scheduled' ? when.startDate ?? ctx.today : null;
  // An evening designation belongs to its own planning day; moving the start resets it
  // unless the caller asks for evening again.
  const eveningDate = startDate !== null && when.evening ? startDate : null;

  const patches: EntityPatch[] = [];
  const next = {
    planning: when.planning,
    startDate,
    eveningDate,
    processed: true,
  };
  patches.push(update('tasks', id, next, ctx));

  if (startDate === null) {
    patches.push(...clearReminders(db, ctx, id));
  } else {
    patches.push(...rescheduleReminders(db, ctx, id, startDate));
  }
  return patches;
}

export function setDeadline(db: Database, ctx: WriteContext, id: string, deadline: DateOnly | null): EntityPatch[] {
  if (!db.tasks[id]) return [];
  return [update('tasks', id, { deadline }, ctx)];
}

/** Warns when a start falls after its deadline; the caller may still save explicitly. */
export function datesConflict(startDate: DateOnly | null, deadline: DateOnly | null): boolean {
  return startDate !== null && deadline !== null && startDate > deadline;
}

export function setTaskStatus(db: Database, ctx: WriteContext, id: string, status: LifecycleStatus): EntityPatch[] {
  const task = db.tasks[id];
  if (!task) return [];
  const patches: EntityPatch[] = [update('tasks', id, {
    status,
    completedAt: status === 'completed' ? ctx.now : null,
    canceledAt: status === 'canceled' ? ctx.now : null,
  }, ctx)];
  // Completing or canceling cancels pending notifications (R05).
  if (status !== 'open') patches.push(...cancelReminders(db, ctx, id));
  return patches;
}

export function deleteTask(db: Database, ctx: WriteContext, id: string): EntityPatch[] {
  if (!db.tasks[id]) return [];
  return [update('tasks', id, { deletedAt: ctx.now }, ctx), ...cancelReminders(db, ctx, id)];
}

export function restoreTask(db: Database, ctx: WriteContext, id: string): EntityPatch[] {
  const task = db.tasks[id];
  if (!task) return [];
  const patch: Record<string, unknown> = { deletedAt: null };
  // Offer a valid home when the original parent is gone (R06).
  if (task.parentType === 'project' && task.parentId) {
    const project = db.projects[task.parentId];
    if (!project || project.deletedAt !== null) {
      patch.parentType = 'inbox';
      patch.parentId = null;
      patch.headingId = null;
      patch.processed = false;
    }
  }
  if (task.headingId && !db.headings[task.headingId]) patch.headingId = null;
  return [update('tasks', id, patch, ctx)];
}

/** Batch move preserving the selection's relative order (R24). */
export function moveTasks(db: Database, ctx: WriteContext, ids: string[], target: AddTarget): EntityPatch[] {
  const moving = ids
    .map((id) => db.tasks[id])
    .filter((t): t is Task => t !== undefined && t.deletedAt === null)
    .sort(byRank);
  if (moving.length === 0) return [];
  if (target.parentType === 'project' && target.headingId) {
    const heading = db.headings[target.headingId];
    // Heading membership requires that heading's project (spec §12 invariants).
    if (!heading || heading.projectId !== target.parentId) return [];
  }

  const siblings = siblingTasks(db, target).filter((t) => !ids.includes(t.id));
  let cursor = siblings.length > 0 ? (siblings[siblings.length - 1] as Task).rank : null;
  const patches: EntityPatch[] = [];
  for (const task of moving) {
    const rank = keyBetween(cursor, null);
    cursor = rank;
    const merged = {
      ...task,
      parentType: target.parentType,
      parentId: target.parentId,
      headingId: target.parentType === 'project' ? target.headingId : null,
    };
    patches.push(update('tasks', task.id, {
      parentType: merged.parentType,
      parentId: merged.parentId,
      headingId: merged.headingId,
      rank,
      processed: target.parentType === 'inbox' ? computeProcessed({ ...merged, processed: false }) : true,
    }, ctx));
  }
  return patches;
}

/** Reorders within a list. `view` picks structural order or Today's separate order (R25). */
export function reorderTask(
  db: Database, ctx: WriteContext, id: string,
  neighbours: { beforeId: string | null; afterId: string | null },
  view: 'structural' | 'today' = 'structural',
): EntityPatch[] {
  const task = db.tasks[id];
  if (!task) return [];
  const field = view === 'today' ? 'todayRank' : 'rank';
  const rankOf = (otherId: string | null): string | null => {
    if (!otherId) return null;
    const other = db.tasks[otherId] ?? db.projects[otherId];
    if (!other) return null;
    return view === 'today' && 'todayRank' in other ? other.todayRank : other.rank;
  };
  const before = rankOf(neighbours.beforeId);
  const after = rankOf(neighbours.afterId);
  if (before !== null && after !== null && before >= after) return [];
  return [update('tasks', id, { [field]: keyBetween(before, after) }, ctx)];
}

/* ------------------------------------------------------------- checklist */

export function appendChecklist(db: Database, ctx: WriteContext, taskId: string, lines: string[]): EntityPatch[] {
  const existing = Object.values(db.checklistItems)
    .filter((c) => c.taskId === taskId && c.deletedAt === null)
    .sort(byRank);
  let cursor = existing.length > 0 ? (existing[existing.length - 1] as ChecklistItem).rank : null;
  const patches: EntityPatch[] = [];
  // Pasting multiple lines offers one row per non-blank line (R03).
  for (const raw of lines) {
    const text = raw.trim();
    if (text.length === 0) continue;
    const rank = keyBetween(cursor, null);
    cursor = rank;
    const id = newId();
    const item: ChecklistItem = {
      id, ownerId: ctx.ownerId, taskId, text, checked: false, rank,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    };
    patches.push(create('checklistItems', id, item as unknown as Record<string, unknown>));
  }
  return patches;
}

export function updateChecklistItem(db: Database, ctx: WriteContext, id: string, fields: Partial<ChecklistItem>): EntityPatch[] {
  if (!db.checklistItems[id]) return [];
  return [update('checklistItems', id, fields, ctx)];
}

export function deleteChecklistItem(db: Database, ctx: WriteContext, id: string): EntityPatch[] {
  if (!db.checklistItems[id]) return [];
  return [update('checklistItems', id, { deletedAt: ctx.now }, ctx)];
}

export function reorderChecklistItem(
  db: Database, ctx: WriteContext, id: string,
  neighbours: { beforeId: string | null; afterId: string | null },
): EntityPatch[] {
  if (!db.checklistItems[id]) return [];
  const before = neighbours.beforeId ? db.checklistItems[neighbours.beforeId]?.rank ?? null : null;
  const after = neighbours.afterId ? db.checklistItems[neighbours.afterId]?.rank ?? null : null;
  if (before !== null && after !== null && before >= after) return [];
  return [update('checklistItems', id, { rank: keyBetween(before, after) }, ctx)];
}

/* -------------------------------------------------------------- projects */

export function createProject(
  db: Database, ctx: WriteContext,
  input: { title: string; areaId?: string | null; notes?: string },
): { patches: EntityPatch[]; id: string } {
  const id = newId();
  const siblings = Object.values(db.projects)
    .filter((p) => p.deletedAt === null && (p.areaId ?? null) === (input.areaId ?? null))
    .sort(byRank);
  const project: Project = {
    id, ownerId: ctx.ownerId, areaId: input.areaId ?? null, title: input.title.trim(),
    notes: input.notes ?? '', status: 'open', planning: 'anytime',
    startDate: null, eveningDate: null, deadline: null,
    rank: rankAtEnd(siblings), completedAt: null, canceledAt: null,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  };
  return { patches: [create('projects', id, project as unknown as Record<string, unknown>)], id };
}

export function updateProject(db: Database, ctx: WriteContext, id: string, fields: Partial<Project>): EntityPatch[] {
  if (!db.projects[id]) return [];
  return [update('projects', id, fields, ctx)];
}

export function setProjectWhen(db: Database, ctx: WriteContext, id: string, when: WhenInput): EntityPatch[] {
  if (!db.projects[id]) return [];
  const startDate = when.planning === 'scheduled' ? when.startDate ?? ctx.today : null;
  return [update('projects', id, { planning: when.planning, startDate, eveningDate: null }, ctx)];
}

export function childTasksOf(db: Database, projectId: string): Task[] {
  return Object.values(db.tasks).filter((t) => t.deletedAt === null && t.parentType === 'project' && t.parentId === projectId);
}

/**
 * Completing a project requires resolving its open tasks; the caller passes how to
 * resolve them as an explicit batch (R09).
 */
export function setProjectStatus(
  db: Database, ctx: WriteContext, id: string, status: LifecycleStatus,
  resolveOpenAs: 'completed' | 'canceled' | null = null,
): EntityPatch[] {
  const project = db.projects[id];
  if (!project) return [];
  const patches: EntityPatch[] = [update('projects', id, {
    status,
    completedAt: status === 'completed' ? ctx.now : null,
    canceledAt: status === 'canceled' ? ctx.now : null,
  }, ctx)];
  if (status !== 'open' && resolveOpenAs) {
    for (const task of childTasksOf(db, id)) {
      if (task.status !== 'open') continue;
      patches.push(...setTaskStatus(db, ctx, task.id, resolveOpenAs));
    }
  }
  return patches;
}

export function openTaskCount(db: Database, projectId: string): number {
  return childTasksOf(db, projectId).filter((t) => t.status === 'open').length;
}

export function deleteProject(db: Database, ctx: WriteContext, id: string): EntityPatch[] {
  const project = db.projects[id];
  if (!project) return [];
  const patches: EntityPatch[] = [update('projects', id, { deletedAt: ctx.now }, ctx)];
  for (const heading of Object.values(db.headings)) {
    if (heading.projectId === id && heading.deletedAt === null) {
      patches.push(update('headings', heading.id, { deletedAt: ctx.now }, ctx));
    }
  }
  for (const task of childTasksOf(db, id)) patches.push(...deleteTask(db, ctx, task.id));
  return patches;
}

export function restoreProject(db: Database, ctx: WriteContext, id: string): EntityPatch[] {
  const project = db.projects[id];
  if (!project) return [];
  const deletedAt = project.deletedAt;
  const patches: EntityPatch[] = [update('projects', id, {
    deletedAt: null,
    // Offer a home if the area is gone.
    areaId: project.areaId && db.areas[project.areaId]?.deletedAt === null ? project.areaId : null,
  }, ctx)];
  // Restore the structure that went down with it, but not items deleted beforehand.
  for (const heading of Object.values(db.headings)) {
    if (heading.projectId === id && heading.deletedAt === deletedAt) {
      patches.push(update('headings', heading.id, { deletedAt: null }, ctx));
    }
  }
  for (const task of Object.values(db.tasks)) {
    if (task.parentType === 'project' && task.parentId === id && task.deletedAt === deletedAt) {
      patches.push(update('tasks', task.id, { deletedAt: null }, ctx));
    }
  }
  return patches;
}

/* -------------------------------------------------------------- headings */

export function createHeading(
  db: Database, ctx: WriteContext, projectId: string, title: string,
): { patches: EntityPatch[]; id: string } {
  const id = newId();
  const siblings = Object.values(db.headings).filter((h) => h.projectId === projectId && h.deletedAt === null).sort(byRank);
  const heading: Heading = {
    id, ownerId: ctx.ownerId, projectId, title: title.trim(), rank: rankAtEnd(siblings),
    archivedAt: null, createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  };
  return { patches: [create('headings', id, heading as unknown as Record<string, unknown>)], id };
}

/** Moving a heading moves every child with it, in the same relative order (R08). */
export function moveHeading(
  db: Database, ctx: WriteContext, headingId: string, toProjectId: string,
  neighbours: { beforeId: string | null; afterId: string | null } = { beforeId: null, afterId: null },
): EntityPatch[] {
  const heading = db.headings[headingId];
  if (!heading) return [];
  const before = neighbours.beforeId ? db.headings[neighbours.beforeId]?.rank ?? null : null;
  const after = neighbours.afterId ? db.headings[neighbours.afterId]?.rank ?? null : null;
  const siblings = Object.values(db.headings)
    .filter((h) => h.projectId === toProjectId && h.deletedAt === null && h.id !== headingId)
    .sort(byRank);
  const rank = before === null && after === null ? rankAtEnd(siblings) : keyBetween(before, after);

  const patches: EntityPatch[] = [update('headings', headingId, { projectId: toProjectId, rank }, ctx)];
  const children = Object.values(db.tasks)
    .filter((t) => t.headingId === headingId && t.deletedAt === null)
    .sort(byRank);
  for (const task of children) {
    patches.push(update('tasks', task.id, { parentType: 'project', parentId: toProjectId, processed: true }, ctx));
  }
  return patches;
}

export function archiveHeading(db: Database, ctx: WriteContext, headingId: string): { patches: EntityPatch[]; blocked: boolean } {
  const heading = db.headings[headingId];
  if (!heading) return { patches: [], blocked: false };
  const children = Object.values(db.tasks).filter((t) => t.headingId === headingId && t.deletedAt === null);
  if (!canArchiveHeading(heading, children)) return { patches: [], blocked: true };
  return { patches: [update('headings', headingId, { archivedAt: ctx.now }, ctx)], blocked: false };
}

export function deleteHeading(db: Database, ctx: WriteContext, headingId: string, deleteChildren: boolean): EntityPatch[] {
  const heading = db.headings[headingId];
  if (!heading) return [];
  const patches: EntityPatch[] = [update('headings', headingId, { deletedAt: ctx.now }, ctx)];
  for (const task of Object.values(db.tasks)) {
    if (task.headingId !== headingId || task.deletedAt !== null) continue;
    if (deleteChildren) patches.push(...deleteTask(db, ctx, task.id));
    else patches.push(update('tasks', task.id, { headingId: null }, ctx));
  }
  return patches;
}

/* ----------------------------------------------------------------- areas */

export function createArea(db: Database, ctx: WriteContext, title: string): { patches: EntityPatch[]; id: string } {
  const id = newId();
  const siblings = Object.values(db.areas).filter((a) => a.deletedAt === null).sort(byRank);
  const area: Area = {
    id, ownerId: ctx.ownerId, title: title.trim(), rank: rankAtEnd(siblings),
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  };
  return { patches: [create('areas', id, area as unknown as Record<string, unknown>)], id };
}

export function updateArea(db: Database, ctx: WriteContext, id: string, fields: Partial<Area>): EntityPatch[] {
  if (!db.areas[id]) return [];
  return [update('areas', id, fields, ctx)];
}

/**
 * Deleting an area either moves its contents out or takes them to Trash with it; the
 * effect is stated before confirmation in the UI (spec §4, area lifecycle).
 */
export function deleteArea(
  db: Database, ctx: WriteContext, id: string, mode: 'moveContentsOut' | 'deleteContents',
): EntityPatch[] {
  if (!db.areas[id]) return [];
  const patches: EntityPatch[] = [update('areas', id, { deletedAt: ctx.now }, ctx)];
  for (const project of Object.values(db.projects)) {
    if (project.areaId !== id || project.deletedAt !== null) continue;
    if (mode === 'moveContentsOut') patches.push(update('projects', project.id, { areaId: null }, ctx));
    else patches.push(...deleteProject(db, ctx, project.id));
  }
  for (const task of Object.values(db.tasks)) {
    if (task.parentType !== 'area' || task.parentId !== id || task.deletedAt !== null) continue;
    if (mode === 'moveContentsOut') {
      patches.push(update('tasks', task.id, { parentType: 'inbox', parentId: null, processed: true }, ctx));
    } else {
      patches.push(...deleteTask(db, ctx, task.id));
    }
  }
  return patches;
}

/* ------------------------------------------------------------------ tags */

export function createTag(
  db: Database, ctx: WriteContext, name: string, parentTagId: string | null = null,
): { patches: EntityPatch[]; id: string } {
  const existing = Object.values(db.tags).find(
    (t) => t.deletedAt === null && t.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (existing) return { patches: [], id: existing.id };
  const id = newId();
  const siblings = Object.values(db.tags).filter((t) => t.deletedAt === null && t.parentTagId === parentTagId).sort(byRank);
  const tag: Tag = {
    id, ownerId: ctx.ownerId, name: name.trim(), parentTagId, rank: rankAtEnd(siblings),
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  };
  return { patches: [create('tags', id, tag as unknown as Record<string, unknown>)], id };
}

export function nestTag(db: Database, ctx: WriteContext, tagId: string, parentTagId: string | null): EntityPatch[] {
  if (!db.tags[tagId]) return [];
  if (wouldCycle(db, tagId, parentTagId)) return [];
  return [update('tags', tagId, { parentTagId }, ctx)];
}

export function deleteTag(db: Database, ctx: WriteContext, tagId: string): EntityPatch[] {
  if (!db.tags[tagId]) return [];
  const patches: EntityPatch[] = [update('tags', tagId, { deletedAt: ctx.now }, ctx)];
  for (const child of Object.values(db.tags)) {
    if (child.parentTagId === tagId && child.deletedAt === null) {
      patches.push(update('tags', child.id, { parentTagId: db.tags[tagId]?.parentTagId ?? null }, ctx));
    }
  }
  for (const assignment of Object.values(db.tagAssignments)) {
    if (assignment.tagId === tagId && assignment.deletedAt === null) {
      patches.push(update('tagAssignments', assignment.id, { deletedAt: ctx.now }, ctx));
    }
  }
  return patches;
}

export function assignTag(
  db: Database, ctx: WriteContext, tagId: string, targetType: TagTargetType, targetId: string,
): EntityPatch[] {
  const existing = Object.values(db.tagAssignments).find(
    (a) => a.tagId === tagId && a.targetType === targetType && a.targetId === targetId,
  );
  if (existing) {
    return existing.deletedAt === null ? [] : [update('tagAssignments', existing.id, { deletedAt: null }, ctx)];
  }
  const id = newId();
  return [create('tagAssignments', id, {
    id, ownerId: ctx.ownerId, tagId, targetType, targetId,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  })];
}

export function unassignTag(
  db: Database, ctx: WriteContext, tagId: string, targetType: TagTargetType, targetId: string,
): EntityPatch[] {
  const existing = Object.values(db.tagAssignments).find(
    (a) => a.tagId === tagId && a.targetType === targetType && a.targetId === targetId && a.deletedAt === null,
  );
  return existing ? [update('tagAssignments', existing.id, { deletedAt: ctx.now }, ctx)] : [];
}

/* ------------------------------------------------------------- reminders */

/** A reminder hangs off the task's start date; a deadline never creates one (R19). */
export function setReminder(db: Database, ctx: WriteContext, taskId: string, wallTime: string): EntityPatch[] {
  const task = db.tasks[taskId];
  if (!task || task.startDate === null) return [];
  const resolved = resolveInstant(task.startDate, wallTime, ctx.timeZone);
  const existing = Object.values(db.reminders).find((r) => r.taskId === taskId && r.deletedAt === null);
  if (existing) {
    return [update('reminders', existing.id, {
      wallTime, timeZone: ctx.timeZone, fireInstant: resolved.instant,
      snoozedUntil: null, canceledAt: null, generation: existing.generation + 1,
    }, ctx)];
  }
  const id = newId();
  return [create('reminders', id, {
    id, ownerId: ctx.ownerId, taskId, wallTime, timeZone: ctx.timeZone,
    fireInstant: resolved.instant, snoozedUntil: null, generation: 1, canceledAt: null,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  })];
}

export function clearReminders(db: Database, ctx: WriteContext, taskId: string): EntityPatch[] {
  return Object.values(db.reminders)
    .filter((r) => r.taskId === taskId && r.deletedAt === null)
    .map((r) => update('reminders', r.id, { deletedAt: ctx.now, canceledAt: ctx.now }, ctx));
}

export function cancelReminders(db: Database, ctx: WriteContext, taskId: string): EntityPatch[] {
  return Object.values(db.reminders)
    .filter((r) => r.taskId === taskId && r.deletedAt === null && r.canceledAt === null)
    .map((r) => update('reminders', r.id, { canceledAt: ctx.now, generation: r.generation + 1 }, ctx));
}

/** Rescheduling the task moves its pending notification and bumps the generation. */
export function rescheduleReminders(db: Database, ctx: WriteContext, taskId: string, startDate: DateOnly): EntityPatch[] {
  return Object.values(db.reminders)
    .filter((r) => r.taskId === taskId && r.deletedAt === null)
    .map((r) => {
      const resolved = resolveInstant(startDate, r.wallTime, r.timeZone);
      return update('reminders', r.id, {
        fireInstant: resolved.instant, snoozedUntil: null, canceledAt: null, generation: r.generation + 1,
      }, ctx);
    });
}

/** Snoozing shifts delivery only; it never changes the task's start date or deadline. */
export function snoozeReminder(db: Database, ctx: WriteContext, reminderId: string, minutes: 10 | 30 | 60): EntityPatch[] {
  const reminder = db.reminders[reminderId];
  if (!reminder) return [];
  const until = new Date(Date.parse(ctx.now) + minutes * 60_000).toISOString();
  return [update('reminders', reminderId, { snoozedUntil: until, generation: reminder.generation + 1 }, ctx)];
}

/* ---------------------------------------------------------------- purge */

/** Purges Trash entries past the retention window; purged ids must never reappear. */
export function purgeExpiredTrash(db: Database, ctx: WriteContext): { patches: EntityPatch[]; purgedIds: string[] } {
  const cutoff = addDays(ctx.today, -RETENTION_DAYS);
  const purgedIds: string[] = [];
  const patches: EntityPatch[] = [];
  const sweep = (table: 'tasks' | 'projects' | 'headings' | 'checklistItems', records: { id: string; deletedAt: string | null }[]) => {
    for (const record of records) {
      if (record.deletedAt === null) continue;
      if (record.deletedAt.slice(0, 10) > cutoff) continue;
      purgedIds.push(record.id);
      patches.push({ table, id: record.id, patch: { purged: true } });
    }
  };
  sweep('tasks', Object.values(db.tasks));
  sweep('projects', Object.values(db.projects));
  sweep('headings', Object.values(db.headings));
  sweep('checklistItems', Object.values(db.checklistItems));
  return { patches, purgedIds };
}

export const TRASH_RETENTION_DAYS = RETENTION_DAYS;
