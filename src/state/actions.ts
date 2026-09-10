'use client';

import * as commands from '@/core/commands';
import { effectiveTaskTags } from '@/core/tags';
import {
  onOccurrenceCanceled, onOccurrenceCompleted, onOccurrenceReopened,
} from '@/core/recurrence';
import type { EntityPatch } from '@/core/patches';
import type { AddTarget } from '@/core/commands';
import type { DateOnly, LifecycleStatus, Task } from '@/core/types';
import {
  duplicateHeading, duplicateProject, duplicateTask, headingToProject, taskToProject,
  type DuplicateOptions,
} from '@/core/duplicate';
import type { WhenValue } from '@/ui/DatePopover';
import { useApp } from './store';

/**
 * Bound actions: they read the current database, build patches with the core commands,
 * and hand them to `dispatch`, which owns persistence, the sync queue and Undo.
 */

function app() {
  return useApp.getState();
}

export function addTask(target: AddTarget, title: string, options: { atTop?: boolean; notes?: string } = {}): string | null {
  const state = app();
  if (title.trim().length === 0) return null; // a blank submission never creates an item (R01)
  const result = commands.createTask(state.db, state.ctx(), {
    title,
    notes: options.notes,
    target,
    atTop: options.atTop,
  });
  state.dispatch(result.patches, { undoLabel: 'add task' });
  return result.id;
}

export function updateTask(id: string, fields: Partial<Task>, undoLabel?: string): void {
  const state = app();
  state.dispatch(commands.updateTask(state.db, state.ctx(), id, fields), { undoLabel });
}

export function applyWhen(ids: string[], value: WhenValue): void {
  const state = app();
  const ctx = state.ctx();
  const patches: EntityPatch[] = [];
  for (const id of ids) {
    patches.push(...commands.setWhen(state.db, ctx, id, {
      planning: value.planning,
      startDate: value.startDate,
      evening: value.evening,
    }));
    if (value.reminder && value.startDate) {
      patches.push(...commands.setReminder(
        { ...state.db, tasks: { ...state.db.tasks, [id]: { ...(state.db.tasks[id] as Task), startDate: value.startDate } } },
        ctx, id, value.reminder,
      ));
    } else if (!value.reminder) {
      patches.push(...commands.clearReminders(state.db, ctx, id));
    }
  }
  state.dispatch(patches, { undoLabel: 'schedule' });
}

export function applyDeadline(ids: string[], deadline: DateOnly | null): void {
  const state = app();
  const ctx = state.ctx();
  const patches = ids.flatMap((id) => commands.setDeadline(state.db, ctx, id, deadline));
  state.dispatch(patches, { undoLabel: 'deadline' });
}

/**
 * Status changes also drive recurrence: completing a completion-relative copy produces
 * the next one, undoing that completion retracts an untouched copy, and canceling one
 * pauses the series for review (§7).
 */
export function setStatus(ids: string[], status: LifecycleStatus): void {
  const state = app();
  const ctx = state.ctx();
  const patches: EntityPatch[] = [];
  for (const id of ids) {
    patches.push(...commands.setTaskStatus(state.db, ctx, id, status));
    if (status === 'completed') patches.push(...onOccurrenceCompleted(state.db, ctx, id, ctx.today));
    if (status === 'canceled') patches.push(...onOccurrenceCanceled(state.db, ctx, id));
    if (status === 'open') patches.push(...onOccurrenceReopened(state.db, ctx, id));
  }
  const label = status === 'completed' ? 'complete' : status === 'canceled' ? 'cancel' : 'reopen';
  state.dispatch(patches, {
    undoLabel: label,
    toast: ids.length > 1
      ? { message: `${ids.length} tasks ${status === 'open' ? 'reopened' : status}`, tone: 'info', actionLabel: 'Undo', action: () => app().undo() }
      : null,
  });
}

export function deleteTasks(ids: string[]): void {
  const state = app();
  const ctx = state.ctx();
  const patches = ids.flatMap((id) => commands.deleteTask(state.db, ctx, id));
  state.dispatch(patches, {
    undoLabel: 'delete',
    toast: { message: `Moved ${ids.length === 1 ? 'task' : `${ids.length} tasks`} to Trash`, tone: 'info', actionLabel: 'Undo', action: () => app().undo() },
  });
  state.clearSelection();
}

export function restoreItem(id: string): void {
  const state = app();
  const ctx = state.ctx();
  const patches = state.db.projects[id]
    ? commands.restoreProject(state.db, ctx, id)
    : commands.restoreTask(state.db, ctx, id);
  state.dispatch(patches, { undoLabel: 'restore' });
}

