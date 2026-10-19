import { describe, expect, it } from 'vitest';
import { createArea, createProject, createTask } from '../commands';
import { Harness } from '../testing';
import { buildIndexes, runView } from '../selectors';
import { taskHasArea, withoutAreaDocument } from '../area-filter';

describe('No area filter', () => {
  it('includes unfiled and inbox tasks and inherits area assignment from projects', () => {
    const h = new Harness();
    const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Kitchen', areaId })).id;
    const unfiledProjectId = h.run(createProject(h.db, h.ctx(), { title: 'Ideas' })).id;
    const add = (title: string, parentType: 'inbox' | 'area' | 'project', parentId: string | null) =>
      h.run(createTask(h.db, h.ctx(), { title, target: { parentType, parentId, headingId: null } })).id;
    const inbox = add('Inbox task', 'inbox', null);
    const direct = add('Area task', 'area', areaId);
    const inherited = add('Project task', 'project', projectId);
    const unfiled = add('Unfiled project task', 'project', unfiledProjectId);
    expect(taskHasArea(h.db, h.db.tasks[direct]!)).toBe(true);
    expect(taskHasArea(h.db, h.db.tasks[inherited]!)).toBe(true);
    const source = runView(h.db, buildIndexes(h.db, h.today), 'allTasks');
    const filtered = withoutAreaDocument(h.db, source);
    expect(filtered.sections.flatMap((section) => section.items.map((item) => item.id)).sort()).toEqual([inbox, unfiled].sort());
    expect(filtered.openCount).toBe(2);
    expect(source.openCount).toBe(4);
    h.db.areas[areaId]!.deletedAt = h.ctx().now;
    expect(taskHasArea(h.db, h.db.tasks[inherited]!)).toBe(false);
  });
});
