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

/** Keep the original order while making two explicit columns as even as possible. */
export function balancedColumnSplit(rowHeights: number[]): number {
  if (rowHeights.length < 2) return rowHeights.length;
  const total = rowHeights.reduce((sum, height) => sum + height, 0);
  if (total <= 0) return Math.ceil(rowHeights.length / 2);
  let left = 0;
  let bestSplit = 1;
  let smallestDifference = Infinity;
  for (let index = 1; index < rowHeights.length; index++) {
    left += rowHeights[index - 1] ?? 0;
    const difference = Math.abs(total - 2 * left);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      bestSplit = index;
    }
  }
  return bestSplit;
}
