import type { Clock } from './clock';
import type { DateOnly, Instant } from './types';

/**
 * Date-only arithmetic (spec §6, "Proposed boundary policies").
 *
 * A `DateOnly` is a `YYYY-MM-DD` string and is *never* turned into UTC midnight.
 * Instants (reminder delivery) are the only values that carry a zone, and they keep
 * the zone they were authored in.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: unknown): value is DateOnly {
  return typeof value === 'string' && DATE_RE.test(value) && toUTC(value) !== null;
}

/** Parses `YYYY-MM-DD` into an epoch ms at UTC midnight — an internal arithmetic aid only. */
function toUTC(date: DateOnly): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Rejects 2026-02-30 and friends, which Date.UTC would otherwise roll over.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

function requireUTC(date: DateOnly): number {
  const ms = toUTC(date);
  if (ms === null) throw new Error(`invalid date: ${date}`);
  return ms;
}

export function makeDate(year: number, month: number, day: number): DateOnly {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: number, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset in ms such that `localWallClock = instant + offset`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

/** The planning day in the account's zone — what "Today" means (§6, planning time zone). */
export function todayIn(timeZone: string, now: number): DateOnly {
  const p = localParts(now, timeZone);
  return makeDate(p.year, p.month, p.day);
}

export function today(clock: Clock): DateOnly {
  return todayIn(clock.timeZone(), clock.now());
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const d = new Date(requireUTC(date) + days * 86_400_000);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addMonths(date: DateOnly, months: number): DateOnly {
  const ms = requireUTC(date);
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  // A 31st rule uses the month's final day when that month is shorter (spec §7).
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth + 1));
  return makeDate(targetYear, targetMonth + 1, clamped);
}

export function addYears(date: DateOnly, years: number): DateOnly {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  const y = Number(m[1]) + years;
  const mo = Number(m[2]);
  // February 29 becomes February 28 in a non-leap year, and the rule itself is unchanged.
  const day = Math.min(Number(m[3]), daysInMonth(y, mo));
  return makeDate(y, mo, day);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return daysInMonth(year, 2) === 29;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: DateOnly): number {
  return new Date(requireUTC(date)).getUTCDay();
}

export function daysBetween(from: DateOnly, to: DateOnly): number {
  return Math.round((requireUTC(to) - requireUTC(from)) / 86_400_000);
}

/** Date-only comparison. Lexicographic order on `YYYY-MM-DD` is chronological order. */
export function compareDates(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export const isBefore = (a: DateOnly, b: DateOnly): boolean => a < b;
export const isAfter = (a: DateOnly, b: DateOnly): boolean => a > b;
export const isOnOrBefore = (a: DateOnly, b: DateOnly): boolean => a <= b;

export function startOfMonth(date: DateOnly): DateOnly {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  return makeDate(Number(m[1]), Number(m[2]), 1);
}

/** The `ordinal`-th `weekday` of a month; `ordinal === -1` means the last one. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): DateOnly {
  if (ordinal === -1) {
    const last = daysInMonth(year, month);
    const lastDow = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
    return makeDate(year, month, last - ((lastDow - weekday + 7) % 7));
  }
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (ordinal - 1) * 7;
  const max = daysInMonth(year, month);
  return makeDate(year, month, Math.min(day, max));
}

export type ReminderAdjustment = 'none' | 'nonexistent' | 'ambiguous';

export interface ResolvedInstant {
  instant: Instant;
  epochMs: number;
  /**
   * `nonexistent` — the wall time is inside a spring-forward gap, so the next valid
   * local time was used. `ambiguous` — it occurs twice in a fall-back, so the first
   * occurrence was used, once (spec §8, delivery policy).
   */
  adjustment: ReminderAdjustment;
}

/**
 * Resolves a wall time on a calendar date in a named zone into a delivery instant.
 * The wall time, the zone and the resolved instant are all stored (R19).
 */
export function resolveInstant(date: DateOnly, wallTime: string, timeZone: string): ResolvedInstant {
  const dm = DATE_RE.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(wallTime);
  if (!dm || !tm) throw new Error(`invalid reminder time: ${date} ${wallTime}`);
  const target = Date.UTC(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
  );

  // Sample the zone on both sides of the wall time so that a transition within the day
  // yields both the pre- and post-transition candidate instants.
  const offsets = new Set<number>();
  for (const probe of [target - 86_400_000, target, target + 86_400_000]) {
    offsets.add(zoneOffsetMs(probe, timeZone));
  }
  const candidateSet = new Set<number>();
  for (const offset of offsets) candidateSet.add(target - offset);
  for (const c of [...candidateSet]) candidateSet.add(target - zoneOffsetMs(c, timeZone));

  const candidates = [...candidateSet];
  const valid = candidates.filter((c) => c + zoneOffsetMs(c, timeZone) === target);

  if (valid.length === 0) {
    // Spring-forward gap: deliver at the next valid local time, which is the transition
    // itself. Binary-search the minute where the offset changes.
    let lo = Math.min(...candidates);
    let hi = Math.max(...candidates);
    const offsetAfter = zoneOffsetMs(hi, timeZone);
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (mid <= lo || mid >= hi) break;
      if (zoneOffsetMs(mid, timeZone) === offsetAfter) hi = mid;
      else lo = mid;
    }
    return { instant: new Date(hi).toISOString(), epochMs: hi, adjustment: 'nonexistent' };
  }
  // A fall-back hour yields two valid instants for one wall time; take the first, once.
  const epochMs = Math.min(...valid);
  return {
    instant: new Date(epochMs).toISOString(),
    epochMs,
    adjustment: valid.length > 1 ? 'ambiguous' : 'none',
  };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function weekdayName(date: DateOnly, short = false): string {
  const n = WEEKDAY_NAMES[weekdayOf(date)] as string;
  return short ? n.slice(0, 3) : n;
}

export function monthName(date: DateOnly, short = false): string {
  const m = DATE_RE.exec(date);
  const n = MONTH_NAMES[Number(m?.[2] ?? 1) - 1] as string;
  return short ? n.slice(0, 3) : n;
}

/** Human label used across list headers and date chips. */
export function formatDateLabel(date: DateOnly, todayDate: DateOnly): string {
  const delta = daysBetween(todayDate, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const m = DATE_RE.exec(date);
  const day = Number(m?.[3] ?? 1);
  const sameYear = m?.[1] === todayDate.slice(0, 4);
  if (delta > 1 && delta < 7) return weekdayName(date);
  const base = `${monthName(date, true)} ${day}`;
  return sameYear ? base : `${base}, ${m?.[1]}`;
}

export function toInstant(ms: number): Instant {
  return new Date(ms).toISOString();
}
