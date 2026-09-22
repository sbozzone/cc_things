import { byRank } from './rank';
import {
  computeProcessed, deadlineReached, holdOf, inEvening, inInbox, inToday,
  isAvailable, isOpen, isOverdue, projectHold, projectInToday, projectProgress,
  type Hold, type Progress,
} from './membership';
import { buildTagIndex, effectiveProjectTags, effectiveTaskTags, emptyTagFilter, matchesTagFilter, tagFilterActive, type TagFilter, type TagIndex } from './tags';
import { addDays, formatDateLabel, monthName, weekdayName } from './dates';
import { resolveSectionDate } from './quick-add';
import { evaluateSmartList, SMART_LISTS } from './smart-lists';
import type {
  Area, CalendarEvent, ChecklistItem, Database, DateOnly, Heading, Project,
  RepeatTemplate, Task,
} from './types';

/**
 * View queries (spec §5). Every list is a query over the one record set: showing an
 * item in several views never creates a duplicate task, and completing it anywhere
 * updates it everywhere.
 */

export type ViewKey =
  | 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday' | 'logbook' | 'trash'
  | 'tomorrow' | 'deadlines' | 'repeating' | 'allTasks' | 'allProjects' | 'loggedProjects'
  | 'smart:overdue' | 'smart:priority'
  | `project:${string}` | `area:${string}` | `tag:${string}`;

export const BUILT_IN_ORDER: ViewKey[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook'];

export const VIEW_TITLES: Record<string, string> = {
  inbox: 'Inbox',
  today: 'My Day',
  upcoming: 'Upcoming',
  anytime: 'Anytime',
  someday: 'Someday',
  logbook: 'Logbook',
  trash: 'Trash',
  tomorrow: 'Tomorrow',
  deadlines: 'Deadlines',
  repeating: 'Repeating',
  allTasks: 'All Tasks',
  allProjects: 'All Projects',
  loggedProjects: 'Logged Projects',
  'smart:overdue': 'Overdue',
  'smart:priority': 'High Priority',
};

export interface Indexes {
  today: DateOnly;
  tagIndex: TagIndex;
  areas: Area[];
  projectsByArea: Map<string, Project[]>;
  unfiledProjects: Project[];
  headingsByProject: Map<string, Heading[]>;
  tasksByProject: Map<string, Task[]>;
  tasksByArea: Map<string, Task[]>;
  /** Processed tasks with no area or project. */
  unfiledTasks: Task[];
  checklistByTask: Map<string, ChecklistItem[]>;
  eventsByDate: Map<DateOnly, CalendarEvent[]>;
  /** Materialized entity id -> the repeat template that produced it. */
  templateOf: Map<string, RepeatTemplate>;
}

export function buildIndexes(db: Database, today: DateOnly): Indexes {
  const tagIndex = buildTagIndex(db);
  const areas = Object.values(db.areas).filter((a) => a.deletedAt === null).sort(byRank);

  const projectsByArea = new Map<string, Project[]>();
  const unfiledProjects: Project[] = [];
  for (const project of Object.values(db.projects)) {
    if (project.deletedAt !== null) continue;
    if (project.areaId && db.areas[project.areaId]?.deletedAt === null) {
      const list = projectsByArea.get(project.areaId) ?? [];
      list.push(project);
      projectsByArea.set(project.areaId, list);
    } else {
      unfiledProjects.push(project);
    }
  }
  for (const list of projectsByArea.values()) list.sort(byRank);
  unfiledProjects.sort(byRank);

  const headingsByProject = new Map<string, Heading[]>();
  for (const heading of Object.values(db.headings)) {
    if (heading.deletedAt !== null) continue;
    const list = headingsByProject.get(heading.projectId) ?? [];
    list.push(heading);
    headingsByProject.set(heading.projectId, list);
  }
  for (const list of headingsByProject.values()) list.sort(byRank);

  const tasksByProject = new Map<string, Task[]>();
  const tasksByArea = new Map<string, Task[]>();
  const unfiledTasks: Task[] = [];
  for (const task of Object.values(db.tasks)) {
    if (task.deletedAt !== null) continue;
    if (task.parentType === 'project' && task.parentId) {
      const list = tasksByProject.get(task.parentId) ?? [];
      list.push(task);
      tasksByProject.set(task.parentId, list);
    } else if (task.parentType === 'area' && task.parentId) {
      const list = tasksByArea.get(task.parentId) ?? [];
      list.push(task);
      tasksByArea.set(task.parentId, list);
    } else if (task.processed) {
      unfiledTasks.push(task);
    }
  }
  for (const list of tasksByProject.values()) list.sort(byRank);
  for (const list of tasksByArea.values()) list.sort(byRank);
  unfiledTasks.sort(byRank);

  const checklistByTask = new Map<string, ChecklistItem[]>();
  for (const item of Object.values(db.checklistItems)) {
    if (item.deletedAt !== null) continue;
    const list = checklistByTask.get(item.taskId) ?? [];
    list.push(item);
    checklistByTask.set(item.taskId, list);
  }
  for (const list of checklistByTask.values()) list.sort(byRank);

  // Multi-day events are indexed on every day they touch, so an event spanning
  // midnight renders on both days (R21).
  const eventsByDate = new Map<DateOnly, CalendarEvent[]>();
  for (const event of Object.values(db.calendarEvents)) {
    if (event.canceled) continue;
    let cursor = event.startDate;
    for (let guard = 0; guard < 400 && cursor <= event.endDate; guard++) {
      const list = eventsByDate.get(cursor) ?? [];
      list.push(event);
      eventsByDate.set(cursor, list);
      cursor = addDays(cursor, 1);
    }
  }
  for (const list of eventsByDate.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.startInstant ?? '').localeCompare(b.startInstant ?? '') || a.title.localeCompare(b.title);
    });
  }

  const templateOf = new Map<string, RepeatTemplate>();
  for (const link of Object.values(db.occurrenceLinks)) {
    if (link.deletedAt !== null) continue;
    const template = db.repeatTemplates[link.templateId];
    if (template && template.deletedAt === null) templateOf.set(link.materializedId, template);
  }

  return {
    today, tagIndex, areas, projectsByArea, unfiledProjects, headingsByProject,
    tasksByProject, tasksByArea, unfiledTasks, checklistByTask, eventsByDate, templateOf,
  };
}