/** Batch move (R24): the selection's relative order survives, and the whole set moves or none does. */
export function moveTasks(ids: string[], target: AddTarget): void {
  const state = app();
  const patches = commands.moveTasks(state.db, state.ctx(), ids, target);
  if (patches.length === 0) {
    state.pushToast({ message: 'That destination is not valid for this selection.', tone: 'warning' });
    return;
  }
  state.dispatch(patches, {
    undoLabel: 'move',
    toast: { message: `Moved ${ids.length === 1 ? '1 task' : `${ids.length} tasks`}`, tone: 'info', actionLabel: 'Undo', action: () => app().undo() },
  });
}

export function reorderTask(id: string, beforeId: string | null, afterId: string | null, scope: 'structural' | 'today'): void {
  const state = app();
  state.dispatch(commands.reorderTask(state.db, state.ctx(), id, { beforeId, afterId }, scope), { undoLabel: 'reorder' });
}

/* ------------------------------------------------------------- checklist */

export function addChecklistLines(taskId: string, lines: string[]): void {
  const state = app();
  state.dispatch(commands.appendChecklist(state.db, state.ctx(), taskId, lines), { undoLabel: 'checklist' });
}

export function updateChecklistItem(id: string, fields: { text?: string; checked?: boolean }): void {
  const state = app();
  state.dispatch(commands.updateChecklistItem(state.db, state.ctx(), id, fields), { undoLabel: 'checklist' });
}

export function deleteChecklistItem(id: string): void {
  const state = app();
  state.dispatch(commands.deleteChecklistItem(state.db, state.ctx(), id), { undoLabel: 'checklist' });
}

export function reorderChecklistItem(id: string, beforeId: string | null, afterId: string | null): void {
  const state = app();
  state.dispatch(commands.reorderChecklistItem(state.db, state.ctx(), id, { beforeId, afterId }), { undoLabel: 'checklist' });
}

/* ------------------------------------------------------------------ tags */

export function toggleTag(targetType: 'task' | 'project' | 'area', targetId: string, tagId: string, next: boolean): void {
  const state = app();
  const ctx = state.ctx();
  state.dispatch(
    next ? commands.assignTag(state.db, ctx, tagId, targetType, targetId) : commands.unassignTag(state.db, ctx, tagId, targetType, targetId),
    { undoLabel: 'tag' },
  );
}

export function createAndAssignTag(targetType: 'task' | 'project' | 'area', targetId: string, name: string): void {
  const state = app();
  const ctx = state.ctx();
  const created = commands.createTag(state.db, ctx, name);
  const patches = [...created.patches];
  const withTag = created.patches.length > 0
    ? { ...state.db, tags: { ...state.db.tags, [created.id]: { id: created.id } as never } }
    : state.db;
  patches.push(...commands.assignTag(withTag, ctx, created.id, targetType, targetId));
  state.dispatch(patches, { undoLabel: 'tag' });
}

export function inheritedTagsOf(taskId: string): { tagId: string; from: string }[] {
  const state = app();
  const effective = effectiveTaskTags(state.db, state.indexes().tagIndex, taskId);
  return [...effective.inherited.entries()].map(([tagId, origin]) => ({
    tagId,
    from:
      origin.type === 'project'
        ? state.db.projects[origin.id]?.title ?? 'project'
        : state.db.areas[origin.id]?.title ?? 'area',
  }));
}

export function directTagsOf(taskId: string): string[] {
  const state = app();
  return [...effectiveTaskTags(state.db, state.indexes().tagIndex, taskId).direct];
}

/* -------------------------------------------------- projects, headings, areas */

export function createProject(title: string, areaId: string | null): string {
  const state = app();
  const result = commands.createProject(state.db, state.ctx(), { title, areaId });
  state.dispatch(result.patches, { undoLabel: 'new project' });
  return result.id;
}

export function createArea(title: string): string {
  const state = app();
  const result = commands.createArea(state.db, state.ctx(), title);
  state.dispatch(result.patches, { undoLabel: 'new area' });
  return result.id;
}

export function createHeading(projectId: string, title: string): string {
  const state = app();
  const result = commands.createHeading(state.db, state.ctx(), projectId, title);
  state.dispatch(result.patches, { undoLabel: 'new heading' });
  return result.id;
}

