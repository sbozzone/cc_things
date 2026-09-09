import { addDays, addMonths, addYears, makeDate, weekdayOf } from './dates';
import type { CalendarEvent, DateOnly } from './types';

/**
 * Read-only calendar adapter (R20, R21).
 *
 * Provider event ids, recurrence-instance ids and revision markers are all kept, so
 * deduplication is by identity rather than by title: a meeting that repeats with the
 * same name on two dates stays two events. Events are cached separately from tasks and
 * a provider change can never complete or reschedule a task.
 */

export const CACHE_STALE_MS = 5 * 60 * 1000;

export interface ParsedEvent {
  eventId: string;
  instanceId: string;
  title: string;
  allDay: boolean;
  startDate: DateOnly;
  endDate: DateOnly;
  startInstant: string | null;
  endInstant: string | null;
  timeZone: string | null;
  sourceUrl: string | null;
  revision: string | null;
  canceled: boolean;
}

interface RawProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** ICS wraps long lines; a leading space or tab continues the previous one. */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseProperty(line: string): RawProperty | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const name = (parts[0] ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
}

interface IcsDate {
  date: DateOnly;
  instant: string | null;
  allDay: boolean;
  timeZone: string | null;
}

function parseIcsDate(property: RawProperty): IcsDate | null {
  const value = property.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || property.params.VALUE === 'DATE') {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    return {
      date: makeDate(Number(m[1]), Number(m[2]), Number(m[3])),
      instant: null,
      allDay: true,
      timeZone: property.params.TZID ?? null,
    };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zulu] = m;
  const timeZone = property.params.TZID ?? (zulu ? 'UTC' : null);
  const instant = zulu
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toISOString()
    : // A floating or TZID time is treated as local to that zone; the calendar day is
      // what the planning lists need, and the exact instant only labels the row.
      new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toISOString();
  return { date: makeDate(Number(y), Number(mo), Number(d)), instant, allDay: false, timeZone };
}

const BYDAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: DateOnly | null;
  byDay: number[];
}

function parseRRule(value: string): RRule | null {
  const parts = Object.fromEntries(
    value.split(';').map((piece) => {
      const eq = piece.indexOf('=');
      return [piece.slice(0, eq).toUpperCase(), piece.slice(eq + 1)];
    }),
  ) as Record<string, string>;
  const freq = parts.FREQ as RRule['freq'] | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const untilRaw = parts.UNTIL;
  const untilMatch = untilRaw ? /^(\d{4})(\d{2})(\d{2})/.exec(untilRaw) : null;
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until: untilMatch ? makeDate(Number(untilMatch[1]), Number(untilMatch[2]), Number(untilMatch[3])) : null,
    byDay: (parts.BYDAY ?? '')
      .split(',')
      .map((token) => BYDAY_MAP[token.replace(/^[+-]?\d/, '').toUpperCase()])
      .filter((day): day is number => day !== undefined),
  };
}

/** Expands a rule inside the cached window only; the cache is deliberately bounded. */
function expand(rule: RRule, start: DateOnly, windowStart: DateOnly, windowEnd: DateOnly): DateOnly[] {
  const out: DateOnly[] = [];
  let cursor = start;
  let produced = 0;

  for (let guard = 0; guard < 1000; guard++) {
    if (cursor > windowEnd) break;
    if (rule.until && cursor > rule.until) break;
    if (rule.count !== null && produced >= rule.count) break;

    if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
      const weekStart = addDays(cursor, -weekdayOf(cursor));
      for (const day of [...rule.byDay].sort((a, b) => a - b)) {
        const date = addDays(weekStart, day);
        if (date < start) continue;
        if (rule.until && date > rule.until) break;
        if (rule.count !== null && produced >= rule.count) break;
        produced += 1;
        if (date >= windowStart && date <= windowEnd) out.push(date);
      }
      cursor = addDays(weekStart, rule.interval * 7);
      continue;
    }

    produced += 1;
    if (cursor >= windowStart) out.push(cursor);
    cursor =
      rule.freq === 'DAILY' ? addDays(cursor, rule.interval)
      : rule.freq === 'WEEKLY' ? addDays(cursor, rule.interval * 7)
      : rule.freq === 'MONTHLY' ? addMonths(cursor, rule.interval)
      : addYears(cursor, rule.interval);
  }
  return out;
}

/**
 * Parses an iCalendar feed into events within a bounded window. Overrides carried by
 * `RECURRENCE-ID` replace the generated instance rather than adding a second row.
 */