export function projectOf(db: Database, task: Task): Project | null {
  if (task.parentType !== 'project' || !task.parentId) return null;
  return db.projects[task.parentId] ?? null;
}

/** Where the "+" button should insert when pressed inside a section (R04). */
export interface AddTarget {
  parentType: 'inbox' | 'area' | 'project';
  parentId: string | null;
  headingId: string | null;
  planning?: 'anytime' | 'someday' | 'scheduled';
  startDate?: DateOnly | null;
  deadline?: DateOnly | null;
  myDay?: boolean;
  evening?: boolean;
}

export interface RowMeta {
  /** Breadcrumb such as "Kitchen › Cabinets". */
  contextLabel: string | null;
  /** Set when a reached deadline pulled the task out of a held project (spec §4). */
  heldContextLabel: string | null;
  showStartMarker: boolean;
  showDeadlineMarker: boolean;
  overdue: boolean;
  hold: Hold;
  repeating: boolean;
  checklistTotal: number;
  checklistChecked: number;
  tagIds: string[];
}

export type TaskListItem = { kind: 'task'; id: string; task: Task; meta: RowMeta };
export type ProjectListItem = {
  kind: 'project';
  id: string;
  project: Project;
  progress: Progress;
  meta: RowMeta;
  /** Open child tasks shown when a project summary is expanded in All Projects. */
  children?: TaskListItem[];
};

export type ListItem =
  | TaskListItem
  | ProjectListItem
  | { kind: 'heading'; id: string; heading: Heading; addTarget: AddTarget }
  | { kind: 'event'; id: string; event: CalendarEvent };

export interface ListSection {
  id: string;
  title: string | null;
  subtitle: string | null;
  date: DateOnly | null;
  items: ListItem[];
  addTarget: AddTarget | null;
  /** Events are presented apart from tasks rather than interleaved (R11, R20). */
  isEventSection?: boolean;
}

export interface ListDocument {
  view: ViewKey;
  title: string;
  subtitle: string | null;
  sections: ListSection[];
  /** Open tasks only: no events, headings, templates or project summaries (R12). */
  openCount: number;
  filtered: boolean;
  emptyMessage: string;
  addTarget: AddTarget;
}

export interface QueryOptions {
  tagFilter?: TagFilter;
  todayGrouping?: 'flat' | 'byProject';
}

function taskMeta(db: Database, ix: Indexes, task: Task, opts: { showContext?: boolean; startMarker?: boolean; deadlineMarker?: boolean } = {}): RowMeta {
  const project = projectOf(db, task);
  const hold = holdOf(task, project, ix.today);
  const checklist = ix.checklistByTask.get(task.id) ?? [];
  const effective = effectiveTaskTags(db, ix.tagIndex, task.id);
  return {
    contextLabel: opts.showContext === false ? null : contextLabelFor(db, task),
    heldContextLabel:
      hold.releasedByDeadline && hold.inheritedFrom === 'project' && project ? project.title : null,
    showStartMarker: opts.startMarker ?? false,
    showDeadlineMarker: opts.deadlineMarker ?? task.deadline !== null,
    overdue: isOverdue(task, ix.today),
    hold: hold.hold,
    repeating: ix.templateOf.has(task.id),
    checklistTotal: checklist.length,
    checklistChecked: checklist.filter((c) => c.checked).length,
    tagIds: [...effective.all],
  };
}

export function contextLabelFor(db: Database, task: Task): string | null {
  if (task.parentType === 'project' && task.parentId) {
    const project = db.projects[task.parentId];
    if (!project) return null;
    const heading = task.headingId ? db.headings[task.headingId] : null;
    const area = project.areaId ? db.areas[project.areaId] : null;
    const parts = [area?.title, project.title, heading?.title].filter(Boolean) as string[];
    return parts.join(' › ');
  }
  if (task.parentType === 'area' && task.parentId) return db.areas[task.parentId]?.title ?? null;
  return null;
}

function projectMeta(db: Database, ix: Indexes, project: Project): RowMeta {
  const effective = effectiveProjectTags(db, ix.tagIndex, project.id);
  return {
    contextLabel: project.areaId ? db.areas[project.areaId]?.title ?? null : null,
    heldContextLabel: null,
    showStartMarker: false,
    showDeadlineMarker: project.deadline !== null,
    overdue: isOverdue(project, ix.today),
    hold: projectHold(project, ix.today),
    repeating: ix.templateOf.has(project.id),
    checklistTotal: 0,
    checklistChecked: 0,
    tagIds: [...effective.all],
  };
}

