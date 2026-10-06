import { describe, expect, it } from 'vitest';
import { createArea, createProject, createTask } from '../commands';
import { ERRANDS_TAG_ID } from '../errands';
import { byErrandRank, groupErrandsDocument, isErrandsOrderingView } from '../errand-order';
import { sortDocument } from '../list-order';
import { buildIndexes, runView, type ListDocument, type ListItem, type ListSection, type TaskListItem, type ViewKey } from '../selectors';
import { Harness } from '../testing';
import type { Task } from '../types';
import { upcomingItemsForDate } from '../upcoming-print';

const target = { parentType: 'inbox' as const, parentId: null, headingId: null };
const meta: TaskListItem['meta'] = {
  contextLabel: null, heldContextLabel: null, showStartMarker: false, showDeadlineMarker: false,
  overdue: false, hold: null, repeating: false, checklistTotal: 0, checklistChecked: 0, tagIds: [],
};
const row = (id: string, title: string, rank: string, errandRank?: string, date?: string): TaskListItem => ({
  kind: 'task', id: date ? `${id}@${date}` : id,
  task: {
    id, title, rank, todayRank: rank, errandRank,
    ownerId: 'owner-1', notes: '', status: 'open', processed: true,
    ...target, planning: 'anytime', startDate: null, eveningDate: null,
    deadline: date ?? null, completedAt: null, canceledAt: null,
    createdAt: '2026-10-06T12:00:00Z', updatedAt: '2026-10-06T12:00:00Z', deletedAt: null,
  }, meta: { ...meta, tagIds: [] },
});
const event = (id: string, date: string): ListItem => ({
  kind: 'event', id: `${id}@${date}`,
  event: {
    id, ownerId: 'owner-1', providerId: 'work', calendarId: 'work', eventId: id, instanceId: id,
    title: 'Appointment', allDay: false, startDate: date, endDate: date,
    startInstant: `${date}T12:00:00Z`, endInstant: `${date}T13:00:00Z`, timeZone: 'UTC',
    sourceUrl: null, revision: null, canceled: false, lastRefreshedAt: '2026-10-06T12:00:00Z',
  },
});
const section = (id: string, items: ListItem[], title: string | null = null): ListSection => ({
  id, title, subtitle: null, date: null, items, addTarget: target,
});
const documentWith = (view: ViewKey, ...sections: ListSection[]): ListDocument => ({
  view, title: view, subtitle: null, sections,
  openCount: sections.flatMap((entry) => entry.items).filter((item) => item.kind === 'task').length,
  filtered: false, emptyMessage: '', addTarget: target,
});
const ids = (doc: ListDocument) => doc.sections.flatMap((entry) => entry.items).map((item) => item.id);

