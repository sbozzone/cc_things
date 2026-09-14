import { describe, expect, it } from 'vitest';
import { createArea, createProject, createTask, setTaskStatus, setWhen } from '../commands';
import { resolveSectionDate } from '../quick-add';
import { evaluateSmartList } from '../smart-lists';
import { taskSuggestions } from '../suggestions';
import { Harness } from '../testing';

describe('My Day suggestions', () => {
  it('creates a Today quick-add as a processed, explicit daily selection', () => {
    const h = new Harness();
    const id = h.run(createTask(h.db, h.ctx(), {
      title: 'Plan the day',
      target: { parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime', myDay: true },
    })).id;
    expect(h.db.tasks[id]).toMatchObject({ isInToday: true, processed: true, startDate: null });
  });

  it('ranks due today, overdue and recent Inbox tasks while excluding selected work', () => {
    const h = new Harness();
    const target = { parentType: 'inbox' as const, parentId: null, headingId: null };
    const due = h.run(createTask(h.db, h.ctx(), { title: 'Due today', target, deadline: h.today })).id;
    const overdue = h.run(createTask(h.db, h.ctx(), { title: 'Overdue', target, deadline: '2026-09-07' })).id;
    const recent = h.run(createTask(h.db, h.ctx(), { title: 'Recent inbox', target })).id;
    h.apply([{ table: 'tasks', id: due, patch: { isInToday: true } }]);

    const rows = taskSuggestions(h.db, h.today, 5, h.ctx().now);
    expect(rows.map((row) => row.task.id)).toEqual([overdue, recent]);
    expect(rows.map((row) => row.reason)).toEqual(['overdue', 'recentInbox']);
  });

  it('detects a repeated weekday title after enough matching completions', () => {
    const h = new Harness('2026-09-01T12:00:00Z');
    const target = { parentType: 'inbox' as const, parentId: null, headingId: null };
    for (const date of ['2026-08-18T12:00:00Z', '2026-08-25T12:00:00Z']) {
      h.setInstant(date);
      const id = h.run(createTask(h.db, h.ctx(), { title: 'Review books', target })).id;
      h.apply(setTaskStatus(h.db, h.ctx(), id, 'completed'));
    }
    h.setInstant('2026-09-01T12:00:00Z');
    const id = h.run(createTask(h.db, h.ctx(), { title: 'Review books', target })).id;
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'anytime' }));

    expect(taskSuggestions(h.db, h.today, 5, h.ctx().now)[0]).toMatchObject({ task: { id }, reason: 'habitual' });
  });
});

describe('Smart List evaluator', () => {
  it('composes priority and area predicates without view dependencies', () => {
    const h = new Harness();
    const areaId = h.run(createArea(h.db, h.ctx(), 'Shopping')).id;
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Groceries', areaId })).id;
    const urgent = h.run(createTask(h.db, h.ctx(), { title: 'Milk', target: { parentType: 'project', parentId: projectId, headingId: null } })).id;
    const elsewhere = h.run(createTask(h.db, h.ctx(), { title: 'Call bank', target: { parentType: 'inbox', parentId: null, headingId: null } })).id;
    h.apply([{ table: 'tasks', id: urgent, patch: { priority: 'urgent' } }, { table: 'tasks', id: elsewhere, patch: { priority: 'urgent' } }]);

    const result = evaluateSmartList(h.db, h.today, {
      predicate: { kind: 'and', rules: [
        { kind: 'priority', value: ['urgent'] }, { kind: 'area', areaId },
      ] },
      sort: 'priority',
    });
    expect(result.map((task) => task.id)).toEqual([urgent]);
  });
});

describe('Upcoming quick-add date resolution', () => {
  it('uses the concrete section date first and can resolve a readable section label', () => {
    expect(resolveSectionDate('2026-09-17', 'Thursday', '2026-09-08')).toBe('2026-09-17');
    expect(resolveSectionDate(null, 'Tomorrow', '2026-09-08')).toBe('2026-09-09');
    expect(resolveSectionDate(null, 'not a date', '2026-09-08')).toBeNull();
  });
});
