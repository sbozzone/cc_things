import { describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import { createArea, createProject, createTask, createTag, createHeading, setTaskStatus, deleteTask } from '../commands';
import { search } from '../search';

function seeded() {
  const h = new Harness();
  const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
  const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Cabinets', areaId })).id;
  h.run(createHeading(h.db, h.ctx(), projectId, 'Preparation'));
  h.run(createTag(h.db, h.ctx(), 'errand'));
  h.run(createTask(h.db, h.ctx(), {
    title: 'Order drawer slides',
    notes: 'Ask about the soft-close hinges',
    target: { parentType: 'project', parentId: projectId, headingId: null },
    checklist: ['Measure the runners', 'Compare prices'],
  }));
  const { id: doneId } = h.run(createTask(h.db, h.ctx(), {
    title: 'Old finished errand', target: { parentType: 'inbox', parentId: null, headingId: null },
  }));
  h.apply(setTaskStatus(h.db, h.ctx(), doneId, 'completed'));
  const { id: trashedId } = h.run(createTask(h.db, h.ctx(), {
    title: 'Deleted drawer thing', target: { parentType: 'inbox', parentId: null, headingId: null },
  }));
  h.apply(deleteTask(h.db, h.ctx(), trashedId));
  return h;
}

describe('search (R23)', () => {
  it('matches titles and names across every kind', () => {
    const h = seeded();
    expect(search(h.db, 'cabinets').some((r) => r.kind === 'project')).toBe(true);
    expect(search(h.db, 'home').some((r) => r.kind === 'area')).toBe(true);
    expect(search(h.db, 'errand').some((r) => r.kind === 'tag')).toBe(true);
    expect(search(h.db, 'preparation').some((r) => r.kind === 'heading')).toBe(true);
    expect(search(h.db, 'drawer').some((r) => r.kind === 'task')).toBe(true);
  });

  it('finds the built-in and special lists by name', () => {
    const h = seeded();
    for (const name of ['Tomorrow', 'Deadlines', 'Repeating', 'All Projects', 'Logged Projects', 'Upcoming']) {
      expect(search(h.db, name).some((r) => r.kind === 'view')).toBe(true);
    }
  });

  it('returns a checklist match only in the extended scope, and opens the task', () => {
    const h = seeded();
    expect(search(h.db, 'runners')).toHaveLength(0);

    const extended = search(h.db, 'runners', { searchAll: true });
    expect(extended).toHaveLength(1);
    expect(extended[0]?.kind).toBe('task');
    expect(extended[0]?.detail).toContain('Measure the runners');
    // Opening the result puts the task in context rather than in a detached list.
    expect(extended[0]?.target.view).toContain('project:');
    expect(extended[0]?.target.openId).toBeDefined();
  });

  it('reaches notes and the Logbook only with Search All', () => {
    const h = seeded();
    expect(search(h.db, 'hinges')).toHaveLength(0);
    expect(search(h.db, 'hinges', { searchAll: true })).toHaveLength(1);

    expect(search(h.db, 'finished').some((r) => r.logged)).toBe(false);
    expect(search(h.db, 'finished', { searchAll: true }).some((r) => r.logged)).toBe(true);
  });

  it('excludes Trash unless it is explicitly chosen', () => {
    const h = seeded();
    const withoutTrash = search(h.db, 'Deleted drawer thing');
    expect(withoutTrash).toHaveLength(0);

    const withTrash = search(h.db, 'Deleted drawer thing', { includeTrash: true });
    expect(withTrash).toHaveLength(1);
    expect(withTrash[0]?.target.view).toBe('trash');
  });

  it('ranks an exact prefix above a mid-word match', () => {
    const h = seeded();
    const results = search(h.db, 'order');
    expect(results[0]?.title).toBe('Order drawer slides');
  });
});