function passesFilter(db: Database, ix: Indexes, opts: QueryOptions, task: Task): boolean {
  const filter = opts.tagFilter ?? emptyTagFilter();
  if (!tagFilterActive(filter)) return true;
  return matchesTagFilter(effectiveTaskTags(db, ix.tagIndex, task.id).all, ix.tagIndex, filter);
}

function projectPassesFilter(db: Database, ix: Indexes, opts: QueryOptions, project: Project): boolean {
  const filter = opts.tagFilter ?? emptyTagFilter();
  if (!tagFilterActive(filter)) return true;
  return matchesTagFilter(effectiveProjectTags(db, ix.tagIndex, project.id).all, ix.tagIndex, filter);
}

function countTasks(sections: ListSection[]): number {
  let n = 0;
  for (const section of sections) {
    for (const item of section.items) if (item.kind === 'task' && item.task.status === 'open') n += 1;
  }
  return n;
}

const liveTasks = (db: Database): Task[] => Object.values(db.tasks).filter((t) => t.deletedAt === null);

/* ------------------------------------------------------------------ Inbox */

function inboxView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const items: ListItem[] = liveTasks(db)
    .filter((t) => inInbox(t) && passesFilter(db, ix, opts, t))
    .sort(byRank)
    .map((task) => ({ kind: 'task' as const, id: task.id, task, meta: taskMeta(db, ix, task) }));
  const sections: ListSection[] = [
    { id: 'inbox', title: null, subtitle: null, date: null, items, addTarget: inboxTarget() },
  ];
  return doc('inbox', 'Inbox', null, sections, opts, 'Nothing to process. Anything you capture lands here.', inboxTarget());
}

const inboxTarget = (): AddTarget => ({ parentType: 'inbox', parentId: null, headingId: null });

/* ------------------------------------------------------------------ Today */

function todayView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const events = ix.eventsByDate.get(ix.today) ?? [];
  const sections: ListSection[] = [];

  if (events.length > 0) {
    sections.push({
      id: 'events',
      title: null,
      subtitle: null,
      date: ix.today,
      isEventSection: true,
      addTarget: null,
      items: events.map((event) => ({ kind: 'event' as const, id: event.id, event })),
    });
  }

  const regular: ListItem[] = [];
  const evening: ListItem[] = [];
  for (const task of liveTasks(db)) {
    if (!inToday(task, projectOf(db, task), ix.today)) continue;
    if (!passesFilter(db, ix, opts, task)) continue;
    const item: ListItem = { kind: 'task', id: task.id, task, meta: taskMeta(db, ix, task) };
    if (inEvening(task, ix.today)) evening.push(item);
    else regular.push(item);
  }

  // Scheduled projects show a summary row in Today; their undated children stay in Anytime.
  const summaries: ListItem[] = Object.values(db.projects)
    .filter((p) => projectInToday(p, ix.today) && projectPassesFilter(db, ix, opts, p))
    .sort(byRank)
    .map((project) => ({
      kind: 'project' as const,
      id: project.id,
      project,
      progress: projectProgress(ix.tasksByProject.get(project.id) ?? []),
      meta: projectMeta(db, ix, project),
    }));

  const sortToday = (a: ListItem, b: ListItem) => {
    const ra = a.kind === 'task' ? a.task.todayRank : '';
    const rb = b.kind === 'task' ? b.task.todayRank : '';
    return ra === rb ? a.id.localeCompare(b.id) : ra < rb ? -1 : 1;
  };
  regular.sort(sortToday);
  evening.sort(sortToday);

  const todayTarget: AddTarget = {
    parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime', myDay: true,
  };

  if (opts.todayGrouping === 'byProject') {
    for (const group of groupByParent(db, ix, [...summaries, ...regular])) sections.push(group);
  } else {
    sections.push({
      id: 'today', title: null, subtitle: null, date: ix.today,
      items: [...summaries, ...regular], addTarget: todayTarget,
    });
  }

  sections.push({
    id: 'evening',
    title: 'This Evening',
    subtitle: null,
    date: ix.today,
    items: evening,
    addTarget: { ...todayTarget, evening: true },
  });

  return doc('today', 'My Day', `${weekdayName(ix.today)}, ${monthName(ix.today)} ${Number(ix.today.slice(8, 10))}`, sections, opts,
    'Nothing planned. Pull something in from Anytime, or capture a new task.', todayTarget);
}

