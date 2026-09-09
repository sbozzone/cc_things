/**
 * Every date-dependent rule reads the current moment through this interface so that
 * tests can pin the clock and the planning zone (spec §6: "The date engine shall use
 * an injectable clock and named time zone in tests").
 */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** The account planning zone, an IANA name such as `America/New_York`. */
  timeZone(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

export function fixedClock(instant: number | string, timeZone = 'UTC'): Clock {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant;
  return { now: () => ms, timeZone: () => timeZone };
}

/** A clock that can be advanced, for multi-day and rollover tests. */
export function mutableClock(instant: number | string, timeZone = 'UTC') {
  let ms = typeof instant === 'string' ? Date.parse(instant) : instant;
  let tz = timeZone;
  return {
    now: () => ms,
    timeZone: () => tz,
    set(next: number | string) {
      ms = typeof next === 'string' ? Date.parse(next) : next;
    },
    advanceDays(days: number) {
      ms += days * 86_400_000;
    },
    setTimeZone(next: string) {
      tz = next;
    },
  };
}
