import { ERRANDS_TAG_ID, isErrandTask } from './errands';
import type { ListDocument, ListItem, ListSection, TaskListItem, ViewKey } from './selectors';
import type { Task } from './types';

/** Route order is independent of both a task's parent and the chosen list sort. */
export function byErrandRank(a: Task, b: Task): number {
  const left = a.errandRank ?? a.rank;
  const right = b.errandRank ?? b.rank;
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareErrands(a: TaskListItem, b: TaskListItem): number {
  return byErrandRank(a.task, b.task);
}

function isErrandItem(item: ListItem): item is TaskListItem {
  return item.kind === 'task' && isErrandTask(item.task);
}

/** These views can reorder an errand route without changing structural ranks. */
export function isErrandsOrderingView(view: ViewKey): boolean {
  return view === 'today' || view === 'upcoming' || view === 'allTasks' || view === `tag:${ERRANDS_TAG_ID}`;
}

/** Calendar appointments retain their time order; ordinary work retains its chosen sort. */
function errandsFirst(items: ListItem[]): ListItem[] {
  const events = items.filter((item) => item.kind === 'event');
  const errands = items.filter(isErrandItem).sort(compareErrands);
  const other = items.filter((item) => item.kind !== 'event' && !isErrandItem(item));
  return [...events, ...errands, ...other];
}

function todaySections(sections: ListSection[]): ListSection[] {
  const errands = sections
    .filter((section) => !section.isEventSection && section.id !== 'evening')
    .flatMap((section) => section.items.filter(isErrandItem))
    .sort(compareErrands);
  if (errands.length === 0) {
    return sections.map((section) => section.id === 'evening'
      ? { ...section, items: errandsFirst(section.items) } : section);
  }

  const eventSections = sections.filter((section) => section.isEventSection);
  const remaining = sections
    .filter((section) => !section.isEventSection && section.id !== 'errands:today')
    .flatMap((section) => {
      if (section.id === 'evening') return [{ ...section, items: errandsFirst(section.items) }];
      const items = section.items.filter((item) => !isErrandItem(item));
      // Empty project groups have no work left to show. Keep the flat quick-add
      // section so removing its last task does not remove its input affordance.
      if (items.length === 0 && section.id !== 'today') return [];
      return [{ ...section, items, title: section.id === 'today' && items.length > 0 ? 'Other tasks' : section.title }];
    });
  return [
    ...eventSections,
    {
      id: 'errands:today', title: 'Errands', subtitle: null,
      date: sections.find((section) => section.date !== null)?.date ?? null,
      items: errands, addTarget: null,
    },
    ...remaining,
  ];
}

function upcomingSections(sections: ListSection[]): ListSection[] {
  return sections.map((section) => {
    if (!section.id.startsWith('month:')) return { ...section, items: errandsFirst(section.items) };
    const dates = new Map<string, ListItem[]>();
    const undated: ListItem[] = [];
    for (const item of section.items) {
      const date = /@(\d{4}-\d{2}-\d{2})$/.exec(item.id)?.[1];
      if (!date) { undated.push(item); continue; }
      const items = dates.get(date) ?? [];
      items.push(item);
      dates.set(date, items);
    }
    // A list-wide alphabetical/due sort must not move a late-month errand into
    // another day's route. The row suffix is also used by day-print extraction.
    const items = [...dates.keys()].sort().flatMap((date) => errandsFirst(dates.get(date)!));
    return { ...section, items: [...items, ...errandsFirst(undated)] };
  });
}

function flatSections(doc: ListDocument): ListSection[] {
  const errands = doc.sections.flatMap((section) => section.items.filter(isErrandItem)).sort(compareErrands);
  if (errands.length === 0) return doc.sections;
  if (doc.view === `tag:${ERRANDS_TAG_ID}`) {
    return doc.sections.map((section) => ({ ...section, items: errandsFirst(section.items) }));
  }
  const others = doc.sections
    .filter((section) => section.id !== 'errands:allTasks')
    .map((section) => ({
      ...section,
      title: section.items.some((item) => !isErrandItem(item)) ? 'Other tasks' : null,
      items: section.items.filter((item) => !isErrandItem(item)),
    }));
  return [
    { id: 'errands:allTasks', title: 'Errands', subtitle: null, date: null, items: errands, addTarget: null },
    ...others,
  ];
}

/**
 * Apply after sortDocument: errands always follow the saved route while ordinary
 * work continues to respect the selected sort. This is presentation only;
 * parent/heading membership, records, counts and ranks are never modified.
 */
export function groupErrandsDocument(doc: ListDocument): ListDocument {
  if (!isErrandsOrderingView(doc.view)) return doc;
  const sections = doc.view === 'today' ? todaySections(doc.sections)
    : doc.view === 'upcoming' ? upcomingSections(doc.sections) : flatSections(doc);
  return { ...doc, sections };
}
