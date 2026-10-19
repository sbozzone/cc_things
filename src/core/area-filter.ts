import type { Database, Task } from './types';
import type { ListDocument, ListItem } from './selectors';

/** Any filing destination counts, including projects without a parent area. */
export function taskIsFiled(task: Task): boolean {
  return task.parentType !== 'inbox' && Boolean(task.parentId);
}

export function withoutAreaDocument(db: Database, doc: ListDocument): ListDocument {
  const sections = doc.sections.map((section) => ({
    ...section,
    items: section.items.flatMap((item): ListItem[] => {
      if (item.kind === 'task') return taskIsFiled(item.task) ? [] : [item];
      return [];
    }),
  }));
  const openCount = sections.reduce((count, section) => count + section.items.reduce((n, item) =>
    n + (item.kind === 'task' ? 1 : item.kind === 'project' ? item.children?.length ?? 0 : 0), 0), 0);
  return { ...doc, sections, openCount, filtered: true, emptyMessage: 'No unfiled tasks match this list.' };
}
