import { describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import {
  createNextEarly, createTemplate, datesInRange, generateDueOccurrences, materialize,
  nextDateAfter, onOccurrenceCanceled, onOccurrenceCompleted, onOccurrenceReopened,
  pauseTemplate, previewNext, resumeTemplate, skipOccurrence, updateTemplate,
} from '../recurrence';
import { setTaskStatus } from '../commands';
import { buildIndexes, runView } from '../selectors';
import type { RepeatRule, RepeatSnapshot } from '../types';

const snapshot = (title: string, checklist: string[] = []): RepeatSnapshot => ({
  title, notes: '', parentType: 'inbox', parentId: null, headingId: null, areaId: null,
  tagIds: [], checklist: checklist.map((text) => ({ text })),
});

function makeTemplate(h: Harness, rule: RepeatRule, anchor: string, extra: Partial<Parameters<typeof createTemplate>[1]> = {}) {
  return h.run(createTemplate(h.ctx(), {
    entityKind: 'task', snapshot: snapshot('Recurring'), rule, anchorDate: anchor, ...extra,
  })).id;
}

const openTitles = (h: Harness) =>
  Object.values(h.db.tasks).filter((t) => t.deletedAt === null).map((t) => t.startDate).sort();

describe('rule dates', () => {
  it('walks fixed weekly schedules', () => {
    const rule: RepeatRule = { type: 'everyNWeeks', interval: 1, weekdays: [1] }; // Mondays
    expect(datesInRange(rule, '2026-09-07', '2026-09-07', '2026-09-30'))
      .toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  });

  it('keeps a day-31 monthly rule anchored, using each month final day when needed', () => {
    const rule: RepeatRule = { type: 'dayOfMonth', interval: 1, dayOfMonth: 31 };
    expect(datesInRange(rule, '2026-01-31', '2026-01-31', '2026-05-31'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('keeps a February 29 yearly rule, falling back to the 28th in non-leap years', () => {
    const rule: RepeatRule = { type: 'everyNYears', interval: 1 };
    expect(datesInRange(rule, '2028-02-29', '2028-02-29', '2032-12-31'))
      .toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('finds ordinal weekday occurrences', () => {
    const rule: RepeatRule = { type: 'ordinalWeekday', interval: 1, weekdays: [2], ordinal: -1 };
    expect(datesInRange(rule, '2026-09-01', '2026-09-01', '2026-11-30'))
      .toEqual(['2026-09-29', '2026-10-27', '2026-11-24']);
  });

  it('stops at an end date', () => {
    const rule: RepeatRule = { type: 'everyNDays', interval: 3 };
    expect(nextDateAfter(rule, '2026-09-08', '2026-09-11', '2026-09-12')).toBeNull();
  });
});

describe('generation (R17, R18, scenario A06)', () => {
  it('keeps producing Monday copies even while a prior copy is still open', () => {
    const h = new Harness('2026-09-07T09:00:00Z'); // a Monday
    makeTemplate(h, { type: 'everyNWeeks', interval: 1, weekdays: [1] }, '2026-09-07');
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual(['2026-09-07']);

    h.advanceDays(7); // next Monday, prior copy still open
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual(['2026-09-07', '2026-09-14']);
  });

  it('creates every missed occurrence once after several days away', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    makeTemplate(h, { type: 'everyNDays', interval: 1 }, '2026-09-08');
    h.apply(generateDueOccurrences(h.db, h.ctx()));

    h.advanceDays(4); // the app was closed for four days
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']);

    // Running generation again changes nothing.
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toHaveLength(5);
  });

  it('skips paused intervals and resumes at the next eligible occurrence', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'everyNDays', interval: 1 }, '2026-09-08');
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    h.apply(pauseTemplate(h.db, h.ctx(), id));

    h.advanceDays(5);
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual(['2026-09-08']); // nothing generated while paused

    h.apply(resumeTemplate(h.db, h.ctx(), id));
    h.advanceDays(1);
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual(['2026-09-08', '2026-09-14']); // no back-fill
  });

  it('does not regenerate an occurrence created early', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'everyNDays', interval: 7 }, '2026-09-08');
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    h.apply(createNextEarly(h.db, h.ctx(), id));
    expect(openTitles(h)).toEqual(['2026-09-08', '2026-09-15']);

    h.advanceDays(7); // its scheduled date arrives
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual(['2026-09-08', '2026-09-15']);
  });

  it('skipping one fixed copy affects only that occurrence', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'everyNDays', interval: 1 }, '2026-09-08');
    h.apply(skipOccurrence(h.db, h.ctx(), id, '2026-09-08'));
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual([]);

    h.advanceDays(1);
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(openTitles(h)).toEqual(['2026-09-09']);
  });

  it('uses the occurrence date as the deadline and lead days for the start', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    makeTemplate(h, { type: 'dayOfMonth', interval: 1, dayOfMonth: 15 }, '2026-09-15', { useDeadline: true, leadDays: 7 });
    h.apply(generateDueOccurrences(h.db, h.ctx()));

    const task = Object.values(h.db.tasks)[0];
    expect(task?.startDate).toBe('2026-09-08');
    expect(task?.deadline).toBe('2026-09-15');
  });
});

