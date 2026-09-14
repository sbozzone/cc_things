import { isDateOnly } from './dates';
import { parseNaturalDate } from './natural-dates';
import type { DateOnly } from './types';

/** Resolves a date-section context without coupling the inline composer to React. */
export function resolveSectionDate(sectionDate: string | null, sectionLabel: string | null, today: DateOnly, locale = 'en-US'): DateOnly | null {
  if (sectionDate && isDateOnly(sectionDate)) return sectionDate;
  return sectionLabel ? parseNaturalDate(sectionLabel, today, locale)?.date ?? null : null;
}
