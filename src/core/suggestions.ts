import { weekdayOf } from './dates';
import type { Database, DateOnly, Instant, Task } from './types';

export type SuggestionReason = 'dueToday' | 'overdue' | 'recentInbox' | 'habitual';
export interface TaskSuggestion { task: Task; reason: SuggestionReason; score: number }

/**
 * Pure My Day recommendation engine. It ranks existing tasks without updating them,
 * which keeps the policy independently testable and usable by any presentation layer.
 */
export function taskSuggestions(db: Database, today: DateOnly, limit = 5, now: Instant = new Date().toISOString()): TaskSuggestion[] {
  const open = Object.values(db.tasks).filter((task) =>
    task.deletedAt === null && task.status === 'open' && task.isInToday !== true);
  const history = Object.values(db.tasks).filter((task) =>
    task.deletedAt === null && task.status === 'completed' && task.completedAt !== null);
  const targetWeekday = weekdayOf(today);

  const scored = open.map((task): TaskSuggestion | null => {
    if (task.deadline === today) return { task, reason: 'dueToday', score: 400 };
    if (task.deadline !== null && task.deadline < today) return { task, reason: 'overdue', score: 300 };
    if (isRecentInbox(task, now)) return { task, reason: 'recentInbox', score: 200 };
    if (isHabitual(task, history, targetWeekday)) return { task, reason: 'habitual', score: 100 };
    return null;
  }).filter((row): row is TaskSuggestion => row !== null);

  return scored.sort((a, b) => b.score - a.score || (a.task.deadline ?? '9999').localeCompare(b.task.deadline ?? '9999') || a.task.rank.localeCompare(b.task.rank)).slice(0, limit);
}

/** The supplied brief defines this as Inbox work created in the preceding 48 hours. */
function isRecentInbox(task: Task, now: Instant): boolean {
  if (task.parentType !== 'inbox' || task.processed) return false;
  const age = Date.parse(now) - Date.parse(task.createdAt);
  return age >= 0 && age <= 48 * 60 * 60 * 1000;
}

function normalize(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function isHabitual(task: Task, history: Task[], targetWeekday: number): boolean {
  const title = normalize(task.title);
  if (!title) return false;
  const candidates = history.filter((past) => normalize(past.title) === title || (
    task.parentType === 'project' && task.parentId !== null && past.parentType === 'project' && past.parentId === task.parentId
  ));
  if (candidates.length < 2) return false;
  const onWeekday = candidates.filter((past) => past.completedAt !== null && weekdayOf(past.completedAt.slice(0, 10)) === targetWeekday).length;
  return onWeekday >= 2 && onWeekday > candidates.length / 7;
}
