/**
 * Fractional indexing for ordering (R25).
 *
 * Ranks are base-62 strings compared lexicographically. Inserting between two rows
 * mints a new key without renumbering neighbours, so two offline devices can each
 * insert into the same list and the server can serialize both placements without
 * either move clobbering the other (R34, "rebase each placement against surviving
 * neighbours").
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const MAX_DEPTH = 120;

function digitAt(s: string, i: number): number {
  const ch = s[i];
  if (ch === undefined) return -1;
  const v = DIGITS.indexOf(ch);
  if (v < 0) throw new Error(`invalid rank character: ${ch}`);
  return v;
}

/**
 * Returns a key strictly between `a` and `b`. `null` means unbounded on that side.
 * Throws when the bounds are not strictly increasing, which would otherwise loop.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`rank bounds out of order: ${a} >= ${b}`);
  }
  let result = '';
  for (let i = 0; i < MAX_DEPTH; i++) {
    const lo = a === null ? 0 : Math.max(digitAt(a, i), 0);
    const hi = b === null ? BASE : (digitAt(b, i) === -1 ? BASE : digitAt(b, i));
    if (hi - lo > 1) return result + DIGITS[Math.floor((lo + hi) / 2)];
    // No gap at this digit: keep the shared prefix and look one digit deeper.
    result += DIGITS[lo];
  }
  throw new Error('rank depth exceeded');
}

/** Mints `count` evenly spaced keys after `after` and before `before`. */
export function keysBetween(after: string | null, before: string | null, count: number): string[] {
  const out: string[] = [];
  let lo = after;
  for (let i = 0; i < count; i++) {
    const key = keyBetween(lo, before);
    out.push(key);
    lo = key;
  }
  return out;
}

export const FIRST_RANK = keyBetween(null, null);

/** Sorts by rank, then by id so that equal ranks from two devices still order deterministically. */
export function byRank<T extends { rank: string; id: string }>(a: T, b: T): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
