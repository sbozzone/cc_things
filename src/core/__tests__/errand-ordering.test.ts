import { describe, expect, it } from 'vitest';
import { assignTag, createArea, createProject, createTask, orderItems, reorderTask, unassignTag } from '../commands';
import { duplicateTask } from '../duplicate';
import { byErrandRank } from '../errand-order';
import { ERRANDS_TAG_ID, isErrandTask } from '../errands';
import { inverseOf } from '../patches';
import { databaseFromPackage, exportDatabase, importPackage } from '../portability';
import { Harness } from '../testing';
import type { Task } from '../types';

function add(h: Harness, id: string, fields: Partial<Task> = {}): string {
  const task: Task = {
    id, ownerId: h.ownerId, title: `@ ${id}`, notes: 'Route stop', status: 'open',
    processed: true, parentType: 'inbox', parentId: null, headingId: null,
    planning: 'scheduled', startDate: h.today, eveningDate: null, deadline: h.today,
    isInToday: true, rank: 'V', todayRank: 'k', completedAt: null, canceledAt: null,
    createdAt: h.ctx().now, updatedAt: h.ctx().now, deletedAt: null, ...fields,
  };
  h.apply([{ table: 'tasks', id, create: true, patch: task as unknown as Record<string, unknown> }]);
  return id;
}

function route(h: Harness): string[] {
  return Object.values(h.db.tasks)
    .filter((task) => task.ownerId === h.ownerId && task.deletedAt === null && task.status === 'open' && isErrandTask(task))
    .sort(byErrandRank).map((task) => task.id);
}

