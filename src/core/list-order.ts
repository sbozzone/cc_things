import type { ListDocument, ListItem } from './selectors';

export type ListSort = 'manual' | 'alphabetical' | 'due' | 'created' | 'priority';
export const priorities = { urgent: 'Urgent', timeSensitive: 'Time sensitive', high: 'High', low: 'Low' } as const;
const priorityRank = { urgent: 0, timeSensitive: 1, high: 2, low: 3 };

/** Sorting is a presentation preference: never replace the user's saved ranks. */
export function sortDocument(doc: ListDocument, sort: ListSort): ListDocument {
  if (sort === 'manual') return doc;
  const record = (item: ListItem) => item.kind === 'task' ? item.task : item.kind === 'project' ? item.project : null;
  const compare = (a: ListItem, b: ListItem) => {
    const x = record(a), y = record(b);
    if (!x || !y) return 0;
    if (sort === 'alphabetical') return x.title.localeCompare(y.title, undefined, { sensitivity: 'base', numeric: true });
    if (sort === 'due') return (x.deadline ?? '9999').localeCompare(y.deadline ?? '9999');
    if (sort === 'created') return y.createdAt.localeCompare(x.createdAt);
    const px = 'priority' in x && x.priority ? priorityRank[x.priority] : 4;
    const py = 'priority' in y && y.priority ? priorityRank[y.priority] : 4;
    return px - py;
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
