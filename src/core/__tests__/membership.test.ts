import { beforeEach, describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import {
  createArea, createHeading, createProject, createTask, deleteProject, moveHeading,
  moveTasks, reorderTask, restoreProject, setDeadline, setProjectStatus, setProjectWhen,
  setTaskStatus, setWhen, assignTag, createTag, restoreTask, orderItems, updateTask, updateTag, setTaskInToday,
} from '../commands';
import { buildIndexes, runView, sidebarCounts } from '../selectors';
import { sortDocument } from '../list-order';
import { dailyResetPatches } from '../my-day';
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

describe('All Projects disclosure data', () => {
  it('provides each project with its open tasks for inline expansion', () => {
    const h = new Harness();
    const { id: projectId } = h.run(createProject(h.db, h.ctx(), { title: 'Workshop' }));
    h.run(createTask(h.db, h.ctx(), {
      title: 'Open task',
      target: { parentType: 'project', parentId: projectId, headingId: null },
    }));
    const completed = h.run(createTask(h.db, h.ctx(), {
      title: 'Finished task',
      target: { parentType: 'project', parentId: projectId, headingId: null },
    })).id;
    h.apply(setTaskStatus(h.db, h.ctx(), completed, 'completed'));

    const project = view(h, 'allProjects').sections
      .flatMap((section) => section.items)
      .find((item) => item.kind === 'project' && item.project.id === projectId);

    expect(project?.kind === 'project' ? project.children?.map((child) => child.task.title) : []).toEqual(['Open task']);
  });
});

describe('One record, many views (R11)', () => {
  it('automatically shows open tasks due today in My Day, but not other deadlines', () => {
    const h = new Harness();
    const target = { parentType: 'inbox' as const, parentId: null, headingId: null };
    const dueToday = h.run(createTask(h.db, h.ctx(), { title: 'Due today', target })).id;
    const overdue = h.run(createTask(h.db, h.ctx(), { title: 'Overdue', target })).id;
    const future = h.run(createTask(h.db, h.ctx(), { title: 'Future', target })).id;
    const completedToday = h.run(createTask(h.db, h.ctx(), { title: 'Completed today', target })).id;
    h.apply(setDeadline(h.db, h.ctx(), dueToday, h.today));
    h.apply(setDeadline(h.db, h.ctx(), overdue, '2026-09-07'));
    h.apply(setDeadline(h.db, h.ctx(), future, '2026-09-09'));
    h.apply(setDeadline(h.db, h.ctx(), completedToday, h.today));
    h.apply(setTaskStatus(h.db, h.ctx(), completedToday, 'completed'));

    expect(titlesIn(h, 'today')).toContain('Due today');
    expect(titlesIn(h, 'today')).not.toContain('Overdue');
    expect(titlesIn(h, 'today')).not.toContain('Future');
    expect(titlesIn(h, 'today')).not.toContain('Completed today');
  });

  it('completes a task everywhere at once', () => {
    const h = new Harness();
    const { id: projectId } = h.run(createProject(h.db, h.ctx(), { title: 'Kitchen' }));
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Measure', target: { parentType: 'project', parentId: projectId, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: h.today }));
    h.apply(setTaskInToday(h.db, h.ctx(), id, true));

    expect(titlesIn(h, 'today')).toContain('Measure');
    expect(titlesIn(h, 'anytime')).toContain('Measure');
    expect(titlesIn(h, `project:${projectId}`)).toContain('Measure');

    h.apply(setTaskStatus(h.db, h.ctx(), id, 'completed'));
    expect(titlesIn(h, 'today')).not.toContain('Measure');
    expect(titlesIn(h, 'anytime')).not.toContain('Measure');
    expect(titlesIn(h, 'logbook')).toContain('Measure');
  });
});

describe('My Day rollover', () => {
  it('carries incomplete selections forward after a missed midnight without changing their schedule', () => {
    const h = new Harness('2026-09-08T20:00:00Z');
    const { id } = h.run(createTask(h.db, h.ctx(), { title: 'Water plants', target: { parentType: 'inbox', parentId: null, headingId: null } }));
    h.apply(setWhen(h.db, h.ctx(), id, { planning: 'scheduled', startDate: h.today, evening: true }));
    h.apply(setTaskInToday(h.db, h.ctx(), id, true));
    expect(titlesIn(h, 'today', 'evening')).toEqual(['Water plants']);

    h.advanceDays(1); // simulates opening after a missed overnight trigger
    h.apply(dailyResetPatches(h.db, h.ctx()));
    expect(titlesIn(h, 'today')).toContain('Water plants');
    expect(titlesIn(h, 'today', 'evening')).toEqual([]);
    expect(h.db.tasks[id]?.startDate).toBe('2026-09-08'); // original start date retained
    expect(h.db.tasks[id]?.isInToday).toBe(true);
    expect(h.db.settings.lastTodayResetDate).toBe(h.today);
    expect(dailyResetPatches(h.db, h.ctx())).toEqual([]);
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
    expect(titlesIn(h, 'today')).not.toContain('Book flights');
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
    expect(titlesIn(h, 'today')).not.toContain('Book time off');
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
    expect(moved).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
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
  it('starts Upcoming with tasks due today without including tasks that only start today', () => {
    const h = new Harness();
    const dueToday = h.run(createTask(h.db, h.ctx(), {
      title: 'due today',
      target: { parentType: 'inbox', parentId: null, headingId: null },
    })).id;
    const startsToday = h.run(createTask(h.db, h.ctx(), {
      title: 'starts today',
      target: { parentType: 'inbox', parentId: null, headingId: null, planning: 'scheduled', startDate: h.today },
    })).id;
    h.apply(setDeadline(h.db, h.ctx(), dueToday, h.today));

    const upcoming = runView(h.db, buildIndexes(h.db, h.today), 'upcoming');
    const todaySection = upcoming.sections.find((section) => section.id === `day:${h.today}`);
    expect(todaySection?.title).toBe('Today');
    expect(todaySection?.items.flatMap((item) => item.kind === 'task' ? [item.task.id] : []))
      .toEqual([dueToday]);
    expect(todaySection?.items.some((item) => item.kind === 'task' && item.task.id === startsToday)).toBe(false);
    expect(sidebarCounts(h.db, buildIndexes(h.db, h.today)).upcoming).toBe(1);
  });

  it('filters My Day by tags without adding tasks that are not in My Day', () => {
    const h = new Harness();
    const tagId = h.run(createTag(h.db, h.ctx(), 'Home')).id;
    const taggedToday = h.run(createTask(h.db, h.ctx(), {
      title: 'tagged today',
      target: { parentType: 'inbox', parentId: null, headingId: null, myDay: true },
    })).id;
    h.run(createTask(h.db, h.ctx(), {
      title: 'untagged today',
      target: { parentType: 'inbox', parentId: null, headingId: null, myDay: true },
    }));
    const taggedAnytime = h.run(createTask(h.db, h.ctx(), {
      title: 'tagged anytime',
      target: { parentType: 'inbox', parentId: null, headingId: null },
    })).id;
    h.apply(assignTag(h.db, h.ctx(), tagId, 'task', taggedToday));
    h.apply(assignTag(h.db, h.ctx(), tagId, 'task', taggedAnytime));

    const filtered = runView(h.db, buildIndexes(h.db, h.today), 'today', { tagFilter: [tagId] });
    const taskIds = filtered.sections.flatMap((section) => section.items)
      .flatMap((item) => item.kind === 'task' ? [item.task.id] : []);
    expect(taskIds).toEqual([taggedToday]);
  });

  it('shows every live open task once in All Tasks and supports tag filtering', () => {
    const h = new Harness();
    const tagId = h.run(createTag(h.db, h.ctx(), 'Work')).id;
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Project' })).id;
    const inbox = h.run(createTask(h.db, h.ctx(), { title: 'inbox item', target: { parentType: 'inbox', parentId: null, headingId: null } })).id;
    const project = h.run(createTask(h.db, h.ctx(), { title: 'project item', target: { parentType: 'project', parentId: projectId, headingId: null } })).id;
    const someday = h.run(createTask(h.db, h.ctx(), { title: 'someday item', target: { parentType: 'inbox', parentId: null, headingId: null, planning: 'someday' } })).id;
    const done = h.run(createTask(h.db, h.ctx(), { title: 'done item', target: { parentType: 'inbox', parentId: null, headingId: null } })).id;
    h.apply(assignTag(h.db, h.ctx(), tagId, 'task', project));
    h.apply(setTaskStatus(h.db, h.ctx(), done, 'completed'));

    expect(titlesIn(h, 'allTasks')).toEqual(expect.arrayContaining(['Inbox item', 'Project item', 'Someday item']));
    expect(titlesIn(h, 'allTasks')).toHaveLength(3);

    const filtered = runView(h.db, buildIndexes(h.db, h.today), 'allTasks', { tagFilter: [tagId] });
    expect(filtered.sections.flatMap((section) => section.items)
      .flatMap((item) => item.kind === 'task' ? [item.task.id] : [])).toEqual([project]);
    expect([inbox, someday]).not.toContain(project);
  });

  it('matches any selected global tag while keeping a dedicated Tag view constrained', () => {
    const h = new Harness();
    const home = h.run(createTag(h.db, h.ctx(), 'Home')).id;
    const work = h.run(createTag(h.db, h.ctx(), 'Work')).id;
    const homeOnly = h.run(createTask(h.db, h.ctx(), { title: 'Home only', target: { parentType: 'inbox', parentId: null, headingId: null } })).id;
    const workOnly = h.run(createTask(h.db, h.ctx(), { title: 'Work only', target: { parentType: 'inbox', parentId: null, headingId: null } })).id;
    const both = h.run(createTask(h.db, h.ctx(), { title: 'Both', target: { parentType: 'inbox', parentId: null, headingId: null } })).id;
    h.apply(assignTag(h.db, h.ctx(), home, 'task', homeOnly));
    h.apply(assignTag(h.db, h.ctx(), work, 'task', workOnly));
    h.apply(assignTag(h.db, h.ctx(), home, 'task', both));
    h.apply(assignTag(h.db, h.ctx(), work, 'task', both));

    const all = runView(h.db, buildIndexes(h.db, h.today), 'allTasks', { tagFilter: [home, work] });
    expect(all.sections.flatMap((section) => section.items)
      .flatMap((item) => item.kind === 'task' ? [item.task.id] : [])).toEqual(expect.arrayContaining([homeOnly, workOnly, both]));

    const homeFilteredByWork = runView(h.db, buildIndexes(h.db, h.today), `tag:${home}`, { tagFilter: [work] });
    expect(homeFilteredByWork.sections.flatMap((section) => section.items)
      .flatMap((item) => item.kind === 'task' ? [item.task.id] : [])).toEqual([both]);
  });

  it('supports saved manual order and non-destructive presentation sorts', () => {
    const h = new Harness();
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Sort test' })).id;
    const zebra = h.run(createTask(h.db, h.ctx(), { title: 'Zebra', target: { parentType: 'project', parentId: projectId, headingId: null } })).id;
    h.advanceDays(1);
    const apple = h.run(createTask(h.db, h.ctx(), { title: 'Apple', target: { parentType: 'project', parentId: projectId, headingId: null } })).id;
    h.apply(setDeadline(h.db, h.ctx(), zebra, '2026-09-20'));
    h.apply(setDeadline(h.db, h.ctx(), apple, '2026-09-15'));
    h.apply(updateTask(h.db, h.ctx(), zebra, { priority: 'urgent' }));
    h.apply(updateTask(h.db, h.ctx(), apple, { priority: 'low' }));
    const alpha = h.run(createTag(h.db, h.ctx(), 'Alpha')).id;
    const zulu = h.run(createTag(h.db, h.ctx(), 'Zulu')).id;
    h.apply(assignTag(h.db, h.ctx(), alpha, 'task', zebra));
    h.apply(assignTag(h.db, h.ctx(), zulu, 'task', apple));

    const titles = (sort: Parameters<typeof sortDocument>[1]) => sortDocument(
      view(h, `project:${projectId}`), sort, (tagId) => h.db.tags[tagId]?.name ?? tagId,
    )
      .sections.flatMap((section) => section.items.flatMap((item) => item.kind === 'task' ? [item.task.title] : []));
    expect(titles('manual')).toEqual(['Zebra', 'Apple']);
    expect(titles('alphabetical')).toEqual(['Apple', 'Zebra']);
    expect(titles('alphabeticalDesc')).toEqual(['Zebra', 'Apple']);
    expect(titles('due')).toEqual(['Apple', 'Zebra']);
    expect(titles('dueDesc')).toEqual(['Zebra', 'Apple']);
    expect(titles('created')).toEqual(['Apple', 'Zebra']);
    expect(titles('createdAsc')).toEqual(['Zebra', 'Apple']);
    expect(titles('priority')).toEqual(['Zebra', 'Apple']);
    expect(titles('priorityDesc')).toEqual(['Apple', 'Zebra']);
    expect(titles('tags')).toEqual(['Zebra', 'Apple']);
    expect(titles('tagsDesc')).toEqual(['Apple', 'Zebra']);

    h.apply(orderItems(h.db, h.ctx(), [apple, zebra]));
    expect(titlesIn(h, `project:${projectId}`)).toEqual(['Apple', 'Zebra']);
  });

  it('stores a tag color as editable tag metadata', () => {
    const h = new Harness();
    const tagId = h.run(createTag(h.db, h.ctx(), 'Calls')).id;
    h.apply(updateTag(h.db, h.ctx(), tagId, { color: 'purple' }));
    expect(h.db.tags[tagId]?.color).toBe('purple');
  });

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
    for (const id of [a, b]) h.apply(setTaskInToday(h.db, h.ctx(), id, true));

    const structuralBefore = titlesIn(h, `project:${projectId}`);
    h.apply(reorderTask(h.db, h.ctx(), a, { beforeId: b, afterId: null }, 'today'));

    expect(titlesIn(h, 'today', 'today')).toEqual(['B', 'A']);
    expect(titlesIn(h, `project:${projectId}`)).toEqual(structuralBefore);
  });
});
