import type { Database, Task } from './types';
import type { ListDocument, ListItem } from './selectors';

/** A project's area also applies to its tasks. Deleted/missing areas do not count. */
export function taskHasArea(db: Database, task: Task): boolean {
  const areaId = task.parentType === 'area' ? task.parentId
    : task.parentType === 'project' && task.parentId ? db.projects[task.parentId]?.areaId : null;
  return Boolean(areaId && db.areas[areaId]?.deletedAt === null);
}

export function withoutAreaDocument(db: Database, doc: ListDocument): ListDocument {
  const sections = doc.sections.map((section) => ({
    ...section,
    items: section.items.flatMap((item): ListItem[] => {
      if (item.kind === 'task') return taskHasArea(db, item.task) ? [] : [item];
      if (item.kind !== 'project') return [];
      if (item.project.areaId && db.areas[item.project.areaId]?.deletedAt === null) return [];
      const children = item.children?.filter((child) => !taskHasArea(db, child.task));
      return children?.length ? [{ ...item, children }] : [];
    }),
  }));
  const openCount = sections.reduce((count, section) => count + section.items.reduce((n, item) =>
    n + (item.kind === 'task' ? 1 : item.kind === 'project' ? item.children?.length ?? 0 : 0), 0), 0);
  return { ...doc, sections, openCount, filtered: true, emptyMessage: 'No tasks without an area match this list.' };
}
