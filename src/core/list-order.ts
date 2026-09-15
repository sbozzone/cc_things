import type { ListDocument, ListItem } from './selectors';
import type { ListSort } from './types';

export type { ListSort } from './types';
export const priorities = { urgent: 'Urgent', timeSensitive: 'Time sensitive', high: 'High', low: 'Low' } as const;
const priorityRank = { urgent: 0, timeSensitive: 1, high: 2, low: 3 };

/** Sorting is a presentation preference: never replace the user's saved ranks. */
export function sortDocument(doc: ListDocument, sort: ListSort, tagLabel: (tagId: string) => string = (tagId) => tagId): ListDocument {
  if (sort === 'manual') return doc;
  const record = (item: ListItem) => item.kind === 'task' ? item.task : item.kind === 'project' ? item.project : null;
  const titleCompare = (a: ListItem, b: ListItem) => {
    const x = record(a), y = record(b);
    return x && y ? x.title.localeCompare(y.title, undefined, { sensitivity: 'base', numeric: true }) : 0;
  };
  const optionalCompare = (x: string | null, y: string | null, direction: 1 | -1, a: ListItem, b: ListItem) => {
    if (x === null && y === null) return titleCompare(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return direction * x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true }) || titleCompare(a, b);
  };
  const tagKey = (item: ListItem) => item.kind === 'task' || item.kind === 'project'
    ? item.meta.tagIds.map(tagLabel).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))[0] ?? null
    : null;
  const compare = (a: ListItem, b: ListItem) => {
    const x = record(a), y = record(b);
    if (!x || !y) return 0;
    if (sort === 'alphabetical') return titleCompare(a, b);
    if (sort === 'alphabeticalDesc') return -titleCompare(a, b);
    if (sort === 'due' || sort === 'dueDesc') return optionalCompare(x.deadline, y.deadline, sort === 'due' ? 1 : -1, a, b);
    if (sort === 'created' || sort === 'createdAsc') {
      return (sort === 'created' ? -1 : 1) * x.createdAt.localeCompare(y.createdAt) || titleCompare(a, b);
    }
    if (sort === 'tags' || sort === 'tagsDesc') return optionalCompare(tagKey(a), tagKey(b), sort === 'tags' ? 1 : -1, a, b);
    const px = 'priority' in x && x.priority ? priorityRank[x.priority] : 4;
    const py = 'priority' in y && y.priority ? priorityRank[y.priority] : 4;
    if (px === 4 && py === 4) return titleCompare(a, b);
    if (px === 4) return 1;
    if (py === 4) return -1;
    return (sort === 'priorityDesc' ? -1 : 1) * (px - py) || titleCompare(a, b);
  };
  const sortItems = (items: ListItem[]): ListItem[] => {
    const sortable = items.filter((item) => record(item)).sort(compare);
    let index = 0;
    return items.map((item) => {
      const next = record(item) ? sortable[index++]! : item;
      return next.kind === 'project' && next.children
        ? { ...next, children: [...next.children].sort(compare) } : next;
    });
  };
  return { ...doc, sections: doc.sections.map((section) => section.isEventSection ? section : { ...section, items: sortItems(section.items) }) };
}
