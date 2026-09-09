import { beforeEach, describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import {
  createArea, createHeading, createProject, createTask, deleteProject, moveHeading,
  moveTasks, reorderTask, restoreProject, setDeadline, setProjectStatus, setProjectWhen,
  setTaskStatus, setWhen, assignTag, createTag, restoreTask,
} from '../commands';
import { buildIndexes, runView, sidebarCounts } from '../selectors';
import { holdOf, projectProgress } from '../membership';
import { projectOf } from '../selectors';

function view(h: Harness, key: Parameters<typeof runView>[2]) {
  const ix = buildIndexes(h.db, h.today);
  return runView(h.db, ix, key);
}
function titlesIn(h: Harness, key: Parameters<typeof runView>[2], sectionId?: string): string[] {
  const doc = view(h, key);
  return doc.sections
    .filter((s) => (sectionId ? s.id === sectionId : true))
    .flatMap((s) => s.items.map((i) => (i.kind === 'task' ? i.task.title : i.kind === 'project' ? i.project.title : '')));
}

describe('Inbox and processing (R11)', () => {
  it('holds unprocessed capture and releases it once filed', () => {
    const h = new Harness();
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Order drawer slides', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    expect(titlesIn(h, 'inbox')).toEqual(['Order drawer slides']);
    expect(titlesIn(h, 'anytime')).toEqual([]);

    const { id: projectId } = h.run(createProject(h.db, h.ctx(), { title: 'Cabinets' }));
    h.apply(moveTasks(h.db, h.ctx(), [id], { parentType: 'project', parentId: projectId, headingId: null }));
    expect(titlesIn(h, 'inbox')).toEqual([]);
    expect(titlesIn(h, 'anytime')).toEqual(['Order drawer slides']);
  });

  it('does not treat a note or a tag as processing', () => {
    const h = new Harness();
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Think', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    const { id: tagId } = h.run(createTag(h.db, h.ctx(), 'idea'));
    h.apply(assignTag(h.db, h.ctx(), tagId, 'task', id));
    h.apply([{ table: 'tasks', id, patch: { notes: 'a thought' } }]);
    expect(titlesIn(h, 'inbox')).toEqual(['Think']);
  });
});

describe('One record, many views (R11)', () => {
  it('completes a task everywhere at once', () => {
    const h = new Harness();
    const { id: projectId } = h.run(createProject(h.db, h.ctx(), { title: 'Kitchen' }));
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Measure', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: h.today }));

    expect(titlesIn(h, 'today')).toContain('Measure');
    expect(titlesIn(h, 'anytime')).toContain('Measure');
    expect(titlesIn(h, `project:${projectId}`)).toContain('Measure');

    h.apply(setTaskStatus(h.db, h.ctx(), id, 'completed'));
    expect(titlesIn(h, 'today')).not.toContain('Measure');
    expect(titlesIn(h, 'anytime')).not.toContain('Measure');
    expect(titlesIn(h, 'logbook')).toContain('Measure');
  });
});

describe('Today rollover (R13, scenario A04)', () => {
  it('keeps an unfinished evening task in Today and moves it out of the evening group', () => {
    const h = new Harness('2026-09-08T20:00:00Z');
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Water plants', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: h.today, evening: true }));
    expect(titlesIn(h, 'today', 'evening')).toEqual(['Water plants']);

    h.advanceDays(1); // crosses midnight, as after an overnight restart
    expect(titlesIn(h, 'today')).toContain('Water plants');
    expect(titlesIn(h, 'today', 'evening')).toEqual([]);
    expect(h.db.tasks[id]?.startDate).toBe('2026-09-08'); // original start date retained
  });
});

describe('Start dates and deadlines are independent (R15, scenario A03)', () => {
  it('moves a start without touching the deadline', () => {
    const h = new Harness();
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'File taxes', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: '2026-09-10' }));
    h.apply(setDeadline(h.db, h.ctx(), id, '2026-09-15'));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: '2026-09-11' }));

    expect(h.db.tasks[id]?.startDate).toBe('2026-09-11');
    expect(h.db.tasks[id]?.deadline).toBe('2026-09-15');
  });

  it('clearing When returns the task to Anytime and keeps the deadline', () => {
    const h = new Harness();
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Renew passport', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: '2026-09-20' }));
    h.apply(setDeadline(h.db, h.ctx(), id, '2026-09-30'));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'anytime' }));

    expect(h.db.tasks[id]?.startDate).toBeNull();
    expect(h.db.tasks[id]?.deadline).toBe('2026-09-30');
    expect(titlesIn(h, 'anytime')).toContain('Renew passport');
  });

  it('keeps a future-start task out of Anytime until it is available', () => {
    const h = new Harness();
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Book flights', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: '2026-09-20' }));
    expect(titlesIn(h, 'anytime')).not.toContain('Book flights');
    expect(titlesIn(h, 'upcoming')).toEqual(expect.arrayContaining([]));

    h.setInstant('2026-09-20T09:00:00Z');
    expect(titlesIn(h, 'anytime')).toContain('Book flights');
    expect(titlesIn(h, 'today')).toContain('Book flights');
  });
});

