import { describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import { appendChecklist, checklistItemToTask, createProject, createTag, createTask, assignTag } from '../commands';
import { inverseOf } from '../patches';

function setup(checked = false) {
  const h = new Harness();
  const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Renovation' })).id;
  const parentId = h.run(createTask(h.db, h.ctx(), { title: 'Prepare room', target: {
    parentType: 'project', parentId: projectId, headingId: null, myDay: true,
  } })).id;
  h.db.tasks[parentId]!.priority = 'high';
  const tagId = h.run(createTag(h.db, h.ctx(), 'Home')).id;
  h.apply(assignTag(h.db, h.ctx(), tagId, 'task', parentId));
  h.apply(appendChecklist(h.db, h.ctx(), parentId, ['buy primer']));
  const row = Object.values(h.db.checklistItems)[0]!;
  row.checked = checked;
  return { h, parentId, row, tagId };
}

describe('promote checklist item', () => {
  it('moves the row into its own task with context and supports exact Undo', () => {
    const { h, parentId, row, tagId } = setup();
    const before = h.db;
    const result = checklistItemToTask(h.db, h.ctx(), row.id);
    const undo = inverseOf(h.db, result.patches);
    h.apply(result.patches);
    const task = h.db.tasks[result.id!]!;
    expect(task).toMatchObject({ title: 'buy primer', status: 'open', priority: 'high', isInToday: true,
      parentType: 'project', parentId: h.db.tasks[parentId]!.parentId, deadline: h.today });
    expect(h.db.tasks[parentId]).toEqual(before.tasks[parentId]);
    expect(h.db.checklistItems[row.id]!.deletedAt).toBe(h.ctx().now);
    expect(Object.values(h.db.tagAssignments).some((tag) => tag.targetId === task.id && tag.tagId === tagId)).toBe(true);
    expect(checklistItemToTask(h.db, h.ctx(), row.id).patches).toEqual([]);
    h.apply(undo);
    expect(h.db).toEqual(before);
  });

  it('preserves checked status rather than reopening a completed step', () => {
    const { h, row } = setup(true);
    const result = checklistItemToTask(h.db, h.ctx(), row.id);
    h.apply(result.patches);
    expect(h.db.tasks[result.id!]!).toMatchObject({ status: 'completed', completedAt: h.ctx().now });
  });
});
