import { describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import { createProject, createTask, setTaskStatus } from '../commands';
import { buildIndexes, runView, withCompletedTasks } from '../selectors';

describe('optional completed task history', () => {
  it('adds matching completed tasks without changing open counts or including canceled/deleted tasks', () => {
    const h = new Harness();
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Home' })).id;
    const add = (title: string, project = false) => h.run(createTask(h.db, h.ctx(), { title, target: {
      parentType: project ? 'project' : 'inbox', parentId: project ? projectId : null, headingId: null,
    } })).id;
    add('Open');
    const completed = add('Finished');
    const projectTask = add('Finished project step', true);
    const canceled = add('Canceled');
    const deleted = add('Deleted');
    for (const id of [completed, projectTask, deleted]) h.apply(setTaskStatus(h.db, h.ctx(), id, 'completed'));
    h.apply(setTaskStatus(h.db, h.ctx(), canceled, 'canceled'));
    h.db.tasks[deleted]!.deletedAt = h.ctx().now;
    const ix = buildIndexes(h.db, h.today);
    const source = runView(h.db, ix, 'allTasks');
    expect(source.sections.flatMap((section) => section.items)).toHaveLength(1);
    const result = withCompletedTasks(h.db, ix, source);
    expect(result.openCount).toBe(1);
    expect(result.sections.at(-1)!.items.map((item) => item.id).sort()).toEqual([completed, projectTask].sort());
    const projectDoc = withCompletedTasks(h.db, ix, runView(h.db, ix, `project:${projectId}`));
    expect(projectDoc.sections.at(-1)!.items.map((item) => item.id)).toEqual([projectTask]);
  });

  it('shows only current-day completions in My Day', () => {
    const h = new Harness();
    const id = h.run(createTask(h.db, h.ctx(), { title: 'Today task', target: {
      parentType: 'inbox', parentId: null, headingId: null, myDay: true,
    } })).id;
    h.apply(setTaskStatus(h.db, h.ctx(), id, 'completed'));
    let ix = buildIndexes(h.db, h.today);
    expect(withCompletedTasks(h.db, ix, runView(h.db, ix, 'today')).sections.some((section) => section.id === 'completed-tasks')).toBe(true);
    h.advanceDays(1);
    ix = buildIndexes(h.db, h.today);
    expect(withCompletedTasks(h.db, ix, runView(h.db, ix, 'today')).sections.some((section) => section.id === 'completed-tasks')).toBe(false);
  });
});