describe('Errands-first presentation', () => {
  it('collects My Day errands across projects regardless of their other tags', () => {
    const h = new Harness('2026-10-06T12:00:00Z');
    const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
    const houseId = h.run(createProject(h.db, h.ctx(), { title: 'House', areaId })).id;
    const shopId = h.run(createProject(h.db, h.ctx(), { title: 'Shop', areaId })).id;
    const ordinary = h.run(createTask(h.db, h.ctx(), {
      title: 'Clean pool', target: { ...target, parentType: 'project', parentId: houseId, myDay: true },
    })).id;
    const hardware = h.run(createTask(h.db, h.ctx(), {
      title: '@Lowe’s return clamps', target: { ...target, parentType: 'project', parentId: shopId, myDay: true },
    })).id;
    const donations = h.run(createTask(h.db, h.ctx(), {
      title: '@Goodwill donations', target: { ...target, parentType: 'project', parentId: houseId, myDay: true },
    })).id;
    h.db.tasks[hardware]!.errandRank = 'a';
    h.db.tasks[donations]!.errandRank = 'b';
    const doc = runView(h.db, buildIndexes(h.db, h.today), 'today', { todayGrouping: 'byProject' });
    for (const item of doc.sections.flatMap((entry) => entry.items)) {
      if (item.kind === 'task') item.meta.tagIds = item.id === hardware ? ['Important', 'Next day off'] : ['HoneyDo'];
    }
    const result = groupErrandsDocument(sortDocument(doc, 'tags', (tag) => tag));
    expect(result.sections[0]).toMatchObject({ id: 'errands:today', title: 'Errands', addTarget: null });
    expect(result.sections[0]!.items.map((item) => item.id)).toEqual([hardware, donations]);
    expect(ids(result)).toEqual([hardware, donations, ordinary]);
    expect(result.openCount).toBe(doc.openCount);
    expect(h.db.tasks[hardware]!.parentId).toBe(shopId);
    expect(h.db.tasks[donations]!.parentId).toBe(houseId);
  });

  it('keeps appointments before errands and Evening separate from daytime', () => {
    const appointment = { ...section('events', [event('meeting', '2026-10-06')]), isEventSection: true };
    const doc = documentWith('today', appointment,
      section('today', [row('ordinary', 'Clean pool', 'a'), row('shop', '@Hardware', 'b')]),
      section('evening', [row('movie', 'Watch movie', 'a'), row('pharmacy', '@Pharmacy', 'b')], 'This Evening'));
    const result = groupErrandsDocument(doc);
    expect(result.sections.map((entry) => [entry.id, entry.title])).toEqual([
      ['events', null], ['errands:today', 'Errands'], ['today', 'Other tasks'], ['evening', 'This Evening'],
    ]);
    expect(ids(result)).toEqual(['meeting@2026-10-06', 'shop', 'ordinary', 'pharmacy', 'movie']);
    expect(result.sections[3]!.items).not.toContain(doc.sections[1]!.items[1]);
  });

  it('preserves the selected non-errand sort while using manual route order for errands', () => {
    const doc = documentWith('allTasks', section('allTasks', [
      row('errand-a', '@Academy Sports', 'a', 'z'), row('other-z', 'Zebra', 'b'),
      row('errand-z', '@Walmart', 'c', 'a'), row('other-a', 'Apple', 'd'),
    ]));
    const original = structuredClone(doc);
    const result = groupErrandsDocument(sortDocument(doc, 'alphabetical'));
    expect(ids(result)).toEqual(['errand-z', 'errand-a', 'other-a', 'other-z']);
    expect(result.sections.map((entry) => entry.title)).toEqual(['Errands', 'Other tasks']);
    expect(result.openCount).toBe(4);
    expect(doc).toEqual(original);
    expect(groupErrandsDocument(result)).toEqual(result);
  });

  it('places errands ahead of other work within each Upcoming day and print result', () => {
    const friday = '2026-10-09';
    const saturday = '2026-10-10';
    const fridaySection = { ...section(`day:${friday}`, [
      event('friday-event', friday), row('clean', 'Clean pool', 'a', undefined, friday),
      row('store', '@Walmart', 'c', 'a', friday), row('clamps', '@Academy Sports', 'b', 'z', friday),
    ], 'Friday'), date: friday };
    const saturdaySection = { ...section(`day:${saturday}`, [row('next-day', '@Next day errand', 'a', undefined, saturday)]), date: saturday };
    const doc = documentWith('upcoming', fridaySection, saturdaySection);
    const result = groupErrandsDocument(sortDocument(doc, 'alphabetical'));
    expect(upcomingItemsForDate(result, friday).map((item) => item.id)).toEqual([
      `friday-event@${friday}`, `store@${friday}`, `clamps@${friday}`, `clean@${friday}`,
    ]);
    expect(upcomingItemsForDate(result, saturday).map((item) => item.id)).toEqual([`next-day@${saturday}`]);
    expect(result.openCount).toBe(doc.openCount);
    expect(new Set(ids(result)).size).toBe(ids(doc).length);
  });

  it('restores chronological date boundaries in late-month sections before sorting each route', () => {
    const earlier = '2026-11-12';
    const later = '2026-11-13';
    const doc = documentWith('upcoming', section('month:2026-11', [
      event('earlier-event', earlier), row('earlier-normal', 'Zulu', 'a', undefined, earlier),
      row('earlier-errand', '@Walmart', 'b', 'z', earlier), event('later-event', later),
      row('later-normal', 'Alpha', 'd', undefined, later), row('later-errand', '@Academy', 'c', 'a', later),
    ]));
    const result = groupErrandsDocument(sortDocument(doc, 'alphabetical'));
    expect(ids(result)).toEqual([
      `earlier-event@${earlier}`, `earlier-errand@${earlier}`, `earlier-normal@${earlier}`,
      `later-event@${later}`, `later-errand@${later}`, `later-normal@${later}`,
    ]);
    expect(upcomingItemsForDate(result, earlier).map((item) => item.id)).toEqual(ids(result).slice(0, 3));
    expect(upcomingItemsForDate(result, later).map((item) => item.id)).toEqual(ids(result).slice(3));
  });

  it('retains repeated Upcoming appearances on different dates rather than deduplicating tasks', () => {
    const doc = documentWith('upcoming', section('month:2026-11', [
      row('same-task', '@Pickup', 'a', 'a', '2026-11-12'),
      row('same-task', '@Pickup', 'a', 'a', '2026-11-13'),
    ]));
    const result = groupErrandsDocument(doc);
    expect(ids(result)).toEqual(['same-task@2026-11-12', 'same-task@2026-11-13']);
    expect(result.openCount).toBe(doc.openCount);
  });

  it('does not disturb project/area hierarchy, logbook, or Trash', () => {
    for (const view of ['project:project-id', 'area:area-id', 'anytime', 'logbook', 'trash', 'allProjects'] as ViewKey[]) {
      const doc = documentWith(view, section('tasks', [row('clean', 'Clean pool', 'a'), row('store', '@Store', 'b')]));
      expect(isErrandsOrderingView(view)).toBe(false);
      expect(groupErrandsDocument(doc)).toBe(doc);
    }
  });

  it('uses the smart Errands tag view as a flat manual route without adding redundant headers', () => {
    const view = `tag:${ERRANDS_TAG_ID}` as ViewKey;
    const doc = documentWith(view, section('tag', [row('a', '@Academy', 'a', 'z'), row('z', '@Walmart', 'b', 'a')]));
    expect(isErrandsOrderingView(view)).toBe(true);
    expect(ids(groupErrandsDocument(sortDocument(doc, 'alphabetical')))).toEqual(['z', 'a']);
    expect(groupErrandsDocument(doc).sections).toHaveLength(1);
    expect(groupErrandsDocument(doc).sections[0]!.title).toBeNull();
  });

  it('uses structural fallback ranks and stable task ids for route ties', () => {
    const first = row('a', '@Store', 'a').task;
    const second = row('b', '@Store', 'b').task;
    const tied = { ...second, errandRank: 'a' } as Task;
    expect(byErrandRank(first, second)).toBeLessThan(0);
    expect(byErrandRank(first, tied)).toBeLessThan(0);
    expect(byErrandRank(first, { ...first })).toBe(0);
  });
});