function groupByParent(db: Database, ix: Indexes, items: ListItem[]): ListSection[] {
  const groups = new Map<string, { title: string; items: ListItem[]; target: AddTarget }>();
  for (const item of items) {
    const task = item.kind === 'task' ? item.task : null;
    const keyId = task
      ? task.parentType === 'project' && task.parentId ? `project:${task.parentId}`
        : task.parentType === 'area' && task.parentId ? `area:${task.parentId}` : 'unfiled'
      : 'projects';
    const title = task ? contextLabelFor(db, task) ?? 'No Project' : 'Projects';
    const target: AddTarget = task && task.parentType !== 'inbox' && task.parentId
      ? { parentType: task.parentType, parentId: task.parentId, headingId: task.headingId, planning: 'anytime', myDay: true }
      : { parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime', myDay: true };
    const group = groups.get(keyId) ?? { title, items: [], target };
    group.items.push(item);
    groups.set(keyId, group);
  }
  return [...groups.entries()].map(([id, g]) => ({
    id, title: g.title, subtitle: null, date: ix.today, items: g.items, addTarget: g.target,
  }));
}

/* --------------------------------------------------------------- Upcoming */

interface UpcomingEntry { task: Task; start: boolean; deadline: boolean }

function upcomingView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const byDate = new Map<DateOnly, Map<string, UpcomingEntry>>();
  const put = (date: DateOnly, task: Task, kind: 'start' | 'deadline') => {
    const day = byDate.get(date) ?? new Map<string, UpcomingEntry>();
    // Same-day start and deadline markers coalesce into one row carrying both (R14).
    const entry = day.get(task.id) ?? { task, start: false, deadline: false };
    if (kind === 'start') entry.start = true;
    else entry.deadline = true;
    day.set(task.id, entry);
    byDate.set(date, day);
  };

  for (const task of liveTasks(db)) {
    if (task.status !== 'open' || !passesFilter(db, ix, opts, task)) continue;
    if (ix.templateOf.has(task.id)) continue;
    if (task.startDate !== null && task.startDate > ix.today) put(task.startDate, task, 'start');
    if (task.deadline !== null && task.deadline >= ix.today) put(task.deadline, task, 'deadline');
  }

  const projectsByDate = new Map<DateOnly, Project[]>();
  for (const project of Object.values(db.projects)) {
    if (project.deletedAt !== null || project.status !== 'open') continue;
    if (ix.templateOf.has(project.id)) continue;
    if (!projectPassesFilter(db, ix, opts, project)) continue;
    for (const [date, includeToday] of [[project.startDate, false], [project.deadline, true]] as const) {
      if (date && (date > ix.today || (includeToday && date === ix.today))) {
        const list = projectsByDate.get(date) ?? [];
        if (!list.some((p) => p.id === project.id)) list.push(project);
        projectsByDate.set(date, list);
      }
    }
  }

  const dates = new Set<DateOnly>([
    ...byDate.keys(), ...projectsByDate.keys(), ...ix.eventsByDate.keys(),
  ]);
  const sections: ListSection[] = [];

  // Upcoming begins with work due today, but a start date alone does not place an
  // item here once that date has arrived. Today's calendar events remain in My Day.
  if (byDate.has(ix.today) || projectsByDate.has(ix.today)) {
    sections.push(upcomingSection(
      db, ix, ix.today, byDate, projectsByDate, 'Today', true, false,
    ));
  }

  // The next seven days appear individually from tomorrow, then later date groups.
  const dayWindow: DateOnly[] = [];
  for (let i = 1; i <= 7; i++) dayWindow.push(addDays(ix.today, i));
  const windowSet = new Set(dayWindow);

  for (const date of dayWindow) {
    sections.push(upcomingSection(db, ix, date, byDate, projectsByDate, `${formatDateLabel(date, ix.today)}`, true));
  }

  const later = [...dates].filter((d) => d > ix.today && !windowSet.has(d)).sort();
  const monthBuckets = new Map<string, DateOnly[]>();
  for (const date of later) {
    const key = date.slice(0, 7);
    const list = monthBuckets.get(key) ?? [];
    list.push(date);
    monthBuckets.set(key, list);
  }
  for (const [monthKey, groupDates] of monthBuckets) {
    const items: ListItem[] = [];
    for (const date of groupDates) {
      const section = upcomingSection(db, ix, date, byDate, projectsByDate, '', false);
      items.push(...section.items);
    }
    if (items.length === 0) continue;
    const first = groupDates[0] as DateOnly;
    sections.push({
      id: `month:${monthKey}`,
      title: `${monthName(first)} ${first.slice(0, 4)}`,
      subtitle: null,
      date: first,
      items,
      addTarget: { parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime', deadline: first },
    });
  }

  return doc('upcoming', 'Upcoming', null, sections, opts,
    'Nothing due today or scheduled ahead. Give a task a start date to see it here.',
    { parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime', deadline: addDays(ix.today, 1) });
}

function upcomingSection(
  db: Database, ix: Indexes, date: DateOnly,
  byDate: Map<DateOnly, Map<string, UpcomingEntry>>,
  projectsByDate: Map<DateOnly, Project[]>,
  title: string, keepEmpty: boolean, includeEvents = true,
): ListSection {
  const items: ListItem[] = [];
  if (includeEvents) {
    for (const event of ix.eventsByDate.get(date) ?? []) {
      items.push({ kind: 'event', id: `${event.id}@${date}`, event });
    }
  }
  for (const project of projectsByDate.get(date) ?? []) {
    items.push({
      kind: 'project', id: `${project.id}@${date}`, project,
      progress: projectProgress(ix.tasksByProject.get(project.id) ?? []),
      meta: projectMeta(db, ix, project),
    });
  }
  const entries = [...(byDate.get(date)?.values() ?? [])].sort((a, b) => byRank(a.task, b.task));
  for (const entry of entries) {
    items.push({
      kind: 'task', id: `${entry.task.id}@${date}`, task: entry.task,
      meta: taskMeta(db, ix, entry.task, { startMarker: entry.start, deadlineMarker: entry.deadline }),
    });
  }
  void keepEmpty;
  const dueDate = resolveSectionDate(date, title, ix.today);
  return {
    id: `day:${date}`,
    title: title || formatDateLabel(date, ix.today),
    subtitle: title ? formatDateLabel(date, ix.today) === title ? null : null : null,
    date,
    items,
    addTarget: { parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime', deadline: dueDate },
  };
}

/* ---------------------------------------------------------------- Anytime */

function anytimeView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const sections: ListSection[] = [];
  const eligible = (task: Task) =>
    task.processed && isAvailable(task, projectOf(db, task), ix.today) && passesFilter(db, ix, opts, task);

  const unfiled = ix.unfiledTasks.filter(eligible);
  if (unfiled.length > 0) {
    sections.push({
      id: 'unfiled', title: null, subtitle: null, date: null,
      items: unfiled.map((task) => ({ kind: 'task' as const, id: task.id, task, meta: taskMeta(db, ix, task) })),
      addTarget: { parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime' },
    });
  }

  const pushProject = (project: Project) => {
    // A held project is not skipped outright: a child whose explicit start date or
    // reached deadline overrode the inherited hold still belongs here, under its
    // project's heading so the held context stays visible (spec §4).
    if (project.status !== 'open') return;
    const tasks = (ix.tasksByProject.get(project.id) ?? []).filter(eligible);
    if (tasks.length === 0) return;
    sections.push({
      id: `project:${project.id}`,
      title: project.title,
      subtitle: project.areaId ? db.areas[project.areaId]?.title ?? null : null,
      date: null,
      items: tasks.map((task) => ({
        kind: 'task' as const, id: task.id, task,
        meta: { ...taskMeta(db, ix, task), contextLabel: null },
      })),
      addTarget: { parentType: 'project', parentId: project.id, headingId: null },
    });
  };

  for (const area of ix.areas) {
    const direct = (ix.tasksByArea.get(area.id) ?? []).filter(eligible);
    if (direct.length > 0) {
      sections.push({
        id: `area:${area.id}`, title: area.title, subtitle: null, date: null,
        items: direct.map((task) => ({
          kind: 'task' as const, id: task.id, task,
          meta: { ...taskMeta(db, ix, task), contextLabel: null },
        })),
        addTarget: { parentType: 'area', parentId: area.id, headingId: null },
      });
    }
    for (const project of ix.projectsByArea.get(area.id) ?? []) pushProject(project);
  }
  for (const project of ix.unfiledProjects) pushProject(project);

  return doc('anytime', 'Anytime', null, sections, opts,
    'Nothing available right now.', { parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime' });
}

/* ---------------------------------------------------------------- Someday */

function somedayView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const items: ListItem[] = [];
  for (const project of Object.values(db.projects)) {
    if (project.deletedAt !== null || project.status !== 'open') continue;
    if (projectHold(project, ix.today) !== 'someday') continue;
    if (!projectPassesFilter(db, ix, opts, project)) continue;
    items.push({
      kind: 'project', id: project.id, project,
      progress: projectProgress(ix.tasksByProject.get(project.id) ?? []),
      meta: projectMeta(db, ix, project),
    });
  }
  for (const task of liveTasks(db)) {
    if (task.status !== 'open' || !passesFilter(db, ix, opts, task)) continue;
    if (holdOf(task, projectOf(db, task), ix.today).hold !== 'someday') continue;
    // A held child of a Someday project is represented by the project row, not twice.
    if (task.parentType === 'project' && task.parentId) {
      const parent = db.projects[task.parentId];
      if (parent && projectHold(parent, ix.today) === 'someday' && task.planning !== 'someday') continue;
    }
    items.push({ kind: 'task', id: task.id, task, meta: taskMeta(db, ix, task) });
  }
  items.sort((a, b) => {
    const ra = a.kind === 'task' ? a.task.rank : a.kind === 'project' ? a.project.rank : '';
    const rb = b.kind === 'task' ? b.task.rank : b.kind === 'project' ? b.project.rank : '';
    return ra === rb ? a.id.localeCompare(b.id) : ra < rb ? -1 : 1;
  });
  const sections: ListSection[] = [{
    id: 'someday', title: null, subtitle: null, date: null, items,
    addTarget: { parentType: 'inbox', parentId: null, headingId: null, planning: 'someday' },
  }];
  return doc('someday', 'Someday', null, sections, opts,
    'Nothing on hold. Move things here when they are not for now.',
    { parentType: 'inbox', parentId: null, headingId: null, planning: 'someday' });
}

/* ---------------------------------------------------------- Logbook, Trash */

function closedAt(item: { completedAt: string | null; canceledAt: string | null }): string {
  return item.completedAt ?? item.canceledAt ?? '';
}

function logbookView(db: Database, ix: Indexes, opts: QueryOptions, projectsOnly = false): ListDocument {
  const rows: { at: string; item: ListItem }[] = [];
  if (!projectsOnly) {
    for (const task of liveTasks(db)) {
      if (task.status === 'open' || !passesFilter(db, ix, opts, task)) continue;
      rows.push({ at: closedAt(task), item: { kind: 'task', id: task.id, task, meta: taskMeta(db, ix, task) } });
    }
  }
  for (const project of Object.values(db.projects)) {
    if (project.deletedAt !== null || project.status === 'open') continue;
    if (!projectPassesFilter(db, ix, opts, project)) continue;
    rows.push({
      at: closedAt(project),
      item: {
        kind: 'project', id: project.id, project,
        progress: projectProgress(ix.tasksByProject.get(project.id) ?? []),
        meta: projectMeta(db, ix, project),
      },
    });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));

  const sections: ListSection[] = [];
  let current: ListSection | null = null;
  for (const row of rows) {
    const date = row.at.slice(0, 10) || 'unknown';
    if (!current || current.id !== `day:${date}`) {
      current = {
        id: `day:${date}`,
        title: date === 'unknown' ? 'Earlier' : formatDateLabel(date, ix.today),
        subtitle: null, date: date === 'unknown' ? null : date, items: [], addTarget: null,
      };
      sections.push(current);
    }
    current.items.push(row.item);
  }
  const view: ViewKey = projectsOnly ? 'loggedProjects' : 'logbook';
  return doc(view, VIEW_TITLES[view] as string, null, sections, opts,
    'Nothing logged yet. Completed and canceled work is kept here.', inboxTarget());
}

function trashView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const items: ListItem[] = [];
  for (const task of Object.values(db.tasks)) {
    if (task.deletedAt === null) continue;
    items.push({ kind: 'task', id: task.id, task, meta: taskMeta(db, ix, task) });
  }
  for (const project of Object.values(db.projects)) {
    if (project.deletedAt === null) continue;
    items.push({
      kind: 'project', id: project.id, project,
      progress: projectProgress(ix.tasksByProject.get(project.id) ?? []),
      meta: projectMeta(db, ix, project),
    });
  }
  items.sort((a, b) => {
    const da = a.kind === 'task' ? a.task.deletedAt : a.kind === 'project' ? a.project.deletedAt : '';
    const db2 = b.kind === 'task' ? b.task.deletedAt : b.kind === 'project' ? b.project.deletedAt : '';
    return (db2 ?? '').localeCompare(da ?? '');
  });
  return doc('trash', 'Trash', 'Deleted items are kept for 30 days, then purged.',
    [{ id: 'trash', title: null, subtitle: null, date: null, items, addTarget: null }], opts,
    'Trash is empty.', inboxTarget());
}

/* ------------------------------------------------------- Project and Area */

export function projectView(db: Database, ix: Indexes, projectId: string, opts: QueryOptions, showLogged = false): ListDocument {
  const project = db.projects[projectId];
  if (!project) {
    return doc(`project:${projectId}`, 'Missing project', null, [], opts, 'This project no longer exists.', inboxTarget());
  }
  const tasks = (ix.tasksByProject.get(projectId) ?? []).filter((t) => passesFilter(db, ix, opts, t));
  const visible = tasks.filter((t) => showLogged || t.status === 'open');
  const headings = ix.headingsByProject.get(projectId) ?? [];

  const sections: ListSection[] = [];
  const loose = visible.filter((t) => !t.headingId || !db.headings[t.headingId]);
  sections.push({
    id: 'root', title: null, subtitle: null, date: null,
    items: loose.map((task) => ({
      kind: 'task' as const, id: task.id, task, meta: { ...taskMeta(db, ix, task), contextLabel: null },
    })),
    addTarget: { parentType: 'project', parentId: projectId, headingId: null },
  });

  for (const heading of headings) {
    const children = visible.filter((t) => t.headingId === heading.id);
    if (heading.archivedAt !== null && children.length === 0 && !showLogged) continue;
    sections.push({
      id: `heading:${heading.id}`,
      title: heading.title,
      subtitle: heading.archivedAt !== null ? 'Archived' : null,
      date: null,
      items: children.map((task) => ({
        kind: 'task' as const, id: task.id, task, meta: { ...taskMeta(db, ix, task), contextLabel: null },
      })),
      addTarget: { parentType: 'project', parentId: projectId, headingId: heading.id },
    });
  }

  const result = doc(`project:${projectId}`, project.title,
    project.areaId ? db.areas[project.areaId]?.title ?? null : null,
    sections, opts, 'No tasks in this project yet.',
    { parentType: 'project', parentId: projectId, headingId: null });
  return result;
}

export function areaView(db: Database, ix: Indexes, areaId: string, opts: QueryOptions): ListDocument {
  const area = db.areas[areaId];
  if (!area) return doc(`area:${areaId}`, 'Missing area', null, [], opts, 'This area no longer exists.', inboxTarget());

  const sections: ListSection[] = [];
  const direct = (ix.tasksByArea.get(areaId) ?? []).filter((t) => t.status === 'open' && passesFilter(db, ix, opts, t));
  sections.push({
    id: 'root', title: null, subtitle: null, date: null,
    items: direct.map((task) => ({
      kind: 'task' as const, id: task.id, task, meta: { ...taskMeta(db, ix, task), contextLabel: null },
    })),
    addTarget: { parentType: 'area', parentId: areaId, headingId: null },
  });

  const projects = (ix.projectsByArea.get(areaId) ?? []).filter((p) => p.status === 'open' && projectPassesFilter(db, ix, opts, p));
  if (projects.length > 0) {
    sections.push({
      id: 'projects', title: 'Projects', subtitle: null, date: null, addTarget: null,
      items: projects.map((project) => ({
        kind: 'project' as const, id: project.id, project,
        progress: projectProgress(ix.tasksByProject.get(project.id) ?? []),
        meta: { ...projectMeta(db, ix, project), contextLabel: null },
      })),
    });
  }
  return doc(`area:${areaId}`, area.title, null, sections, opts, 'This area is empty.',
    { parentType: 'area', parentId: areaId, headingId: null });
}

/* ------------------------------------------------------------ Extra views */

function tagView(db: Database, ix: Indexes, tagId: string, opts: QueryOptions): ListDocument {
  const ownTag: QueryOptions = { tagFilter: { mode: 'include', tagIds: [tagId], untagged: false } };
  const items: ListItem[] = liveTasks(db)
    .filter((t) => t.status === 'open' && passesFilter(db, ix, ownTag, t) && passesFilter(db, ix, opts, t))
    .sort(byRank)
    .map((task) => ({ kind: 'task' as const, id: task.id, task, meta: taskMeta(db, ix, task) }));
  const tag = db.tags[tagId];
  return doc(`tag:${tagId}`, tag?.name ?? 'Tag', 'Everything carrying this tag', [
    { id: 'tag', title: null, subtitle: null, date: null, items, addTarget: null },
  ], opts, 'Nothing carries this tag.', inboxTarget());
}

function tomorrowView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const date = addDays(ix.today, 1);
  const items: ListItem[] = [];
  for (const event of ix.eventsByDate.get(date) ?? []) items.push({ kind: 'event', id: event.id, event });
  for (const task of liveTasks(db)) {
    if (task.status !== 'open' || !passesFilter(db, ix, opts, task)) continue;
    const start = task.startDate === date;
    const due = task.deadline === date;
    if (!start && !due) continue;
    items.push({ kind: 'task', id: task.id, task, meta: taskMeta(db, ix, task, { startMarker: start, deadlineMarker: due }) });
  }
  return doc('tomorrow', 'Tomorrow', `${weekdayName(date)}, ${monthName(date)} ${Number(date.slice(8, 10))}`, [
    { id: 'tomorrow', title: null, subtitle: null, date, items, addTarget: { parentType: 'inbox', parentId: null, headingId: null, planning: 'scheduled', startDate: date } },
  ], opts, 'Nothing scheduled for tomorrow.',
    { parentType: 'inbox', parentId: null, headingId: null, planning: 'scheduled', startDate: date });
}

function deadlinesView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const rows = liveTasks(db)
    .filter((t) => t.status === 'open' && t.deadline !== null && passesFilter(db, ix, opts, t))
    .sort((a, b) => (a.deadline as string).localeCompare(b.deadline as string));
  const sections: ListSection[] = [];
  let current: ListSection | null = null;
  for (const task of rows) {
    const date = task.deadline as string;
    if (!current || current.date !== date) {
      current = { id: `due:${date}`, title: formatDateLabel(date, ix.today), subtitle: null, date, items: [], addTarget: null };
      sections.push(current);
    }
    current.items.push({ kind: 'task', id: task.id, task, meta: taskMeta(db, ix, task, { deadlineMarker: true }) });
  }
  return doc('deadlines', 'Deadlines', 'Everything with a finish date', sections, opts,
    'No deadlines set.', inboxTarget());
}

function repeatingView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const items: ListItem[] = [];
  for (const template of Object.values(db.repeatTemplates)) {
    if (template.deletedAt !== null || template.stoppedAt !== null) continue;
    items.push({
      kind: 'task',
      id: template.id,
      task: templateAsTask(db, template),
      meta: {
        contextLabel: template.snapshot.parentId
          ? db.projects[template.snapshot.parentId]?.title ?? db.areas[template.snapshot.parentId]?.title ?? null
          : null,
        heldContextLabel: null, showStartMarker: false, showDeadlineMarker: template.useDeadline,
        overdue: false, hold: template.pausedAt ? 'someday' : null, repeating: true,
        checklistTotal: template.snapshot.checklist.length, checklistChecked: 0,
        tagIds: template.snapshot.tagIds,
      },
    });
  }
  return doc('repeating', 'Repeating', 'Templates, not their copies', [
    { id: 'repeating', title: null, subtitle: null, date: null, items, addTarget: null },
  ], opts, 'No repeating tasks yet.', inboxTarget());
}

