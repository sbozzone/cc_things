import { describe, expect, it } from 'vitest';
import type { ListDocument, ListItem, ListSection } from '../selectors';
import { needsBalancedColumns, upcomingItemsForDate } from '../upcoming-print';

const item = (id: string): ListItem => ({ kind: 'event', id, event: {} } as ListItem);
const section = (id: string, items: ListItem[]): ListSection => ({
  id, title: id, subtitle: null, date: null, items, addTarget: null,
});
const documentWith = (...sections: ListSection[]): ListDocument => ({
  view: 'upcoming', title: 'Upcoming', subtitle: null, sections,
  openCount: 0, filtered: false, emptyMessage: '',
  addTarget: { parentType: 'inbox', parentId: null, headingId: null },
});

describe('printing one Upcoming day', () => {
  it('uses only the requested day in the seven-day window', () => {
    const friday = item('a@2026-10-09');
    const saturday = item('b@2026-10-10');
    const doc = documentWith(section('day:2026-10-09', [friday]), section('day:2026-10-10', [saturday]));
    expect(upcomingItemsForDate(doc, '2026-10-09')).toEqual([friday]);
  });

  it('extracts one date from a later month without mixing dates', () => {
    const chosen = item('task@2026-11-12');
    const doc = documentWith(section('month:2026-11', [item('event@2026-11-11'), chosen]));
    expect(upcomingItemsForDate(doc, '2026-11-12')).toEqual([chosen]);
    expect(upcomingItemsForDate(doc, '2026-11-13')).toEqual([]);
  });

  it('does not return items from another view', () => {
    const doc = { ...documentWith(section('day:2026-10-09', [item('a')])), view: 'today' as const };
    expect(upcomingItemsForDate(doc, '2026-10-09')).toEqual([]);
  });

  it('uses a second balanced column only when one column would overrun the page', () => {
    expect(needsBalancedColumns(600)).toBe(false);
    expect(needsBalancedColumns(1000)).toBe(true);
  });
});