describe('independent manual errand route', () => {
  it('reorders errands across parents without changing structural, My Day, dates, or other task fields', () => {
    const h = new Harness();
    const area = h.run(createArea(h.db, h.ctx(), 'House')).id;
    const project = h.run(createProject(h.db, h.ctx(), { title: 'Shopping', areaId: area })).id;
    add(h, 'a', { parentType: 'area', parentId: area });
    add(h, 'b', { parentType: 'project', parentId: project });
    add(h, 'c');
    add(h, 'ordinary', { title: 'Clean pool' });
    const before = structuredClone(h.db);

    const patches = orderItems(h.db, h.ctx(), ['c', 'a', 'b'], 'errands');
    expect(patches.every((patch) => patch.table === 'tasks' && Object.keys(patch.patch).every((field) => ['errandRank', 'updatedAt'].includes(field)))).toBe(true);
    h.apply(patches);
    expect(route(h)).toEqual(['c', 'a', 'b']);
    expect(h.db.tasks.ordinary).toEqual(before.tasks.ordinary);
    for (const id of ['a', 'b', 'c']) {
      const { errandRank: _rank, updatedAt: _updated, ...after } = h.db.tasks[id]!;
      const { errandRank: _oldRank, updatedAt: _oldUpdated, ...original } = before.tasks[id]!;
      expect(after).toEqual(original);
    }
    expect(h.db.tagAssignments).toEqual(before.tagAssignments);
    expect(h.db.projects).toEqual(before.projects);
  });

  it('permutes a filtered/day subset in its global slots while hidden errands retain their positions', () => {
    const h = new Harness();
    for (const id of ['a', 'b', 'c', 'd', 'e']) add(h, id);
    h.apply(orderItems(h.db, h.ctx(), ['e', 'a', 'c'], 'errands'));
    expect(route(h)).toEqual(['e', 'b', 'a', 'd', 'c']);
    const ranks = Object.values(h.db.tasks).map((task) => task.errandRank);
    expect(new Set(ranks).size).toBe(5);
    expect(ranks.every((rank) => typeof rank === 'string')).toBe(true);
  });

  it('uses saved route ranks over structural fallback ranks and preserves deterministic fallback ties', () => {
    const h = new Harness();
    add(h, 'a', { errandRank: 'z' });
    add(h, 'b', { errandRank: 'G', rank: 'z' });
    add(h, 'c');
    add(h, 'd');
    expect(route(h)).toEqual(['b', 'c', 'd', 'a']);
    h.apply(orderItems(h.db, h.ctx(), ['a', 'b'], 'errands'));
    expect(route(h)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('ignores duplicate IDs, missing tasks, projects, non-errands, closed/deleted tasks, and other owners', () => {
    const h = new Harness();
    const project = h.run(createProject(h.db, h.ctx(), { title: '@ Shopping', areaId: null })).id;
    add(h, 'a'); add(h, 'b');
    add(h, 'ordinary', { title: 'Call person@example.com' });
    add(h, 'completed', { status: 'completed' });
    add(h, 'canceled', { status: 'canceled' });
    add(h, 'deleted', { deletedAt: h.ctx().now });
    add(h, 'foreign', { ownerId: 'someone-else' });
    const before = structuredClone(h.db.tasks);
    const ids = ['missing', project, 'ordinary', 'completed', 'canceled', 'deleted', 'foreign', 'b', 'b', 'a'];
    const patches = orderItems(h.db, h.ctx(), ids, 'errands');
    expect(patches.map((patch) => patch.id).sort()).toEqual(['a', 'b']);
    h.apply(patches);
    expect(route(h)).toEqual(['b', 'a']);
    for (const id of ['ordinary', 'completed', 'canceled', 'deleted', 'foreign']) expect(h.db.tasks[id]).toEqual(before[id]);
  });

  it('returns no writes for unchanged, empty, and one-item visible orders', () => {
    const h = new Harness();
    add(h, 'a'); add(h, 'b');
    for (const ids of [[], ['a'], ['a', 'a'], ['a', 'b'], ['missing']]) {
      expect(orderItems(h.db, h.ctx(), ids, 'errands')).toEqual([]);
    }
  });

  it('keeps structural and My Day ordering compatible and independent of a saved route', () => {
    const h = new Harness();
    add(h, 'a', { errandRank: 'z' }); add(h, 'b', { errandRank: 'G' });
    h.apply(orderItems(h.db, h.ctx(), ['b', 'a'], 'today'));
    expect(h.db.tasks.b!.todayRank < h.db.tasks.a!.todayRank).toBe(true);
    expect(h.db.tasks.a!.rank).toBe('V');
    h.apply(orderItems(h.db, h.ctx(), ['a', 'b'], 'structural'));
    expect(h.db.tasks.a!.rank < h.db.tasks.b!.rank).toBe(true);
    expect(h.db.tasks.a!.errandRank).toBe('z');
    expect(h.db.tasks.b!.errandRank).toBe('G');
    expect(route(h)).toEqual(['b', 'a']);
  });

  it('can safely place a route stop between adjacent neighbours or at either end', () => {
    const h = new Harness();
    for (const id of ['a', 'b', 'c', 'd']) add(h, id);
    h.apply(reorderTask(h.db, h.ctx(), 'd', { beforeId: 'a', afterId: 'b' }, 'errands'));
    expect(route(h)).toEqual(['a', 'd', 'b', 'c']);
    h.apply(reorderTask(h.db, h.ctx(), 'c', { beforeId: null, afterId: 'a' }, 'errands'));
    expect(route(h)).toEqual(['c', 'a', 'd', 'b']);
    h.apply(reorderTask(h.db, h.ctx(), 'c', { beforeId: 'b', afterId: null }, 'errands'));
    expect(route(h)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('rejects invalid, self, reversed, and non-adjacent errand neighbours, with no writes for no-op moves', () => {
    const h = new Harness();
    for (const id of ['a', 'b', 'c', 'd']) add(h, id);
    add(h, 'ordinary', { title: 'Not an errand' });
    for (const neighbours of [
      { beforeId: null, afterId: null }, { beforeId: 'd', afterId: null },
      { beforeId: 'missing', afterId: 'a' }, { beforeId: null, afterId: 'ordinary' },
      { beforeId: 'b', afterId: 'a' }, { beforeId: 'a', afterId: 'c' },
      { beforeId: 'b', afterId: 'b' }, { beforeId: 'c', afterId: null },
    ]) expect(reorderTask(h.db, h.ctx(), 'd', neighbours, 'errands')).toEqual([]);
    expect(reorderTask(h.db, h.ctx(), 'ordinary', { beforeId: null, afterId: 'a' }, 'errands')).toEqual([]);
    expect(reorderTask(h.db, h.ctx(), 'missing', { beforeId: null, afterId: 'a' }, 'errands')).toEqual([]);
  });

  it('undo restores existing ranks and removes optional route ranks created by a move', () => {
    const h = new Harness();
    add(h, 'a', { errandRank: 'G' }); add(h, 'b'); add(h, 'c');
    const before = structuredClone(h.db);
    const patches = orderItems(h.db, h.ctx(), ['c', 'b', 'a'], 'errands');
    const undo = inverseOf(h.db, patches);
    h.apply(patches); h.apply(undo);
    expect(h.db.tasks).toEqual(before.tasks);
    expect(route(h)).toEqual(['a', 'b', 'c']);
  });

  it('keeps route ranks in JSON exports and both import modes without requiring old packages to have them', () => {
    const h = new Harness();
    add(h, 'a'); add(h, 'b');
    h.apply(orderItems(h.db, h.ctx(), ['b', 'a'], 'errands'));
    const pkg = exportDatabase(h.db);
    const restored = databaseFromPackage('new-owner', pkg, h.ctx().now);
    expect(restored.tasks.a!.errandRank).toBe(h.db.tasks.a!.errandRank);
    expect(restored.tasks.b!.errandRank).toBe(h.db.tasks.b!.errandRank);
    const copy = importPackage(h.db, h.ownerId, pkg, 'copy');
    const copiedTasks = copy.patches.filter((patch) => patch.table === 'tasks');
    expect(copiedTasks.map((patch) => patch.patch.errandRank).sort()).toEqual([h.db.tasks.a!.errandRank, h.db.tasks.b!.errandRank].sort());
    add(h, 'unranked');
    expect(databaseFromPackage(h.ownerId, exportDatabase(h.db), h.ctx().now).tasks.unranked!.errandRank).toBeUndefined();
  });

  it('retains duplicate route rank without corrupting order, and a subsequent move resolves ties', () => {
    const h = new Harness();
    add(h, 'a'); add(h, 'b', { rank: 'k' });
    h.apply(orderItems(h.db, h.ctx(), ['b', 'a'], 'errands'));
    const result = h.run(duplicateTask(h.db, h.ctx(), 'b'));
    expect(result.id).not.toBeNull();
    expect(h.db.tasks[result.id!]!.errandRank).toBe(h.db.tasks.b!.errandRank);
    h.apply(orderItems(h.db, h.ctx(), ['a', result.id!, 'b'], 'errands'));
    expect(route(h)).toEqual(['a', result.id, 'b']);
    expect(new Set(Object.values(h.db.tasks).map((task) => task.errandRank)).size).toBe(3);
  });

  it('never creates persistent assignments for the virtual Errands tag, including quick-add', () => {
    const h = new Harness();
    add(h, 'a');
    expect(assignTag(h.db, h.ctx(), ERRANDS_TAG_ID, 'task', 'a')).toEqual([]);
    expect(unassignTag(h.db, h.ctx(), ERRANDS_TAG_ID, 'task', 'a')).toEqual([]);
    h.run(createTask(h.db, h.ctx(), {
      title: '@ Store', tagIds: [ERRANDS_TAG_ID],
      target: { parentType: 'inbox', parentId: null, headingId: null },
    }));
    expect(Object.values(h.db.tagAssignments)).toEqual([]);
  });

  it('normalizes a large global route without exceeding fractional-rank depth', () => {
    const h = new Harness();
    for (let i = 0; i < 2000; i++) add(h, String(i).padStart(4, '0'));
    const ids = route(h).reverse();
    h.apply(orderItems(h.db, h.ctx(), ids, 'errands'));
    expect(route(h)).toEqual(ids);
    expect(new Set(Object.values(h.db.tasks).map((task) => task.errandRank)).size).toBe(2000);
  });
});