/** A synthetic task row so a template can be listed with the ordinary row component. */
function templateAsTask(db: Database, template: RepeatTemplate): Task {
  void db;
  return {
    id: template.id, ownerId: template.ownerId, title: template.snapshot.title,
    notes: template.snapshot.notes, status: 'open', processed: true,
    parentType: template.snapshot.parentType, parentId: template.snapshot.parentId,
    headingId: template.snapshot.headingId, planning: 'anytime',
    startDate: null, eveningDate: null, deadline: null,
    rank: template.anchorDate, todayRank: template.anchorDate,
    completedAt: null, canceledAt: null,
    createdAt: template.createdAt, updatedAt: template.updatedAt, deletedAt: null,
  };
}

function allProjectsView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const sections: ListSection[] = [];
  const render = (project: Project): ListItem => ({
    kind: 'project', id: project.id, project,
    progress: projectProgress(ix.tasksByProject.get(project.id) ?? []),
    meta: projectMeta(db, ix, project),
    children: (ix.tasksByProject.get(project.id) ?? [])
      .filter((task) => task.status === 'open' && passesFilter(db, ix, opts, task))
      .map((task) => ({ kind: 'task' as const, id: task.id, task, meta: taskMeta(db, ix, task) })),
  });
  for (const area of ix.areas) {
    const projects = (ix.projectsByArea.get(area.id) ?? []).filter((p) => p.status === 'open' && projectPassesFilter(db, ix, opts, p));
    if (projects.length === 0) continue;
    sections.push({ id: `area:${area.id}`, title: area.title, subtitle: null, date: null, items: projects.map(render), addTarget: null });
  }
  const loose = ix.unfiledProjects.filter((p) => p.status === 'open' && projectPassesFilter(db, ix, opts, p));
  if (loose.length > 0) {
    sections.push({ id: 'loose', title: 'No Area', subtitle: null, date: null, items: loose.map(render), addTarget: null });
  }
  return doc('allProjects', 'All Projects', null, sections, opts, 'No projects yet.', inboxTarget());
}