describe('completion-relative series (R17)', () => {
  it('starts the next interval from the actual completion date', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'afterCompletion', interval: 7 }, '2026-09-08');
    h.run(materialize(h.db, h.ctx(), h.db.repeatTemplates[id]!, '2026-09-08'));

    const first = Object.values(h.db.tasks)[0]!;
    h.setInstant('2026-09-11T17:00:00Z'); // finished on the Friday
    h.apply(setTaskStatus(h.db, h.ctx(), first.id, 'completed'));
    h.apply(onOccurrenceCompleted(h.db, h.ctx(), first.id, '2026-09-11'));

    const next = Object.values(h.db.tasks).find((t) => t.id !== first.id);
    expect(next?.startDate).toBe('2026-09-18'); // the following Friday
  });

  it('never generates a second copy when a completion is replayed', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'afterCompletion', interval: 3 }, '2026-09-08');
    h.run(materialize(h.db, h.ctx(), h.db.repeatTemplates[id]!, '2026-09-08'));
    const first = Object.values(h.db.tasks)[0]!;

    h.apply(onOccurrenceCompleted(h.db, h.ctx(), first.id, '2026-09-08'));
    h.apply(onOccurrenceCompleted(h.db, h.ctx(), first.id, '2026-09-08'));
    h.apply(onOccurrenceCompleted(h.db, h.ctx(), first.id, '2026-09-08'));
    expect(Object.values(h.db.tasks).filter((t) => t.deletedAt === null)).toHaveLength(2);
  });

  it('retracts an untouched next copy when the completion is undone', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'afterCompletion', interval: 3 }, '2026-09-08');
    h.run(materialize(h.db, h.ctx(), h.db.repeatTemplates[id]!, '2026-09-08'));
    const first = Object.values(h.db.tasks)[0]!;
    h.apply(onOccurrenceCompleted(h.db, h.ctx(), first.id, '2026-09-08'));

    h.apply(onOccurrenceReopened(h.db, h.ctx(), first.id));
    expect(Object.values(h.db.tasks).filter((t) => t.deletedAt === null)).toHaveLength(1);
  });

  it('keeps an edited next copy and flags it for review', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'afterCompletion', interval: 3 }, '2026-09-08');
    h.run(materialize(h.db, h.ctx(), h.db.repeatTemplates[id]!, '2026-09-08'));
    const first = Object.values(h.db.tasks)[0]!;
    h.apply(onOccurrenceCompleted(h.db, h.ctx(), first.id, '2026-09-08'));

    const generated = Object.values(h.db.tasks).find((t) => t.id !== first.id)!;
    h.advanceDays(1);
    h.apply([{ table: 'tasks', id: generated.id, patch: { notes: 'edited', updatedAt: h.ctx().now } }]);

    h.apply(onOccurrenceReopened(h.db, h.ctx(), first.id));
    expect(h.db.tasks[generated.id]?.deletedAt).toBeNull();
    const link = Object.values(h.db.occurrenceLinks).find((l) => l.generatedFrom === first.id);
    expect(link?.needsReview).toBe(true);
  });

  it('pauses the series when a completion-relative copy is canceled', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'afterCompletion', interval: 3 }, '2026-09-08');
    h.run(materialize(h.db, h.ctx(), h.db.repeatTemplates[id]!, '2026-09-08'));
    const first = Object.values(h.db.tasks)[0]!;

    h.apply(setTaskStatus(h.db, h.ctx(), first.id, 'canceled'));
    h.apply(onOccurrenceCanceled(h.db, h.ctx(), first.id));
    expect(h.db.repeatTemplates[id]?.pausedAt).not.toBeNull();
  });
});

