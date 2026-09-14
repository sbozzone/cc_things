import { describe, expect, it } from 'vitest';
import { parseIcs, toCacheRecords } from '../calendar';

const feed = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;

describe('calendar adapter (R20, R21, scenario A10)', () => {
  it('keeps two same-title instances of a repeating meeting distinct', () => {
    const text = feed([
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'DTSTAMP:20260901T090000Z',
      'DTSTART:20260908T090000Z',
      'DTEND:20260908T093000Z',
      'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
      'SUMMARY:Standup',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcs(text, '2026-09-08', '2026-09-22');
    const standups = events.filter((e) => e.title === 'Standup');
    expect(standups.map((e) => e.startDate)).toEqual(['2026-09-08', '2026-09-15', '2026-09-22']);
    // Identity, not title, is what separates them.
    expect(new Set(standups.map((e) => e.instanceId)).size).toBe(3);
    expect(new Set(standups.map((e) => e.eventId)).size).toBe(1);
  });

  it('lets a RECURRENCE-ID override replace one instance rather than adding a row', () => {
    const text = feed([
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'DTSTART:20260908T090000Z',
      'DTEND:20260908T093000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'SUMMARY:Standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'RECURRENCE-ID:20260915T090000Z',
      'DTSTART:20260915T100000Z',
      'DTEND:20260915T103000Z',
      'SUMMARY:Standup (moved)',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcs(text, '2026-09-08', '2026-09-22');
    const onThe15th = events.filter((e) => e.startDate === '2026-09-15');
    expect(onThe15th).toHaveLength(1);
    expect(onThe15th[0]?.title).toBe('Standup (moved)');
  });

  it('drops instances listed in EXDATE', () => {
    const text = feed([
      'BEGIN:VEVENT',
      'UID:gym@example.com',
      'DTSTART;VALUE=DATE:20260908',
      'DTEND;VALUE=DATE:20260909',
      'RRULE:FREQ=DAILY;INTERVAL=1',
      'EXDATE;VALUE=DATE:20260910',
      'SUMMARY:Gym',
      'END:VEVENT',
    ].join('\r\n'));

    const dates = parseIcs(text, '2026-09-08', '2026-09-11').map((e) => e.startDate);
    expect(dates).toEqual(['2026-09-08', '2026-09-09', '2026-09-11']);
  });

  it('covers every day of a multi-day all-day event', () => {
    const text = feed([
      'BEGIN:VEVENT',
      'UID:trip@example.com',
      'DTSTART;VALUE=DATE:20260910',
      'DTEND;VALUE=DATE:20260913',
      'SUMMARY:Conference',
      'END:VEVENT',
    ].join('\r\n'));

    const event = parseIcs(text, '2026-09-01', '2026-09-30')[0];
    expect(event?.allDay).toBe(true);
    expect(event?.startDate).toBe('2026-09-10');
    // DTEND is exclusive for all-day events, so the last covered day is the 12th.
    expect(event?.endDate).toBe('2026-09-12');
  });

  it('marks cancelled events rather than dropping them silently', () => {
    const text = feed([
      'BEGIN:VEVENT',
      'UID:dentist@example.com',
      'DTSTART:20260910T140000Z',
      'DTEND:20260910T150000Z',
      'STATUS:CANCELLED',
      'SUMMARY:Dentist',
      'END:VEVENT',
    ].join('\r\n'));
    expect(parseIcs(text, '2026-09-01', '2026-09-30')[0]?.canceled).toBe(true);
  });

  it('honors IANA TZIDs instead of interpreting their wall time as UTC', () => {
    const text = feed([
      'BEGIN:VEVENT', 'UID:tzid@example.com',
      'DTSTART;TZID=America/New_York:20260913T100000',
      'SUMMARY:Ten AM meeting', 'END:VEVENT',
    ].join('\r\n'));

    const event = parseIcs(text, '2026-09-01', '2026-09-30')[0];
    expect(event?.startInstant).toBe('2026-09-13T14:00:00.000Z');
    expect(event?.timeZone).toBe('America/New_York');
  });

  it('normalizes Outlook Windows TZIDs before resolving event times', () => {
    const text = feed([
      'BEGIN:VEVENT', 'UID:outlook@example.com',
      'DTSTART;TZID=Eastern Standard Time:20260913T100000',
      'SUMMARY:Outlook meeting', 'END:VEVENT',
    ].join('\r\n'));

    const event = parseIcs(text, '2026-09-01', '2026-09-30')[0];
    expect(event?.startInstant).toBe('2026-09-13T14:00:00.000Z');
    expect(event?.timeZone).toBe('America/New_York');
  });

  it('treats a floating feed time as local to the planning timezone', () => {
    const text = feed([
      'BEGIN:VEVENT', 'UID:floating@example.com', 'DTSTART:20260913T100000',
      'SUMMARY:Local meeting', 'END:VEVENT',
    ].join('\r\n'));

    const event = parseIcs(text, '2026-09-01', '2026-09-30', 'America/New_York')[0];
    expect(event?.startInstant).toBe('2026-09-13T14:00:00.000Z');
  });

  it('builds cache ids from provider identity so a reconnect refreshes in place', () => {
    const text = feed([
      'BEGIN:VEVENT', 'UID:a@example.com', 'DTSTART:20260910T140000Z', 'SUMMARY:One', 'END:VEVENT',
    ].join('\r\n'));
    const first = toCacheRecords(parseIcs(text, '2026-09-01', '2026-09-30'), 'owner', 'ics', 'cal-1', '2026-09-09T00:00:00Z');
    const second = toCacheRecords(parseIcs(text, '2026-09-01', '2026-09-30'), 'owner', 'ics', 'cal-1', '2026-09-09T00:05:00Z');
    expect(first[0]?.id).toBe(second[0]?.id);
  });

  it('unfolds wrapped lines', () => {
    const text = feed([
      'BEGIN:VEVENT', 'UID:long@example.com', 'DTSTART;VALUE=DATE:20260910',
      'SUMMARY:A very long title that the', ' \tprovider wrapped', 'END:VEVENT',
    ].join('\r\n'));
    expect(parseIcs(text, '2026-09-01', '2026-09-30')[0]?.title).toBe('A very long title that the\tprovider wrapped');
  });
});