/** Every live open task exactly once, regardless of its planning state or parent. */
function allTasksView(db: Database, ix: Indexes, opts: QueryOptions): ListDocument {
  const tasks = liveTasks(db)
    .filter((task) => task.status === 'open' && passesFilter(db, ix, opts, task))
    .sort(byRank);
  return doc('allTasks', 'All Tasks', 'Every open task', [{
    id: 'allTasks', title: null, subtitle: null, date: null,
    items: tasks.map((task) => ({
      kind: 'task' as const,
      id: task.id,
      task,
      meta: taskMeta(db, ix, task),
    })),
    addTarget: inboxTarget(),
  }], opts, 'No open tasks.', inboxTarget());
}

/** Built-in Smart Lists are live views over the same task records, never copied lists. */
function smartListView(db: Database, ix: Indexes, key: 'overdue' | 'priority', opts: QueryOptions): ListDocument {
  const definition = SMART_LISTS[key];
  const tasks = evaluateSmartList(db, ix.today, definition.rule).filter((task) => passesFilter(db, ix, opts, task));
  return doc(`smart:${key}`, definition.title, null, [{
    id: `smart:${key}`, title: null, subtitle: null, date: null,
    items: tasks.map((task) => ({ kind: 'task' as const, id: task.id, task, meta: taskMeta(db, ix, task) })),
    addTarget: null,
  }], opts, `No tasks in ${definition.title.toLocaleLowerCase()}.`, inboxTarget());
}