describe('templates and copies (R18)', () => {
  it('leaves historical copies untouched when the template checklist changes', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = h.run(createTemplate(h.ctx(), {
      entityKind: 'task', snapshot: snapshot('Bins', ['Kitchen', 'Garage']),
      rule: { type: 'everyNDays', interval: 7 }, anchorDate: '2026-09-08',
    })).id;
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    const historical = Object.values(h.db.checklistItems).map((c) => c.text).sort();
    expect(historical).toEqual(['Garage', 'Kitchen']);

    h.apply(updateTemplate(h.db, h.ctx(), id, { snapshot: snapshot('Bins', ['Kitchen', 'Garage', 'Recycling']) }));
    expect(Object.values(h.db.checklistItems).map((c) => c.text).sort()).toEqual(['Garage', 'Kitchen']);

    h.advanceDays(7);
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    expect(Object.values(h.db.checklistItems)).toHaveLength(5);
  });

  it('previews the next three dates without creating anything', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'everyNWeeks', interval: 2, weekdays: [3] }, '2026-09-09');
    const before = Object.keys(h.db.tasks).length;
    expect(previewNext(h.db.repeatTemplates[id]!, '2026-09-08')).toEqual(['2026-09-09', '2026-09-23', '2026-10-07']);
    expect(Object.keys(h.db.tasks)).toHaveLength(before);
  });
});

describe('Upcoming recurrence previews', () => {
  it('shows future fixed occurrences without creating task records', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    makeTemplate(h, { type: 'everyNDays', interval: 7 }, '2026-09-08');
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    const taskCount = Object.keys(h.db.tasks).length;

    const doc = runView(h.db, buildIndexes(h.db, h.today), 'upcoming');
    const previews = doc.sections.flatMap((section) => section.items)
      .filter((item) => item.kind === 'repeatPreview');

    expect(previews[0]?.preview.startDate).toBe('2026-09-15');
    expect(previews[0]?.preview.title).toBe('Recurring');
    expect(Object.keys(h.db.tasks)).toHaveLength(taskCount);
  });

  it('does not duplicate an occurrence that was created early', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    const id = makeTemplate(h, { type: 'everyNDays', interval: 7 }, '2026-09-08');
    h.apply(generateDueOccurrences(h.db, h.ctx()));
    h.apply(createNextEarly(h.db, h.ctx(), id));

    const doc = runView(h.db, buildIndexes(h.db, h.today), 'upcoming');
    const september15 = doc.sections.find((section) => section.date === '2026-09-15');

    expect(september15?.items.filter((item) => item.kind === 'task')).toHaveLength(1);
    expect(september15?.items.filter((item) => item.kind === 'repeatPreview')).toHaveLength(0);
  });

  it('places deadline-based previews on their lead-time start date', () => {
    const h = new Harness('2026-09-08T09:00:00Z');
    makeTemplate(
      h,
      { type: 'dayOfMonth', interval: 1, dayOfMonth: 15 },
      '2026-09-15',
      { useDeadline: true, leadDays: 3 },
    );

    const doc = runView(h.db, buildIndexes(h.db, h.today), 'upcoming');
    const preview = doc.sections.flatMap((section) => section.items)
      .find((item) => item.kind === 'repeatPreview');

    expect(preview?.kind === 'repeatPreview' ? preview.preview.startDate : null).toBe('2026-09-12');
    expect(preview?.kind === 'repeatPreview' ? preview.preview.deadline : null).toBe('2026-09-15');
  });
});
