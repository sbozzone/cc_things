import { describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import {
  assignTag, createArea, createHeading, createProject, createTag, createTask,
  setDeadline, setTaskStatus, setWhen, updateChecklistItem,
} from '../commands';
import { byRank } from '../rank';
import { applyPatches, inverseOf } from '../patches';
import {
  duplicateHeading, duplicateProject, duplicateTask, headingToProject, taskToProject,
} from '../duplicate';

function seeded() {
  const h = new Harness();
  const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
  const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Cabinets', areaId, notes: 'Measure twice' })).id;
  const headingId = h.run(createHeading(h.db, h.ctx(), projectId, 'Preparation')).id;
  const tagId = h.run(createTag(h.db, h.ctx(), 'errand')).id;
  const { id: taskId } = h.run(createTask(h.db, h.ctx(), {
    title: 'Order drawer slides',
    notes: 'Soft-close please',
    target: { parentType: 'project', parentId: projectId, headingId },
    checklist: ['Measure the runners', 'Compare prices'],
  }));
  h.apply(assignTag(h.db, h.ctx(), tagId, 'task', taskId));
  h.apply(setWhen(h.db, h.ctx(), taskId, { planning: 'scheduled', startDate: '2026-09-12' }));
  h.apply(setDeadline(h.db, h.ctx(), taskId, '2026-09-20'));
  return { h, areaId, projectId, headingId, taskId, tagId };
}

const liveTasks = (h: Harness) => Object.values(h.db.tasks).filter((t) => t.deletedAt === null);

describe('duplicate (R10)', () => {
  it('copies a task with fresh ids and leaves the original unchanged', () => {
    const { h, taskId } = seeded();
    const before = JSON.stringify(h.db.tasks[taskId]);
    const { id } = h.run(duplicateTask(h.db, h.ctx(), taskId));

    expect(id).not.toBe(taskId);
    expect(JSON.stringify(h.db.tasks[taskId])).toBe(before);

    const copy = h.db.tasks[id as string]!;
    expect(copy.title).toBe('Order drawer slides');
    expect(copy.notes).toBe('Soft-close please');
    expect(copy.parentId).toBe(h.db.tasks[taskId]?.parentId);
    expect(copy.headingId).toBe(h.db.tasks[taskId]?.headingId);

    // Checklist text and tags come across on fresh records.
    const rows = Object.values(h.db.checklistItems).filter((c) => c.taskId === id).sort(byRank);
    expect(rows.map((r) => r.text)).toEqual(['Measure the runners', 'Compare prices']);
    expect(rows.every((r) => r.id !== undefined)).toBe(true);
    expect(Object.values(h.db.tagAssignments).filter((a) => a.targetId === id && a.deletedAt === null)).toHaveLength(1);
  });

  it('offers the choice to keep or clear dates', () => {
    const { h, taskId } = seeded();
    const kept = h.run(duplicateTask(h.db, h.ctx(), taskId, { keepDates: true, resetCompletion: true }));
    expect(h.db.tasks[kept.id as string]?.startDate).toBe('2026-09-12');
    expect(h.db.tasks[kept.id as string]?.deadline).toBe('2026-09-20');

    const cleared = h.run(duplicateTask(h.db, h.ctx(), taskId, { keepDates: false, resetCompletion: true }));
    expect(h.db.tasks[cleared.id as string]?.startDate).toBeNull();
    expect(h.db.tasks[cleared.id as string]?.deadline).toBeNull();
    expect(h.db.tasks[cleared.id as string]?.planning).toBe('anytime');
  });

  it('offers the choice to reset completion', () => {
    const { h, taskId } = seeded();
    const rows = Object.values(h.db.checklistItems).filter((c) => c.taskId === taskId).sort(byRank);
    h.apply(updateChecklistItem(h.db, h.ctx(), rows[0]!.id, { checked: true }));
    h.apply(setTaskStatus(h.db, h.ctx(), taskId, 'completed'));

    const reset = h.run(duplicateTask(h.db, h.ctx(), taskId, { keepDates: true, resetCompletion: true }));
    expect(h.db.tasks[reset.id as string]?.status).toBe('open');
    expect(Object.values(h.db.checklistItems).filter((c) => c.taskId === reset.id).every((c) => !c.checked)).toBe(true);

    const preserved = h.run(duplicateTask(h.db, h.ctx(), taskId, { keepDates: true, resetCompletion: false }));
    expect(h.db.tasks[preserved.id as string]?.status).toBe('completed');
    expect(Object.values(h.db.checklistItems).filter((c) => c.taskId === preserved.id).some((c) => c.checked)).toBe(true);
  });

  it('places the copy directly after the original', () => {
    const { h, projectId, headingId, taskId } = seeded();
    h.run(createTask(h.db, h.ctx(), { title: 'Later task', target: { parentType: 'project', parentId: projectId, headingId } }));
    const { id } = h.run(duplicateTask(h.db, h.ctx(), taskId));

    const order = Object.values(h.db.tasks)
      .filter((t) => t.headingId === headingId && t.deletedAt === null)
      .sort(byRank)
      .map((t) => t.id);
    expect(order).toEqual([taskId, id, order[2]]);
  });

  it('copies a heading with its tasks in order', () => {
    const { h, projectId, headingId } = seeded();
    h.run(createTask(h.db, h.ctx(), { title: 'Second', target: { parentType: 'project', parentId: projectId, headingId } }));
    const { id } = h.run(duplicateHeading(h.db, h.ctx(), headingId));

    const copied = Object.values(h.db.tasks).filter((t) => t.headingId === id && t.deletedAt === null).sort(byRank);
    expect(copied.map((t) => t.title)).toEqual(['Order drawer slides', 'Second']);
    expect(h.db.headings[id as string]?.title).toBe('Preparation');
    // The original heading still has its own tasks.
    expect(Object.values(h.db.tasks).filter((t) => t.headingId === headingId && t.deletedAt === null)).toHaveLength(2);
  });

  it('copies a project with its headings, tasks and checklists', () => {
    const { h, projectId, headingId } = seeded();
    const { id } = h.run(duplicateProject(h.db, h.ctx(), projectId));

    expect(id).not.toBe(projectId);
    const copy = h.db.projects[id as string]!;
    expect(copy.title).toBe('Cabinets');
    expect(copy.notes).toBe('Measure twice');

    const copiedHeadings = Object.values(h.db.headings).filter((x) => x.projectId === id && x.deletedAt === null);
    expect(copiedHeadings).toHaveLength(1);
    expect(copiedHeadings[0]?.id).not.toBe(headingId);

    const copiedTasks = Object.values(h.db.tasks).filter((t) => t.parentId === id && t.deletedAt === null);
    expect(copiedTasks).toHaveLength(1);
    // The copied task hangs off the copied heading, not the original one.
    expect(copiedTasks[0]?.headingId).toBe(copiedHeadings[0]?.id);
    expect(Object.values(h.db.checklistItems).filter((c) => c.taskId === copiedTasks[0]?.id)).toHaveLength(2);
  });
});

describe('promote (R10)', () => {
  it('turns a task into a project, with checklist rows as child tasks', () => {
    const { h, taskId, areaId } = seeded();
    const { id } = h.run(taskToProject(h.db, h.ctx(), taskId));

    const project = h.db.projects[id as string]!;
    expect(project.title).toBe('Order drawer slides');
    expect(project.areaId).toBe(areaId);
    expect(project.startDate).toBe('2026-09-12');
    expect(project.deadline).toBe('2026-09-20');
    // Tags move to the project.
    expect(Object.values(h.db.tagAssignments).some((a) => a.targetType === 'project' && a.targetId === id && a.deletedAt === null)).toBe(true);

    const children = Object.values(h.db.tasks).filter((t) => t.parentId === id && t.deletedAt === null).sort(byRank);
    expect(children.map((t) => t.title)).toEqual(['Measure the runners', 'Compare prices']);
    // The original task is gone, not left behind as a duplicate.
    expect(h.db.tasks[taskId]?.deletedAt).not.toBeNull();
  });

  it('turns a heading into a project, keeping its tasks', () => {
    const { h, projectId, headingId, taskId } = seeded();
    h.run(createTask(h.db, h.ctx(), { title: 'Second', target: { parentType: 'project', parentId: projectId, headingId } }));
    const { id } = h.run(headingToProject(h.db, h.ctx(), headingId));

    expect(h.db.projects[id as string]?.title).toBe('Preparation');
    const moved = Object.values(h.db.tasks).filter((t) => t.parentId === id && t.deletedAt === null).sort(byRank);
    expect(moved.map((t) => t.title)).toEqual(['Order drawer slides', 'Second']);
    // The tasks kept their identity, so notes and dates came with them.
    expect(moved[0]?.id).toBe(taskId);
    expect(moved[0]?.notes).toBe('Soft-close please');
    expect(moved[0]?.deadline).toBe('2026-09-20');
    expect(h.db.headings[headingId]?.deletedAt).not.toBeNull();
  });

  it('is reversible through Undo', () => {
    const { h, taskId } = seeded();
    const snapshot = JSON.stringify({ tasks: h.db.tasks, checklist: h.db.checklistItems });
    const countBefore = liveTasks(h).length;

    const result = taskToProject(h.db, h.ctx(), taskId);
    const inverse = inverseOf(h.db, result.patches);
    h.apply(result.patches);
    expect(liveTasks(h).length).not.toBe(countBefore);

    h.db = applyPatches(h.db, inverse);
    expect(JSON.stringify({ tasks: h.db.tasks, checklist: h.db.checklistItems })).toBe(snapshot);
    expect(Object.keys(h.db.projects)).toHaveLength(1);
  });
});
