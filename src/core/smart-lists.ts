import type { Database, LifecycleStatus, Task } from './types';
import type { DateOnly } from './types';

export type SmartPredicate =
  | { kind: 'all' }
  | { kind: 'status'; value: LifecycleStatus }
  | { kind: 'due'; value: 'today' | 'overdue' | 'hasDeadline' }
  | { kind: 'priority'; value: NonNullable<Task['priority']>[] }
  | { kind: 'area'; areaId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'and' | 'or'; rules: SmartPredicate[] }
  | { kind: 'not'; rule: SmartPredicate };

export type SmartSort = 'manual' | 'due' | 'created' | 'priority';
export interface SmartListRule { predicate: SmartPredicate; sort: SmartSort }

/** A side-effect-free Smart List query layer suitable for views, widgets and tests. */
export function evaluateSmartList(db: Database, today: DateOnly, rule: SmartListRule): Task[] {
  return Object.values(db.tasks)
    .filter((task) => task.deletedAt === null && matches(db, today, task, rule.predicate))
    .sort(compare(rule.sort));
}

function matches(db: Database, today: DateOnly, task: Task, predicate: SmartPredicate): boolean {
  switch (predicate.kind) {
    case 'all': return true;
    case 'status': return task.status === predicate.value;
    case 'due': return predicate.value === 'today' ? task.deadline === today
      : predicate.value === 'overdue' ? task.deadline !== null && task.deadline < today
        : task.deadline !== null;
    case 'priority': return task.priority !== null && task.priority !== undefined && predicate.value.includes(task.priority);
    case 'area': return task.parentType === 'area' && task.parentId === predicate.areaId
      || task.parentType === 'project' && task.parentId !== null && db.projects[task.parentId]?.areaId === predicate.areaId;
    case 'project': return task.parentType === 'project' && task.parentId === predicate.projectId;
    case 'and': return predicate.rules.every((rule) => matches(db, today, task, rule));
    case 'or': return predicate.rules.some((rule) => matches(db, today, task, rule));
    case 'not': return !matches(db, today, task, predicate.rule);
  }
}

const priorityRank: Record<NonNullable<Task['priority']>, number> = { urgent: 0, timeSensitive: 1, high: 2, low: 3 };
function compare(sort: SmartSort): (a: Task, b: Task) => number {
  if (sort === 'due') return (a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.rank.localeCompare(b.rank);
  if (sort === 'created') return (a, b) => b.createdAt.localeCompare(a.createdAt);
  if (sort === 'priority') return (a, b) => (a.priority ? priorityRank[a.priority] : 4) - (b.priority ? priorityRank[b.priority] : 4) || a.rank.localeCompare(b.rank);
  return (a, b) => a.rank.localeCompare(b.rank);
}

export const SMART_LISTS: Record<'overdue' | 'priority', { title: string; rule: SmartListRule }> = {
  overdue: { title: 'Overdue', rule: { predicate: { kind: 'and', rules: [{ kind: 'status', value: 'open' }, { kind: 'due', value: 'overdue' }] }, sort: 'due' } },
  priority: { title: 'High Priority', rule: { predicate: { kind: 'and', rules: [{ kind: 'status', value: 'open' }, { kind: 'priority', value: ['urgent', 'timeSensitive', 'high'] }] }, sort: 'priority' } },
};
