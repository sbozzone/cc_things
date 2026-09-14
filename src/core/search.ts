import { VIEW_TITLES, type ViewKey } from './selectors';
import type { Database } from './types';

/**
 * Search and navigation (R23).
 *
 * The quick pass matches titles and names only. "Search All" widens the same query to
 * notes, checklist rows and the Logbook. Trash is excluded unless explicitly chosen.
 */

export type ResultKind = 'task' | 'project' | 'heading' | 'area' | 'tag' | 'view';

export interface SearchResult {
  kind: ResultKind;
  id: string;
  title: string;
  /** Breadcrumb or reason this matched, e.g. a matching checklist row. */
  detail: string | null;
  /** Where selecting this result should navigate, and what it should open. */
  target: { view: ViewKey; openId?: string };
  score: number;
  logged: boolean;
}

export interface SearchOptions {
  /** Extends the scope to notes, checklist rows and closed items. */
  searchAll?: boolean;
  includeTrash?: boolean;
  limit?: number;
}

const SPECIAL_VIEWS: ViewKey[] = [
  'inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'trash',
  'tomorrow', 'deadlines', 'repeating', 'allTasks', 'allProjects', 'loggedProjects',
];

function scoreOf(haystack: string, needle: string): number {
  const lower = haystack.toLowerCase();
  const index = lower.indexOf(needle);
  if (index < 0) return 0;
  if (lower === needle) return 100;
  if (index === 0) return 80;
  // A match at a word boundary beats one buried mid-word.
  if (index > 0 && /\s|[/:-]/.test(lower[index - 1] as string)) return 60;
  return 40;
}

export function search(db: Database, rawQuery: string, options: SearchOptions = {}): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];
  const results: SearchResult[] = [];
  const searchAll = options.searchAll ?? false;
  const includeTrash = options.includeTrash ?? false;

  for (const view of SPECIAL_VIEWS) {
    if (view === 'trash' && !includeTrash) continue;
    const title = VIEW_TITLES[view] as string;
    const score = scoreOf(title, query);
    if (score > 0) {
      results.push({ kind: 'view', id: view, title, detail: 'List', target: { view }, score: score + 5, logged: false });
    }
  }

  for (const area of Object.values(db.areas)) {
    if (area.deletedAt !== null && !includeTrash) continue;
    const score = scoreOf(area.title, query);
    if (score > 0) {
      results.push({ kind: 'area', id: area.id, title: area.title, detail: 'Area', target: { view: `area:${area.id}` }, score, logged: false });
    }
  }

  for (const tag of Object.values(db.tags)) {
    if (tag.deletedAt !== null) continue;
    const score = scoreOf(tag.name, query);
    if (score > 0) {
      results.push({ kind: 'tag', id: tag.id, title: tag.name, detail: 'Tag', target: { view: `tag:${tag.id}` }, score, logged: false });
    }
  }

  for (const project of Object.values(db.projects)) {
    if (project.deletedAt !== null && !includeTrash) continue;
    const closed = project.status !== 'open';
    if (closed && !searchAll) continue;
    let score = scoreOf(project.title, query);
    let detail: string | null = project.areaId ? db.areas[project.areaId]?.title ?? 'Project' : 'Project';
    if (score === 0 && searchAll && project.notes.toLowerCase().includes(query)) {
      score = 25;
      detail = 'Matched in notes';
    }
    if (score > 0) {
      results.push({
        kind: 'project', id: project.id, title: project.title, detail,
        target: { view: `project:${project.id}` }, score, logged: closed,
      });
    }
  }

  for (const heading of Object.values(db.headings)) {
    if (heading.deletedAt !== null && !includeTrash) continue;
    const score = scoreOf(heading.title, query);
    if (score > 0) {
      const project = db.headings[heading.id] ? db.projects[heading.projectId] : undefined;
      results.push({
        kind: 'heading', id: heading.id, title: heading.title,
        detail: project ? `Heading in ${project.title}` : 'Heading',
        target: { view: `project:${heading.projectId}`, openId: heading.id }, score, logged: false,
      });
    }
  }

  // Checklist rows only participate in the extended scope.
  const checklistHits = new Map<string, string>();
  if (searchAll) {
    for (const item of Object.values(db.checklistItems)) {
      if (item.deletedAt !== null) continue;
      if (item.text.toLowerCase().includes(query) && !checklistHits.has(item.taskId)) {
        checklistHits.set(item.taskId, item.text);
      }
    }
  }

  for (const task of Object.values(db.tasks)) {
    if (task.deletedAt !== null && !includeTrash) continue;
    const closed = task.status !== 'open';
    if (closed && !searchAll) continue;
    let score = scoreOf(task.title, query);
    let detail = contextOf(db, task.id);
    if (score === 0 && searchAll) {
      if (task.notes.toLowerCase().includes(query)) {
        score = 25;
        detail = 'Matched in notes';
      } else {
        const row = checklistHits.get(task.id);
        if (row) {
          score = 20;
          detail = `Checklist: ${row}`;
        }
      }
    }
    if (score > 0) {
      results.push({
        kind: 'task', id: task.id, title: task.title, detail,
        target: { view: taskHomeView(db, task.id), openId: task.id },
        score: closed ? score - 10 : score, logged: closed,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return results.slice(0, options.limit ?? 40);
}

function contextOf(db: Database, taskId: string): string | null {
  const task = db.tasks[taskId];
  if (!task) return null;
  if (task.parentType === 'project' && task.parentId) return db.projects[task.parentId]?.title ?? null;
  if (task.parentType === 'area' && task.parentId) return db.areas[task.parentId]?.title ?? null;
  return 'Inbox';
}

/** Opening a result puts the task in context rather than in a detached result list. */
export function taskHomeView(db: Database, taskId: string): ViewKey {
  const task = db.tasks[taskId];
  if (!task) return 'inbox';
  if (task.deletedAt !== null) return 'trash';
  if (task.status !== 'open') return 'logbook';
  if (task.parentType === 'project' && task.parentId) return `project:${task.parentId}`;
  if (task.parentType === 'area' && task.parentId) return `area:${task.parentId}`;
  if (!task.processed) return 'inbox';
  return 'anytime';
}
