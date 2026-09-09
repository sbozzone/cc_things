import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, addYears, compareDates, daysBetween, daysInMonth,
  formatDateLabel, isDateOnly, nthWeekdayOfMonth, resolveInstant, todayIn, weekdayOf,
} from '../dates';

describe('date-only values', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isDateOnly('2026-09-08')).toBe(true);
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-9-8')).toBe(false);
  });

  it('orders chronologically by string comparison', () => {
    expect(compareDates('2026-09-08', '2026-09-15')).toBe(-1);
    expect(daysBetween('2026-09-10', '2026-09-15')).toBe(5);
  });
});

describe('planning day', () => {
  // The planning day comes from the account zone, not the device's UTC clock (spec §6).
  it('resolves the account planning day, not UTC', () => {
    const instant = Date.parse('2026-09-09T02:00:00Z');
    expect(todayIn('America/New_York', instant)).toBe('2026-09-08');
    expect(todayIn('UTC', instant)).toBe('2026-09-09');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-09-09');
  });

  it('does not shift a date-only value across zones', () => {
    // A September 10 deadline stays September 10 when viewed from another device.
    const deadline = '2026-09-10';
    expect(addDays(deadline, 0)).toBe('2026-09-10');
  });
});

describe('calendar arithmetic', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('clamps a day-31 monthly rule to the final day of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('uses February 28 for a February 29 yearly rule in a non-leap year', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
  });

  it('finds ordinal weekdays including the last one', () => {
    expect(nthWeekdayOfMonth(2026, 9, 2, 2)).toBe('2026-09-08'); // 2nd Tuesday
    expect(nthWeekdayOfMonth(2026, 9, 3, -1)).toBe('2026-09-30'); // last Wednesday
    expect(weekdayOf('2026-09-08')).toBe(2);
  });
});

describe('reminder instants across daylight saving transitions', () => {
  const tz = 'America/New_York';

  it('resolves an ordinary wall time', () => {
    const r = resolveInstant('2026-09-10', '09:00', tz);
    expect(r.instant).toBe('2026-09-10T13:00:00.000Z');
    expect(r.adjustment).toBe('none');
  });

  it('moves a nonexistent spring-forward time to the next valid local time', () => {
    // 2026-03-08: local clocks jump 02:00 -> 03:00, so 02:30 never happens.
    const r = resolveInstant('2026-03-08', '02:30', tz);
    expect(r.adjustment).toBe('nonexistent');
    expect(r.instant).toBe('2026-03-08T07:00:00.000Z'); // 03:00 EDT
  });

  it('uses the first occurrence of an ambiguous fall-back time, once', () => {
    // 2026-11-01: local 01:30 happens twice; the earlier (EDT) instant wins.
    const r = resolveInstant('2026-11-01', '01:30', tz);
    expect(r.adjustment).toBe('ambiguous');
    expect(r.instant).toBe('2026-11-01T05:30:00.000Z');
  });

  it('keeps a stored zone independent of the running process', () => {
    const tokyo = resolveInstant('2026-09-10', '09:00', 'Asia/Tokyo');
    expect(tokyo.instant).toBe('2026-09-10T00:00:00.000Z');
  });
});

describe('labels', () => {
  it('names nearby days', () => {
    expect(formatDateLabel('2026-09-08', '2026-09-08')).toBe('Today');
    expect(formatDateLabel('2026-09-09', '2026-09-08')).toBe('Tomorrow');
    expect(formatDateLabel('2026-09-11', '2026-09-08')).toBe('Friday');
    expect(formatDateLabel('2026-10-20', '2026-09-08')).toBe('Oct 20');
    expect(formatDateLabel('2027-01-04', '2026-09-08')).toBe('Jan 4, 2027');
  });
});
