import { describe, expect, it } from 'vitest';
import { parseNaturalDate } from '../natural-dates';

// The requirement fixes the planning date at September 8 2026 for these examples.
const TODAY = '2026-09-08'; // a Tuesday

describe('natural date entry (R16)', () => {
  it('resolves the phrases named in the requirement', () => {
    expect(parseNaturalDate('tomorrow', TODAY)?.date).toBe('2026-09-09');
    expect(parseNaturalDate('in 3 days', TODAY)?.date).toBe('2026-09-11');
    expect(parseNaturalDate('next friday', TODAY)?.date).toBe('2026-09-18');
    expect(parseNaturalDate('today', TODAY)?.date).toBe(TODAY);
  });

  it('reads a weekday plus a time', () => {
    const parsed = parseNaturalDate('friday at 9am', TODAY);
    expect(parsed?.date).toBe('2026-09-11');
    expect(parsed?.time).toBe('09:00');
  });

  it('handles 12-hour boundaries', () => {
    expect(parseNaturalDate('today at 12am', TODAY)?.time).toBe('00:00');
    expect(parseNaturalDate('today at 12pm', TODAY)?.time).toBe('12:00');
    expect(parseNaturalDate('today at 7:30pm', TODAY)?.time).toBe('19:30');
  });

  it('reads month-and-day forms and rolls a past date to next year', () => {
    expect(parseNaturalDate('sep 15', TODAY)?.date).toBe('2026-09-15');
    expect(parseNaturalDate('15 september', TODAY)?.date).toBe('2026-09-15');
    expect(parseNaturalDate('jan 4', TODAY)?.date).toBe('2027-01-04');
  });

  it('interprets numeric dates by locale', () => {
    expect(parseNaturalDate('03/04', TODAY, 'en-US')?.date).toBe('2027-03-04');
    expect(parseNaturalDate('03/04', TODAY, 'en-GB')?.date).toBe('2027-04-03');
  });

  it('returns null for text it cannot resolve rather than guessing', () => {
    expect(parseNaturalDate('sometime soonish', TODAY)).toBeNull();
    expect(parseNaturalDate('febtember 40', TODAY)).toBeNull();
    expect(parseNaturalDate('', TODAY)).toBeNull();
  });
});