export function renameHeading(id: string, title: string): void {
  const state = app();
  state.dispatch([{ table: 'headings', id, patch: { title, updatedAt: state.ctx().now } }], { undoLabel: 'rename heading' });
}

export function archiveHeading(id: string): void {
  const state = app();
  const result = commands.archiveHeading(state.db, state.ctx(), id);
  if (result.blocked) {
    state.pushToast({ message: 'Finish or cancel every task under this heading before archiving it.', tone: 'warning' });
    return;
  }
  state.dispatch(result.patches, { undoLabel: 'archive heading' });
}

export function deleteHeading(id: string, deleteChildren: boolean): void {
  const state = app();
  state.dispatch(commands.deleteHeading(state.db, state.ctx(), id, deleteChildren), { undoLabel: 'delete heading' });
}

export function moveHeadingTo(headingId: string, projectId: string): void {
  const state = app();
  state.dispatch(commands.moveHeading(state.db, state.ctx(), headingId, projectId), { undoLabel: 'move heading' });
}

export function updateProject(id: string, fields: Parameters<typeof commands.updateProject>[3]): void {
  const state = app();
  state.dispatch(commands.updateProject(state.db, state.ctx(), id, fields), { undoLabel: 'edit project' });
}

export function setProjectWhen(id: string, value: WhenValue): void {
  const state = app();
  state.dispatch(commands.setProjectWhen(state.db, state.ctx(), id, {
    planning: value.planning, startDate: value.startDate, evening: false,
  }), { undoLabel: 'schedule project' });
}

export function setProjectStatus(id: string, status: LifecycleStatus, resolveOpenAs: 'completed' | 'canceled' | null): void {
  const state = app();
  state.dispatch(commands.setProjectStatus(state.db, state.ctx(), id, status, resolveOpenAs), { undoLabel: 'project status' });
}

export function deleteProject(id: string): void {
  const state = app();
  state.dispatch(commands.deleteProject(state.db, state.ctx(), id), {
    undoLabel: 'delete project',
    toast: { message: 'Project moved to Trash', tone: 'info', actionLabel: 'Undo', action: () => app().undo() },
  });
}

export function deleteArea(id: string, mode: 'moveContentsOut' | 'deleteContents'): void {
  const state = app();
  state.dispatch(commands.deleteArea(state.db, state.ctx(), id, mode), {
    undoLabel: 'delete area',
    toast: { message: 'Area deleted', tone: 'info', actionLabel: 'Undo', action: () => app().undo() },
  });
}

export function renameArea(id: string, title: string): void {
  const state = app();
  state.dispatch(commands.updateArea(state.db, state.ctx(), id, { title }), { undoLabel: 'rename area' });
}

/* -------------------------------------------------------------- reminders */

export function snoozeReminder(reminderId: string, minutes: 10 | 30 | 60): void {
  const state = app();
  state.dispatch(commands.snoozeReminder(state.db, state.ctx(), reminderId, minutes), { undoLabel: 'snooze' });
}

export function updateSettings(fields: Partial<import('@/core/types').Settings>): void {
  const state = app();
  state.dispatch([{ table: 'settings', id: 'settings', patch: { ...fields, updatedAt: state.ctx().now } }]);
}

/* ------------------------------------------------- duplicate and promote */

export function duplicate(
  kind: 'task' | 'heading' | 'project', id: string, options: DuplicateOptions,
): string | null {
  const state = app();
  const ctx = state.ctx();
  const result =
    kind === 'task' ? duplicateTask(state.db, ctx, id, options)
    : kind === 'heading' ? duplicateHeading(state.db, ctx, id, options)
    : duplicateProject(state.db, ctx, id, options);

  if (result.patches.length === 0) return null;
  state.dispatch(result.patches, {
    undoLabel: 'duplicate',
    toast: { message: `Duplicated ${kind}`, tone: 'info', actionLabel: 'Undo', action: () => app().undo() },
  });
  return result.id;
}

/** Promotes a task or heading into a project of its own; Undo reverses it exactly (R10). */
export function promoteToProject(kind: 'task' | 'heading', id: string): string | null {
  const state = app();
  const ctx = state.ctx();
  const result = kind === 'task' ? taskToProject(state.db, ctx, id) : headingToProject(state.db, ctx, id);
  if (result.patches.length === 0) return null;
  state.dispatch(result.patches, {
    undoLabel: 'convert to project',
    toast: { message: 'Converted to a project', tone: 'info', actionLabel: 'Undo', action: () => app().undo() },
  });
  return result.id;
}