/* ------------------------------------------------------------------ Entry */

function doc(
  view: ViewKey, title: string, subtitle: string | null,
  sections: ListSection[], opts: QueryOptions, emptyMessage: string, addTarget: AddTarget,
): ListDocument {
  return {
    view, title, subtitle, sections,
    openCount: countTasks(sections),
    filtered: tagFilterActive(opts.tagFilter ?? emptyTagFilter()),
    emptyMessage, addTarget,
  };
}

export function runView(db: Database, ix: Indexes, view: ViewKey, opts: QueryOptions = {}): ListDocument {
  if (view.startsWith('project:')) return projectView(db, ix, view.slice(8), opts);
  if (view.startsWith('area:')) return areaView(db, ix, view.slice(5), opts);
  if (view.startsWith('tag:')) return tagView(db, ix, view.slice(4), opts);
  switch (view) {
    case 'inbox': return inboxView(db, ix, opts);
    case 'today': return todayView(db, ix, opts);
    case 'upcoming': return upcomingView(db, ix, opts);
    case 'anytime': return anytimeView(db, ix, opts);
    case 'someday': return somedayView(db, ix, opts);
    case 'logbook': return logbookView(db, ix, opts);
    case 'loggedProjects': return logbookView(db, ix, opts, true);
    case 'trash': return trashView(db, ix, opts);
    case 'tomorrow': return tomorrowView(db, ix, opts);
    case 'deadlines': return deadlinesView(db, ix, opts);
    case 'repeating': return repeatingView(db, ix, opts);
    case 'allTasks': return allTasksView(db, ix, opts);
    case 'allProjects': return allProjectsView(db, ix, opts);
    case 'smart:overdue': return smartListView(db, ix, 'overdue', opts);
    case 'smart:priority': return smartListView(db, ix, 'priority', opts);
    default: return inboxView(db, ix, opts);
  }
}