export function parseIcs(text: string, windowStart: DateOnly, windowEnd: DateOnly): ParsedEvent[] {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];
  const overrides = new Map<string, ParsedEvent>();

  let current: RawProperty[] | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current) collect(current);
      current = null;
      continue;
    }
    if (current) {
      const property = parseProperty(line);
      if (property) current.push(property);
    }
  }

  function collect(properties: RawProperty[]) {
    const find = (name: string) => properties.find((p) => p.name === name);
    const uid = find('UID')?.value.trim();
    const dtStart = find('DTSTART');
    if (!uid || !dtStart) return;

    const start = parseIcsDate(dtStart);
    if (!start) return;
    const dtEnd = find('DTEND');
    const end = dtEnd ? parseIcsDate(dtEnd) : null;
    const summary = unescapeText(find('SUMMARY')?.value ?? '(No title)');
    const canceled = (find('STATUS')?.value ?? '').toUpperCase() === 'CANCELLED';
    const revision = `${find('SEQUENCE')?.value ?? '0'}:${find('LAST-MODIFIED')?.value ?? find('DTSTAMP')?.value ?? ''}`;
    const url = find('URL')?.value?.trim() || null;
    const recurrenceId = find('RECURRENCE-ID');
    // An all-day DTEND is exclusive, so the last covered day is one earlier.
    const endDate = end
      ? start.allDay ? addDays(end.date, -1) : end.date
      : start.date;

    const base = (instanceDate: DateOnly, offsetDays: number): ParsedEvent => ({
      eventId: uid,
      instanceId: `${uid}#${instanceDate}`,
      title: summary,
      allDay: start.allDay,
      startDate: instanceDate,
      endDate: offsetDays > 0 ? addDays(instanceDate, offsetDays) : instanceDate,
      startInstant: start.instant ? shiftInstant(start.instant, instanceDate, start.date) : null,
      endInstant: end?.instant ? shiftInstant(end.instant, instanceDate, start.date) : null,
      timeZone: start.timeZone,
      sourceUrl: url,
      revision,
      canceled,
    });

    const spanDays = Math.max(0, dayDiff(start.date, endDate));

    if (recurrenceId) {
      const instance = parseIcsDate(recurrenceId);
      if (!instance) return;
      overrides.set(`${uid}#${instance.date}`, { ...base(instance.date, spanDays), instanceId: `${uid}#${instance.date}` });
      return;
    }

    const rruleProperty = find('RRULE');
    if (!rruleProperty) {
      if (endDate < windowStart || start.date > windowEnd) return;
      events.push(base(start.date, spanDays));
      return;
    }

    const rule = parseRRule(rruleProperty.value);
    if (!rule) {
      events.push(base(start.date, spanDays));
      return;
    }
    const excluded = new Set(
      properties
        .filter((p) => p.name === 'EXDATE')
        .flatMap((p) => p.value.split(',').map((v) => parseIcsDate({ ...p, value: v })?.date))
        .filter((d): d is DateOnly => Boolean(d)),
    );
    for (const date of expand(rule, start.date, windowStart, windowEnd)) {
      if (excluded.has(date)) continue;
      events.push(base(date, spanDays));
    }
  }

  // Overrides replace the generated instance with the same recurrence-instance id.
  const byInstance = new Map<string, ParsedEvent>();
  for (const event of events) byInstance.set(event.instanceId, event);
  for (const [key, override] of overrides) byInstance.set(key, override);
  return [...byInstance.values()].filter((event) => event.endDate >= windowStart && event.startDate <= windowEnd);
}

function dayDiff(from: DateOnly, to: DateOnly): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function shiftInstant(instant: string, instanceDate: DateOnly, originalDate: DateOnly): string {
  const delta = dayDiff(originalDate, instanceDate);
  return new Date(Date.parse(instant) + delta * 86_400_000).toISOString();
}

/** Turns parsed events into cache records keyed by provider identity, never by title. */
export function toCacheRecords(
  parsed: ParsedEvent[], ownerId: string, providerId: string, calendarId: string, refreshedAt: string,
): CalendarEvent[] {
  return parsed.map((event) => ({
    id: `${providerId}:${calendarId}:${event.instanceId}`,
    ownerId,
    providerId,
    calendarId,
    eventId: event.eventId,
    instanceId: event.instanceId,
    title: event.title,
    allDay: event.allDay,
    startDate: event.startDate,
    endDate: event.endDate,
    startInstant: event.startInstant,
    endInstant: event.endInstant,
    timeZone: event.timeZone,
    sourceUrl: event.sourceUrl,
    revision: event.revision,
    canceled: event.canceled,
    lastRefreshedAt: refreshedAt,
  }));
}
