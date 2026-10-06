import type { ListDocument, ListItem } from './selectors';
import type { DateOnly } from './types';

/** Upcoming keeps the next week in day sections and later dates in month sections. */
export function upcomingItemsForDate(doc: ListDocument, date: DateOnly): ListItem[] {
  if (doc.view !== 'upcoming') return [];
  const day = doc.sections.find((section) => section.id === `day:${date}`);
  if (day) return day.items;
  const month = doc.sections.find((section) => section.id === `month:${date.slice(0, 7)}`);
  return month?.items.filter((item) => item.id.endsWith(`@${date}`)) ?? [];
}

/** A US Letter page with 0.6-inch margins has 9.8 inches of usable height. */
export const PRINTABLE_LETTER_HEIGHT_PX = 9.8 * 96;

export function needsBalancedColumns(singleColumnHeightPx: number): boolean {
  // Leave a little room for browser rounding and printer margins.
  return singleColumnHeightPx > PRINTABLE_LETTER_HEIGHT_PX - 24;
}
