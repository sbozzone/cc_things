import { addDays, isDateOnly, makeDate, weekdayOf } from './dates';
import type { DateOnly } from './types';

/**
 * English natural date entry (R16).
 *
 * Parsing never mutates anything on its own: the caller shows the resolved date, time
 * and zone as a preview, and unsupported or ambiguous text prompts a selection instead.
 */

export interface ParsedDate {
  date: DateOnly;
  /** `HH:mm` when the phrase carried a time. */
  time: string | null;
  /** What the parser understood, echoed back in the preview. */
  interpretation: string;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function parseTime(text: string): { time: string; rest: string } | null {
  const m = /(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|(?:\bat\s+)\b(\d{1,2}):(\d{2})\b/i.exec(text);
  if (!m) return null;
  let hour: number;
  let minute: number;
  if (m[3]) {
    hour = Number(m[1]);
    minute = Number(m[2] ?? 0);
    const pm = m[3].toLowerCase() === 'pm';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  } else {
    hour = Number(m[4]);
    minute = Number(m[5]);
  }
  if (hour > 23 || minute > 59) return null;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { time, rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim() };
}

/**
 * Resolves a phrase against the planning day. Numeric dates follow the locale, so
 * `03/04` differs between `en-US` and `en-GB` — the caller shows the preview either way.
 */
export function parseNaturalDate(input: string, today: DateOnly, locale = 'en-US'): ParsedDate | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  const timeMatch = parseTime(trimmed);
  const time = timeMatch?.time ?? null;
  const text = (timeMatch?.rest ?? trimmed).replace(/\s+/g, ' ').trim();

  const withTime = (date: DateOnly, interpretation: string): ParsedDate => ({ date, time, interpretation });

  if (text === '' && time) return withTime(today, 'Today');
  if (text === 'today' || text === 'tod') return withTime(today, 'Today');
  if (text === 'tomorrow' || text === 'tom' || text === 'tmr') return withTime(addDays(today, 1), 'Tomorrow');
  if (text === 'yesterday') return withTime(addDays(today, -1), 'Yesterday');

  // "in 3 days", "in 2 weeks"
  const relative = /^in (\d{1,4}) (day|days|week|weeks|month|months|year|years)$/.exec(text);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2] as string;
    const days = unit.startsWith('day') ? n : unit.startsWith('week') ? n * 7 : unit.startsWith('month') ? n * 30 : n * 365;
    return withTime(addDays(today, days), `In ${n} ${unit}`);
  }

  // "next friday", "this monday", "friday"
  const weekday = /^(next |this |on )?([a-z]+)$/.exec(text);
  if (weekday) {
    const name = weekday[2] as string;
    const target = WEEKDAYS[name];
    if (target !== undefined) {
      const qualifier = (weekday[1] ?? '').trim();
      const current = weekdayOf(today);
      let delta = (target - current + 7) % 7;
      if (delta === 0) delta = 7; // a bare weekday name always means the coming one
      if (qualifier === 'next') {
        // "next Friday" is the Friday of the following week when this week's has not passed.
        const thisWeek = delta;
        delta = thisWeek + (thisWeek <= 6 ? 7 : 0);
      }
      const label = qualifier === 'next' ? `Next ${name}` : name.charAt(0).toUpperCase() + name.slice(1);
      return withTime(addDays(today, delta), label);
    }
  }

  if (text === 'next week') return withTime(addDays(today, 7), 'Next week');
  if (text === 'next month') return withTime(addDays(today, 30), 'Next month');
  if (text === 'weekend' || text === 'this weekend') {
    const delta = (6 - weekdayOf(today) + 7) % 7 || 7;
    return withTime(addDays(today, delta), 'This weekend');
  }

  // "sep 15", "15 sep", "september 15 2027"
  const monthDay = /^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/.exec(text) ?? /^(\d{1,2}) ([a-z]+)(?:,? (\d{4}))?$/.exec(text);
  if (monthDay) {
    const first = monthDay[1] as string;
    const second = monthDay[2] as string;
    const monthName = MONTHS[first] !== undefined ? first : second;
    const dayText = MONTHS[first] !== undefined ? second : first;
    const month = MONTHS[monthName];
    if (month !== undefined) {
      const day = Number(dayText);
      const year = monthDay[3] ? Number(monthDay[3]) : Number(today.slice(0, 4));
      const candidate = makeDate(year, month, day);
      if (isDateOnly(candidate)) {
        // Without a year, a date already past means next year.
        const resolved = !monthDay[3] && candidate < today ? makeDate(year + 1, month, day) : candidate;
        return withTime(resolved, `${monthName} ${day}`);
      }
    }
  }

  // ISO
  if (isDateOnly(text)) return withTime(text, text);

  // Numeric, locale-dependent.
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const monthFirst = !locale.toLowerCase().startsWith('en-gb') && locale.toLowerCase().startsWith('en');
    const month = monthFirst ? a : b;
    const day = monthFirst ? b : a;
    let year = numeric[3] ? Number(numeric[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2000;
    const candidate = makeDate(year, month, day);
    if (isDateOnly(candidate)) {
      const resolved = !numeric[3] && candidate < today ? makeDate(year + 1, month, day) : candidate;
      return withTime(resolved, `${monthFirst ? 'month/day' : 'day/month'} — ${resolved}`);
    }
  }

  return null;
}

/** Suggestions offered when the text does not resolve, so nothing is guessed silently. */
export function dateSuggestions(today: DateOnly): { label: string; date: DateOnly }[] {
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'This weekend', date: addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7) },
    { label: 'Next week', date: addDays(today, 7) },
  ];
}
