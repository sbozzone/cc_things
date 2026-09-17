import type { DateOnly, Heading, Project, Task } from './types';

/**
 * List membership and the project scheduling policy (spec §4 and §5).
 *
 * These are the rules the whole product hangs on, so they are written as pure
 * functions over a single record set: a task shown in Today, Anytime, its project and
 * search is one task with one id, never a copy (R11).
 */

/** Why an item is not currently actionable. `null` means it is available. */
export type Hold = 'someday' | 'future' | null;

export interface HoldResult {
  hold: Hold;
  /** True when a reached deadline released an otherwise held item, so the UI can show why (spec §4). */
  releasedByDeadline: boolean;
  /** Set when the hold came from the parent project rather than the item itself. */
  inheritedFrom: 'project' | null;
}

export function isOpen(item: { status: string; deletedAt: string | null }): boolean {
  return item.status === 'open' && item.deletedAt === null;
}

export function isLive(item: { deletedAt: string | null }): boolean {
  return item.deletedAt === null;
}

export function deadlineReached(item: { deadline: DateOnly | null }, today: DateOnly): boolean {
  return item.deadline !== null && item.deadline <= today;
}

/** A project's own hold, ignoring its children. */
export function projectHold(project: Project, today: DateOnly): Hold {
  if (project.planning === 'someday') return 'someday';
  if (project.startDate !== null && project.startDate > today) return 'future';
  return null;
}

/**
 * Resolves whether a task is held, applying the inheritance contract:
 *
 * - An undated task inherits whether its project is available.
 * - An explicit task start date overrides that inherited hold.
 * - A reached deadline overrides either hold, so the commitment stays visible.
 * - A *future* deadline alone does not release a Someday hold.
 */
export function holdOf(task: Task, project: Project | null, today: DateOnly): HoldResult {
  if (deadlineReached(task, today)) {
    const underlying = rawHold(task, project, today);
    return {
      hold: null,
      releasedByDeadline: underlying.hold !== null,
      inheritedFrom: underlying.inheritedFrom,
    };
  }
  const raw = rawHold(task, project, today);
  return { ...raw, releasedByDeadline: false };
}

function rawHold(
  task: Task,
  project: Project | null,
  today: DateOnly,
): { hold: Hold; inheritedFrom: 'project' | null } {
  if (task.startDate !== null) {
    // An explicit start date is the task's own answer and overrides the project's hold.
    return { hold: task.startDate > today ? 'future' : null, inheritedFrom: null };
  }
  if (task.planning === 'someday') return { hold: 'someday', inheritedFrom: null };
  if (project && project.status === 'open') {
    const inherited = projectHold(project, today);
    if (inherited) return { hold: inherited, inheritedFrom: 'project' };
  }
  return { hold: null, inheritedFrom: null };
}

/** Available means open, not held, and therefore eligible for the active planning lists. */
export function isAvailable(task: Task, project: Project | null, today: DateOnly): boolean {
  return isOpen(task) && holdOf(task, project, today).hold === null;
}

/**
 * My Day contains explicit selections plus open work due on the planning day.
 * Future deadlines and overdue work remain independent unless explicitly selected.
 */
export function inToday(task: Task, project: Project | null, today: DateOnly): boolean {
  if (!isOpen(task)) return false;
  if (task.isInToday === true) return true;
  void project;
  return task.deadline === today;
}

/**
 * The evening group applies only to its own planning day. Yesterday's evening tasks
 * roll into the regular Today section rather than staying pinned to the evening (R13).
 */
export function inEvening(task: Task, today: DateOnly): boolean {
  return task.eveningDate !== null && task.eveningDate === today;
}

export function projectInToday(project: Project, today: DateOnly): boolean {
  if (project.status !== 'open' || project.deletedAt !== null) return false;
  if (project.startDate !== null && project.startDate <= today) return true;
  return deadlineReached(project, today);
}

export function isOverdue(item: { deadline: DateOnly | null }, today: DateOnly): boolean {
  return item.deadline !== null && item.deadline < today;
}

/**
 * Project progress (R09): completed tasks over all non-deleted, non-canceled tasks,
 * including tasks under archived headings. Checklist rows never count. An empty
 * denominator has no percentage at all rather than showing zero.
 */
export interface Progress {
  completed: number;
  total: number;
  /** 0–100, or `null` when there is nothing to measure. */
  percent: number | null;
}

export function projectProgress(tasks: Task[]): Progress {
  let completed = 0;
  let total = 0;
  for (const task of tasks) {
    if (task.deletedAt !== null) continue;
    if (task.status === 'canceled') continue;
    total += 1;
    if (task.status === 'completed') completed += 1;
  }
  return { completed, total, percent: total === 0 ? null : Math.round((completed / total) * 100) };
}

/** A heading may be archived only once every child is completed or canceled (R08). */
export function canArchiveHeading(heading: Heading, childTasks: Task[]): boolean {
  if (heading.deletedAt !== null) return false;
  return childTasks.every((t) => t.deletedAt !== null || t.status !== 'open');
}

/**
 * Inbox membership (R11): unprocessed open tasks. Filing to an area or project, or
 * assigning a planning state or date, processes a task; a note or tag alone does not.
 */
export function inInbox(task: Task): boolean {
  return isOpen(task) && task.parentType === 'inbox' && !task.processed;
}

/** True once the task carries anything that counts as having been processed. */
export function computeProcessed(task: Pick<Task, 'parentType' | 'planning' | 'startDate' | 'processed'>): boolean {
  if (task.processed) return true;
  if (task.parentType !== 'inbox') return true;
  if (task.planning !== 'anytime') return true;
  if (task.startDate !== null) return true;
  return false;
}