/**
 * Navigation badge counts (R12): open tasks only. Events, headings, recurring
 * templates and project summaries never contribute, and a task carrying both a start
 * and a deadline marker still counts once.
 */
export function sidebarCounts(db: Database, ix: Indexes, opts: QueryOptions = {}): Record<string, number> {
  const counts: Record<string, number> = { inbox: 0, today: 0, upcoming: 0, anytime: 0, someday: 0 };
  const seenUpcoming = new Set<string>();
  for (const task of liveTasks(db)) {
    if (task.status !== 'open') continue;
    if (!passesFilter(db, ix, opts, task)) continue;
    const project = projectOf(db, task);
    if (inInbox(task)) counts.inbox = (counts.inbox ?? 0) + 1;
    if (inToday(task, project, ix.today)) counts.today = (counts.today ?? 0) + 1;
    const hold = holdOf(task, project, ix.today);
    if (task.processed && hold.hold === null) counts.anytime = (counts.anytime ?? 0) + 1;
    if (hold.hold === 'someday') counts.someday = (counts.someday ?? 0) + 1;
    const futureStart = task.startDate !== null && task.startDate > ix.today;
    const upcomingDeadline = task.deadline !== null && task.deadline >= ix.today;
    if (!ix.templateOf.has(task.id) && (futureStart || upcomingDeadline) && !seenUpcoming.has(task.id)) {
      seenUpcoming.add(task.id);
      counts.upcoming = (counts.upcoming ?? 0) + 1;
    }
  }
  return counts;
}

export function projectCounts(db: Database, ix: Indexes): Map<string, Progress> {
  const out = new Map<string, Progress>();
  for (const project of Object.values(db.projects)) {
    if (project.deletedAt !== null) continue;
    out.set(project.id, projectProgress(ix.tasksByProject.get(project.id) ?? []));
  }
  return out;
}

export { computeProcessed, deadlineReached, isOpen, projectProgress };