describe('Project scheduling policy (spec §4, scenario A05)', () => {
  let h: Harness;
  let projectId: string;

  beforeEach(() => {
    h = new Harness();
    projectId = h.run(createProject(h.db, h.ctx(), { title: 'Sabbatical' })).id;
    h.apply(setProjectWhen(h.db, h.ctx(), projectId, { planning: 'someday' }));
  });

  it('holds undated children of a Someday project', () => {
    h.run(createTask(h.db, h.ctx(), { title: 'Research trains', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    expect(titlesIn(h, 'anytime')).not.toContain('Research trains');
  });

  it('lets an explicit task start date override the inherited hold', () => {
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Book time off', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.run(createTask(h.db, h.ctx(), { title: 'Undated sibling', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: '2026-09-12' }));

    // Still held while the start is in the future.
    expect(titlesIn(h, 'anytime')).not.toContain('Book time off');
    h.setInstant('2026-09-12T09:00:00Z');
    expect(titlesIn(h, 'anytime')).toContain('Book time off');
    expect(titlesIn(h, 'today')).toContain('Book time off');
    // The undated sibling stays held.
    expect(titlesIn(h, 'anytime')).not.toContain('Undated sibling');
  });

  it('lets a reached deadline override either hold and reports the held context', () => {
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Passport expires', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.apply(setDeadline(h.db, h.ctx(), id, '2026-09-08'));

    const task = h.db.tasks[id]!;
    const hold = holdOf(task, projectOf(h.db, task), h.today);
    expect(hold.hold).toBeNull();
    expect(hold.releasedByDeadline).toBe(true);
    expect(hold.inheritedFrom).toBe('project');
    expect(titlesIn(h, 'today')).toContain('Passport expires');
  });

  it('does not let a future deadline alone release a Someday hold', () => {
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Later', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.apply(setDeadline(h.db, h.ctx(), id, '2026-12-01'));
    expect(titlesIn(h, 'anytime')).not.toContain('Later');
    expect(titlesIn(h, 'someday')).toContain('Sabbatical');
  });

  it('shows a project summary in Today without dragging every child in', () => {
    const other = h.run(createProject(h.db, h.ctx(), { title: 'Deck build' })).id;
    h.apply(setProjectWhen(h.db, h.ctx(), other, { planning: 'scheduled', startDate: h.today }));
    h.run(createTask(h.db, h.ctx(), { title: 'Buy timber', target: { parentType: 'project', parentId: other, headingId: null } }));

    expect(titlesIn(h, 'today')).toContain('Deck build');
    expect(titlesIn(h, 'today')).not.toContain('Buy timber');
    expect(titlesIn(h, 'anytime')).toContain('Buy timber');
  });
});

describe('Headings (R08, scenario A02)', () => {
  it('moves a heading with all its tasks in the same relative order', () => {
    const h = new Harness();
    const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
    const from = h.run(createProject(h.db, h.ctx(), { title: 'Kitchen', areaId })).id;
    const to = h.run(createProject(h.db, h.ctx(), { title: 'Garage', areaId })).id;
    const headingId = h.run(createHeading(h.db, h.ctx(), from, 'Prep')).id;

    const names = ['one', 'two', 'three', 'four', 'five'];
    for (const title of names) {
      h.run(createTask(h.db, h.ctx(), { title, target: { parentType: 'project', parentId: from, headingId } }));
    }
    h.apply(moveHeading(h.db, h.ctx(), headingId, to));

    const moved = titlesIn(h, `project:${to}`, `heading:${headingId}`);
    expect(moved).toEqual(names);
    expect(titlesIn(h, `project:${from}`)).toEqual([]);
  });
});

describe('Project progress (R09)', () => {
  it('counts completed over non-deleted, non-canceled tasks', () => {
    const h = new Harness();
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Move house' })).id;
    const ids = ['a', 'b', 'c', 'd', 'e'].map(
      (title) => h.run(createTask(h.db, h.ctx(), { title, target: { parentType: 'project', parentId: projectId, headingId: null } })).id,
    );
    h.apply(setTaskStatus(h.db, h.ctx(), ids[0]!, 'completed'));
    h.apply(setTaskStatus(h.db, h.ctx(), ids[1]!, 'completed'));
    h.apply(setTaskStatus(h.db, h.ctx(), ids[4]!, 'canceled'));

    const tasks = Object.values(h.db.tasks).filter((t) => t.parentId === projectId);
    expect(projectProgress(tasks)).toEqual({ completed: 2, total: 4, percent: 50 });
  });

  it('reports no percentage when there is nothing to measure', () => {
    expect(projectProgress([]).percent).toBeNull();
  });

  it('resolves open tasks as an explicit batch when completing a project', () => {
    const h = new Harness();
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Tidy' })).id;
    h.run(createTask(h.db, h.ctx(), { title: 'left over', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.apply(setProjectStatus(h.db, h.ctx(), projectId, 'completed', 'canceled'));

    const child = Object.values(h.db.tasks)[0]!;
    expect(child.status).toBe('canceled');
    expect(h.db.projects[projectId]?.status).toBe('completed');
  });
});

describe('Deletion and restore (R06, scenario A09)', () => {
  it('restores a project with its child structure intact', () => {
    const h = new Harness();
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Garden' })).id;
    const headingId = h.run(createHeading(h.db, h.ctx(), projectId, 'Spring')).id;
    h.run(createTask(h.db, h.ctx(), { title: 'Prune', target: { parentType: 'project', parentId: projectId, headingId } }));

    h.apply(deleteProject(h.db, h.ctx(), projectId));
    expect(titlesIn(h, 'anytime')).toEqual([]);
    expect(view(h, 'trash').sections[0]?.items.length).toBeGreaterThan(0);

    h.apply(restoreProject(h.db, h.ctx(), projectId));
    expect(titlesIn(h, `project:${projectId}`, `heading:${headingId}`)).toEqual(['Prune']);
  });

  it('offers a new home when the original parent is gone', () => {
    const h = new Harness();
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Gone' })).id;
    const { id: taskId } = h.run(createTask(h.db, h.ctx(), { title: 'Orphan', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.apply(deleteProject(h.db, h.ctx(), projectId));

    // Restore only the task; its project stays deleted.
    h.apply(restoreTask(h.db, h.ctx(), taskId));
    expect(h.db.tasks[taskId]?.parentType).toBe('inbox');
    expect(titlesIn(h, 'inbox')).toContain('Orphan');
  });
});

describe('Counts and ordering (R12, R25)', () => {
  it('counts a task with both markers once', () => {
    const h = new Harness();
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Both', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: '2026-09-20' }));
    h.apply(setDeadline(h.db, h.ctx(), id, '2026-09-25'));

    const counts = sidebarCounts(h.db, buildIndexes(h.db, h.today));
    expect(counts.upcoming).toBe(1);
  });

  it('keeps Today order separate from structural order', () => {
    const h = new Harness();
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Errands' })).id;
    const a = h.run(createTask(h.db, h.ctx(), { title: 'A', target: { parentType: 'project', parentId: projectId, headingId: null } })).id;
    const b = h.run(createTask(h.db, h.ctx(), { title: 'B', target: { parentType: 'project', parentId: projectId, headingId: null } })).id;
    for (const id of [a, b]) h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: h.today }));

    const structuralBefore = titlesIn(h, `project:${projectId}`);
    h.apply(reorderTask(h.db, h.ctx(), a, { beforeId: b, afterId: null }, 'today'));

    expect(titlesIn(h, 'today', 'today')).toEqual(['B', 'A']);
    expect(titlesIn(h, `project:${projectId}`)).toEqual(structuralBefore);
  });
});
