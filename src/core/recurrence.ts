import {
  addDays, addMonths, addYears, daysBetween, daysInMonth, makeDate, nthWeekdayOfMonth, weekdayOf,
} from './dates';
import { newId } from './ids';
import { byRank, FIRST_RANK, keyBetween } from './rank';
import { create, update, type EntityPatch, type WriteContext } from './patches';
import type {
  Database, DateOnly, OccurrenceLink, Project, RepeatRule, RepeatSnapshot, RepeatTemplate, Task,
} from './types';

/**
 * Repeating tasks and projects (R17, R18, spec §7).
 *
 * A template is never itself a task. Occurrences are separate records identified by
 * `(templateId, occurrenceKey)`, which is the uniqueness that stops two devices — or a
 * replayed queue — from generating the same copy twice.
 */

const MAX_STEPS = 4000;

/** Yields every date the rule produces, in order, starting at the anchor. */
export function* ruleDates(rule: RepeatRule, anchor: DateOnly): Generator<DateOnly> {
  const interval = Math.max(1, Math.floor(rule.interval || 1));

  switch (rule.type) {
    case 'everyNDays': {
      let d = anchor;
      for (let i = 0; i < MAX_STEPS; i++) {
        yield d;
        d = addDays(d, interval);
      }
      return;
    }
    case 'weekdays':
    case 'everyNWeeks': {
      const weeks = rule.type === 'weekdays' ? 1 : interval;
      const selected = (rule.weekdays && rule.weekdays.length > 0 ? [...rule.weekdays] : [weekdayOf(anchor)])
        .filter((w) => w >= 0 && w <= 6)
        .sort((a, b) => a - b);
      const weekStart = addDays(anchor, -weekdayOf(anchor));
      for (let k = 0; k < MAX_STEPS; k++) {
        const base = addDays(weekStart, k * weeks * 7);
        for (const wd of selected) {
          const d = addDays(base, wd);
          if (d >= anchor) yield d;
        }
      }
      return;
    }
    case 'everyNMonths': {
      // Each cycle is derived from the anchor, not from the previous clamped result, so a
      // day-31 rule returns to the 31st in months that have one.
      for (let k = 0; k < MAX_STEPS; k++) yield addMonths(anchor, k * interval);
      return;
    }
    case 'dayOfMonth': {
      const day = rule.dayOfMonth ?? Number(anchor.slice(8, 10));
      const startYear = Number(anchor.slice(0, 4));
      const startMonth = Number(anchor.slice(5, 7));
      for (let k = 0; k < MAX_STEPS; k++) {
        const total = startMonth - 1 + k * interval;
        const year = startYear + Math.floor(total / 12);
        const month = (total % 12) + 1;
        const d = makeDate(year, month, Math.min(day, daysInMonth(year, month)));
        if (d >= anchor) yield d;
      }
      return;
    }
    case 'ordinalWeekday': {
      const weekday = rule.weekdays?.[0] ?? weekdayOf(anchor);
      const ordinal = rule.ordinal ?? 1;
      const startYear = Number(anchor.slice(0, 4));
      const startMonth = Number(anchor.slice(5, 7));
      for (let k = 0; k < MAX_STEPS; k++) {
        const total = startMonth - 1 + k * interval;
        const year = startYear + Math.floor(total / 12);
        const month = (total % 12) + 1;
        const d = nthWeekdayOfMonth(year, month, weekday, ordinal);
        if (d >= anchor) yield d;
      }
      return;
    }
    case 'everyNYears': {
      for (let k = 0; k < MAX_STEPS; k++) yield addYears(anchor, k * interval);
      return;
    }
    case 'afterCompletion':
      // Completion-relative series have no calendar schedule; the next date is derived
      // from the actual completion date instead.
      return;
  }
}

export function nextDateAfter(rule: RepeatRule, anchor: DateOnly, after: DateOnly, endDate: DateOnly | null = null): DateOnly | null {
  for (const d of ruleDates(rule, anchor)) {
    if (endDate !== null && d > endDate) return null;
    if (d > after) return d;
  }
  return null;
}

export function datesInRange(rule: RepeatRule, anchor: DateOnly, from: DateOnly, to: DateOnly, endDate: DateOnly | null = null): DateOnly[] {
  const out: DateOnly[] = [];
  for (const d of ruleDates(rule, anchor)) {
    if (d > to) break;
    if (endDate !== null && d > endDate) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The next three applicable dates, shown in the recurrence editor. Preview creates nothing. */
export function previewNext(template: RepeatTemplate, after: DateOnly, count = 3): DateOnly[] {
  if (template.rule.type === 'afterCompletion') {
    // Only the next one is knowable; the rest depend on when each copy is finished.
    const next = addDays(after, Math.max(1, template.rule.interval));
    return [next];
  }
  const out: DateOnly[] = [];
  let cursor = after;
  for (let i = 0; i < count; i++) {
    const next = nextDateAfter(template.rule, template.anchorDate, cursor, template.endDate);
    if (next === null) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/**
 * With a recurrence deadline enabled, the occurrence date is the deadline and the start
 * is that date minus the lead days. Otherwise the occurrence date is the start (§7).
 */
export function occurrenceDates(template: RepeatTemplate, occurrenceDate: DateOnly): { startDate: DateOnly; deadline: DateOnly | null } {
  if (template.useDeadline) {
    return { startDate: addDays(occurrenceDate, -Math.max(0, template.leadDays)), deadline: occurrenceDate };
  }
  return { startDate: occurrenceDate, deadline: null };
}

export function linksFor(db: Database, templateId: string): OccurrenceLink[] {
  return Object.values(db.occurrenceLinks).filter((l) => l.templateId === templateId && l.deletedAt === null);
}

export function hasOccurrence(db: Database, templateId: string, occurrenceKey: string): boolean {
  return linksFor(db, templateId).some((l) => l.occurrenceKey === occurrenceKey);
}

function checklistPatches(ctx: WriteContext, taskId: string, snapshot: RepeatSnapshot): EntityPatch[] {
  const patches: EntityPatch[] = [];
  let cursor: string | null = null;
  for (const row of snapshot.checklist) {
    const rank: string = cursor === null ? FIRST_RANK : keyBetween(cursor, null);
    cursor = rank;
    const id = newId();
    patches.push(create('checklistItems', id, {
      id, ownerId: ctx.ownerId, taskId, text: row.text, checked: false, rank,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    }));
  }
  return patches;
}

function tagPatches(ctx: WriteContext, targetId: string, snapshot: RepeatSnapshot, targetType: 'task' | 'project'): EntityPatch[] {
  return snapshot.tagIds.map((tagId) => {
    const id = newId();
    return create('tagAssignments', id, {
      id, ownerId: ctx.ownerId, tagId, targetType, targetId,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    });
  });
}

export interface MaterializeResult {
  patches: EntityPatch[];
  /** The task or project id created for this occurrence. */
  materializedId: string | null;
}

/** Creates one occurrence with fresh ids and reset completion state. */
export function materialize(
  db: Database, ctx: WriteContext, template: RepeatTemplate, occurrenceDate: DateOnly,
  options: { occurrenceKey?: string; createdEarly?: boolean; generatedFrom?: string | null } = {},
): MaterializeResult {
  const occurrenceKey = options.occurrenceKey ?? occurrenceDate;
  if (hasOccurrence(db, template.id, occurrenceKey)) return { patches: [], materializedId: null };

  const { startDate, deadline } = occurrenceDates(template, occurrenceDate);
  const snapshot = template.snapshot;
  const patches: EntityPatch[] = [];
  const materializedId = newId();

  if (template.entityKind === 'task') {
    const siblings = Object.values(db.tasks)
      .filter((t) => t.deletedAt === null && t.parentType === snapshot.parentType && (t.parentId ?? null) === (snapshot.parentId ?? null))
      .sort(byRank);
    const last = siblings[siblings.length - 1];
    const task: Task = {
      id: materializedId, ownerId: ctx.ownerId, title: snapshot.title, notes: snapshot.notes,
      priority: snapshot.priority ?? null,
      status: 'open', processed: true,
      parentType: snapshot.parentType, parentId: snapshot.parentId, headingId: snapshot.headingId,
      isInToday: false,
      planning: 'scheduled', startDate, eveningDate: null, deadline,
      rank: last ? keyBetween(last.rank, null) : FIRST_RANK,
      todayRank: last ? keyBetween(last.todayRank, null) : FIRST_RANK,
      completedAt: null, canceledAt: null,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    };
    patches.push(create('tasks', materializedId, task as unknown as Record<string, unknown>));
    patches.push(...checklistPatches(ctx, materializedId, snapshot));
    patches.push(...tagPatches(ctx, materializedId, snapshot, 'task'));
  } else {
    patches.push(create('projects', materializedId, {
      id: materializedId, ownerId: ctx.ownerId, areaId: snapshot.areaId, title: snapshot.title,
      notes: snapshot.notes, status: 'open', planning: 'scheduled', startDate,
      eveningDate: null, deadline, rank: FIRST_RANK, completedAt: null, canceledAt: null,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    }));
    patches.push(...tagPatches(ctx, materializedId, snapshot, 'project'));

    // Child dates are stored as offsets from the project occurrence date (§7).
    const addChildTask = (
      def: { title: string; notes: string; startOffsetDays: number | null },
      headingId: string | null,
      rank: string,
    ) => {
      const id = newId();
      patches.push(create('tasks', id, {
        id, ownerId: ctx.ownerId, title: def.title, notes: def.notes, status: 'open', processed: true,
        parentType: 'project', parentId: materializedId, headingId,
        planning: def.startOffsetDays === null ? 'anytime' : 'scheduled',
        startDate: def.startOffsetDays === null ? null : addDays(startDate, def.startOffsetDays),
        eveningDate: null, deadline: null, rank, todayRank: rank,
        completedAt: null, canceledAt: null,
        createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
      }));
    };

    let taskCursor: string | null = null;
    for (const def of snapshot.tasks ?? []) {
      const rank: string = taskCursor === null ? FIRST_RANK : keyBetween(taskCursor, null);
      taskCursor = rank;
      addChildTask(def, null, rank);
    }
    let headingCursor: string | null = null;
    for (const headingDef of snapshot.headings ?? []) {
      const headingRank: string = headingCursor === null ? FIRST_RANK : keyBetween(headingCursor, null);
      headingCursor = headingRank;
      const headingId = newId();
      patches.push(create('headings', headingId, {
        id: headingId, ownerId: ctx.ownerId, projectId: materializedId, title: headingDef.title,
        rank: headingRank, archivedAt: null, createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
      }));
      let cursor: string | null = null;
      for (const def of headingDef.tasks) {
        const rank: string = cursor === null ? FIRST_RANK : keyBetween(cursor, null);
        cursor = rank;
        addChildTask(def, headingId, rank);
      }
    }
  }

  const linkId = newId();
  patches.push(create('occurrenceLinks', linkId, {
    id: linkId, ownerId: ctx.ownerId, templateId: template.id, occurrenceKey,
    materializedId, ruleVersion: template.ruleVersion,
    createdEarly: options.createdEarly ?? false, skipped: false,
    generatedFrom: options.generatedFrom ?? null, needsReview: false,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  }));
  patches.push(update('repeatTemplates', template.id, {
    lastGeneratedKey: maxKey(template.lastGeneratedKey, occurrenceKey),
  }, ctx));

  return { patches, materializedId };
}

function maxKey(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}

/**
 * Creates every missed occurrence once, up to today. Paused intervals are skipped, and
 * an occurrence created early is not generated again on its scheduled date (§7).
 */
export function generateDueOccurrences(db: Database, ctx: WriteContext): EntityPatch[] {
  const patches: EntityPatch[] = [];
  let working = db;

  for (const template of Object.values(db.repeatTemplates)) {
    if (template.deletedAt !== null || template.stoppedAt !== null || template.pausedAt !== null) continue;
    if (template.rule.type === 'afterCompletion') continue;

    for (const occurrenceDate of ruleDates(template.rule, template.anchorDate)) {
      if (template.endDate !== null && occurrenceDate > template.endDate) break;
      const { startDate } = occurrenceDates(template, occurrenceDate);
      // Generation is driven by the start date, so a lead-time occurrence appears early.
      if (startDate > ctx.today) break;
      if (template.lastGeneratedKey !== null && occurrenceDate <= template.lastGeneratedKey) continue;
      if (hasOccurrence(working, template.id, occurrenceDate)) continue;

      const result = materialize(working, ctx, template, occurrenceDate);
      if (result.patches.length === 0) continue;
      patches.push(...result.patches);
      working = applyLocal(working, result.patches);
    }
  }
  return patches;
}

/** Minimal local application so a generation pass sees its own earlier occurrences. */
function applyLocal(db: Database, patches: EntityPatch[]): Database {
  const next: Database = { ...db, occurrenceLinks: { ...db.occurrenceLinks }, repeatTemplates: { ...db.repeatTemplates } };
  for (const p of patches) {
    if (p.table === 'occurrenceLinks') {
      next.occurrenceLinks[p.id] = { ...(next.occurrenceLinks[p.id] ?? {}), ...p.patch, id: p.id } as OccurrenceLink;
    } else if (p.table === 'repeatTemplates') {
      const existing = next.repeatTemplates[p.id];
      if (existing) next.repeatTemplates[p.id] = { ...existing, ...p.patch } as RepeatTemplate;
    }
  }
  return next;
}

/**
 * A completion-relative series produces its next copy from the actual completion date.
 * Replaying the same completion finds the existing link and generates nothing (§7).
 */
export function onOccurrenceCompleted(
  db: Database, ctx: WriteContext, completedTaskId: string, completionDate: DateOnly,
): EntityPatch[] {
  const link = Object.values(db.occurrenceLinks).find((l) => l.materializedId === completedTaskId && l.deletedAt === null);
  if (!link) return [];
  const template = db.repeatTemplates[link.templateId];
  if (!template || template.stoppedAt !== null || template.pausedAt !== null || template.deletedAt !== null) return [];
  if (template.rule.type !== 'afterCompletion') return [];

  const already = Object.values(db.occurrenceLinks).some(
    (l) => l.deletedAt === null && l.generatedFrom === completedTaskId,
  );
  if (already) return [];

  const nextDate = addDays(completionDate, Math.max(1, template.rule.interval));
  if (template.endDate !== null && nextDate > template.endDate) return [];
  let key = nextDate;
  for (let n = 2; hasOccurrence(db, template.id, key) && n < 50; n++) key = `${nextDate}#${n}`;
  return materialize(db, ctx, template, nextDate, { occurrenceKey: key, generatedFrom: completedTaskId }).patches;
}

/**
 * Undoing a completion retracts an untouched next copy; an edited copy is kept and
 * flagged for review instead of being destroyed (§7).
 */
export function onOccurrenceReopened(db: Database, ctx: WriteContext, taskId: string): EntityPatch[] {
  const link = Object.values(db.occurrenceLinks).find(
    (l) => l.deletedAt === null && l.generatedFrom === taskId,
  );
  if (!link) return [];
  const generated = db.tasks[link.materializedId];
  if (!generated) return [];

  const untouched =
    generated.status === 'open' &&
    generated.updatedAt === generated.createdAt &&
    Object.values(db.checklistItems).every((c) => c.taskId !== generated.id || (!c.checked && c.updatedAt === c.createdAt));

  if (!untouched) {
    return [update('occurrenceLinks', link.id, { needsReview: true }, ctx)];
  }
  return [
    update('tasks', generated.id, { deletedAt: ctx.now }, ctx),
    update('occurrenceLinks', link.id, { deletedAt: ctx.now }, ctx),
  ];
}

/** Skipping a fixed copy affects only that occurrence. */
export function skipOccurrence(db: Database, ctx: WriteContext, templateId: string, occurrenceDate: DateOnly): EntityPatch[] {
  const template = db.repeatTemplates[templateId];
  if (!template) return [];
  if (hasOccurrence(db, templateId, occurrenceDate)) return [];
  const id = newId();
  return [
    create('occurrenceLinks', id, {
      id, ownerId: ctx.ownerId, templateId, occurrenceKey: occurrenceDate, materializedId: '',
      ruleVersion: template.ruleVersion, createdEarly: false, skipped: true,
      generatedFrom: null, needsReview: false,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    }),
    update('repeatTemplates', templateId, { lastGeneratedKey: maxKey(template.lastGeneratedKey, occurrenceDate) }, ctx),
  ];
}

/** Pulls the next copy forward; its scheduled date will not generate again. */
export function createNextEarly(db: Database, ctx: WriteContext, templateId: string): EntityPatch[] {
  const template = db.repeatTemplates[templateId];
  if (!template || template.stoppedAt !== null) return [];
  const from = template.lastGeneratedKey ?? addDays(template.anchorDate, -1);
  const next = template.rule.type === 'afterCompletion'
    ? addDays(ctx.today, Math.max(1, template.rule.interval))
    : nextDateAfter(template.rule, template.anchorDate, from, template.endDate);
  if (next === null) return [];
  return materialize(db, ctx, template, next, { createdEarly: true }).patches;
}

export function pauseTemplate(db: Database, ctx: WriteContext, templateId: string): EntityPatch[] {
  if (!db.repeatTemplates[templateId]) return [];
  return [update('repeatTemplates', templateId, { pausedAt: ctx.now }, ctx)];
}

/** Resuming begins with the next eligible occurrence; the paused interval is not back-filled. */
export function resumeTemplate(db: Database, ctx: WriteContext, templateId: string): EntityPatch[] {
  const template = db.repeatTemplates[templateId];
  if (!template) return [];
  return [update('repeatTemplates', templateId, {
    pausedAt: null,
    lastGeneratedKey: maxKey(template.lastGeneratedKey, ctx.today),
  }, ctx)];
}

/** Stop disables generation; copies already made stay as ordinary items. */
export function stopTemplate(db: Database, ctx: WriteContext, templateId: string): EntityPatch[] {
  if (!db.repeatTemplates[templateId]) return [];
  const patches: EntityPatch[] = [update('repeatTemplates', templateId, { stoppedAt: ctx.now }, ctx)];
  for (const link of linksFor(db, templateId)) {
    const task = db.tasks[link.materializedId];
    if (task && task.status === 'open') patches.push(update('occurrenceLinks', link.id, { deletedAt: ctx.now }, ctx));
  }
  return patches;
}

/** Canceling a completion-relative copy pauses that series for review (§7). */
export function onOccurrenceCanceled(db: Database, ctx: WriteContext, taskId: string): EntityPatch[] {
  const link = Object.values(db.occurrenceLinks).find((l) => l.materializedId === taskId && l.deletedAt === null);
  if (!link) return [];
  const template = db.repeatTemplates[link.templateId];
  if (!template || template.rule.type !== 'afterCompletion' || template.pausedAt !== null) return [];
  return [update('repeatTemplates', template.id, { pausedAt: ctx.now }, ctx)];
}

export interface CreateTemplateInput {
  entityKind: 'task' | 'project';
  snapshot: RepeatSnapshot;
  rule: RepeatRule;
  anchorDate: DateOnly;
  endDate?: DateOnly | null;
  useDeadline?: boolean;
  leadDays?: number;
  /**
   * The task or project the template was made from. It is recorded as the anchor-date
   * occurrence, so generation continues from it rather than producing a second copy.
   */
  existingId?: string;
}

export function createTemplate(ctx: WriteContext, input: CreateTemplateInput): { patches: EntityPatch[]; id: string } {
  const id = newId();
  const template: RepeatTemplate = {
    id, ownerId: ctx.ownerId, entityKind: input.entityKind, snapshot: input.snapshot,
    rule: input.rule, anchorDate: input.anchorDate, endDate: input.endDate ?? null,
    useDeadline: input.useDeadline ?? false, leadDays: input.leadDays ?? 0,
    timeZone: ctx.timeZone, pausedAt: null, stoppedAt: null, ruleVersion: 1,
    lastGeneratedKey: input.existingId ? input.anchorDate : null,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  };
  const patches: EntityPatch[] = [create('repeatTemplates', id, template as unknown as Record<string, unknown>)];
  if (input.existingId) {
    const linkId = newId();
    patches.push(create('occurrenceLinks', linkId, {
      id: linkId, ownerId: ctx.ownerId, templateId: id, occurrenceKey: input.anchorDate,
      materializedId: input.existingId, ruleVersion: 1, createdEarly: false, skipped: false,
      generatedFrom: null, needsReview: false,
      createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    }));
  }
  return { patches, id };
}

/**
 * Captures a project as a template snapshot. Child start dates become offsets from the
 * anchor so each copy lands relative to its own occurrence date (§7).
 */
export function projectSnapshot(db: Database, project: Project, anchorDate: DateOnly): RepeatSnapshot {
  const offset = (task: Task) => (task.startDate ? daysBetween(anchorDate, task.startDate) : null);
  const define = (task: Task) => ({ title: task.title, notes: task.notes, startOffsetDays: offset(task) });
  const children = Object.values(db.tasks)
    .filter((t) => t.deletedAt === null && t.status === 'open' && t.parentType === 'project' && t.parentId === project.id)
    .sort(byRank);
  const headings = Object.values(db.headings)
    .filter((h) => h.deletedAt === null && h.projectId === project.id && h.archivedAt === null)
    .sort(byRank);
  const tagIds = Object.values(db.tagAssignments)
    .filter((a) => a.deletedAt === null && a.targetType === 'project' && a.targetId === project.id)
    .map((a) => a.tagId);
  return {
    title: project.title, notes: project.notes,
    parentType: 'area', parentId: project.areaId, headingId: null, areaId: project.areaId,
    tagIds, checklist: [],
    tasks: children.filter((t) => t.headingId === null).map(define),
    headings: headings.map((heading) => ({
      title: heading.title,
      tasks: children.filter((t) => t.headingId === heading.id).map(define),
    })),
  };
}

/** Editing a template affects future unmaterialized copies only; history is untouched. */
export function updateTemplate(db: Database, ctx: WriteContext, id: string, fields: Partial<RepeatTemplate>): EntityPatch[] {
  const template = db.repeatTemplates[id];
  if (!template) return [];
  const ruleChanged = fields.rule !== undefined || fields.anchorDate !== undefined || fields.useDeadline !== undefined;
  return [update('repeatTemplates', id, {
    ...fields,
    ruleVersion: ruleChanged ? template.ruleVersion + 1 : template.ruleVersion,
  }, ctx)];
}

/** A task inside a repeating project may not carry its own repeat rule (§7). */
export function canRepeatTask(db: Database, task: Task): boolean {
  if (task.parentType !== 'project' || !task.parentId) return true;
  return !Object.values(db.occurrenceLinks).some(
    (l) => l.deletedAt === null && l.materializedId === task.parentId,
  );
}

/** Future occurrences shown in Upcoming without creating stored tasks (§7, generation). */
export interface ProjectedOccurrence {
  templateId: string;
  title: string;
  date: DateOnly;
  isDeadline: boolean;
}

export function projectedOccurrences(db: Database, from: DateOnly, to: DateOnly): ProjectedOccurrence[] {
  const out: ProjectedOccurrence[] = [];
  for (const template of Object.values(db.repeatTemplates)) {
    if (template.deletedAt !== null || template.stoppedAt !== null || template.pausedAt !== null) continue;
    if (template.rule.type === 'afterCompletion') continue;
    for (const date of datesInRange(template.rule, template.anchorDate, from, to, template.endDate)) {
      if (hasOccurrence(db, template.id, date)) continue;
      const { startDate } = occurrenceDates(template, date);
      if (startDate < from) continue;
      out.push({ templateId: template.id, title: template.snapshot.title, date: startDate, isDeadline: template.useDeadline });
    }
  }
  return out;
}

export function describeRule(rule: RepeatRule): string {
  const n = Math.max(1, rule.interval);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const plural = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  switch (rule.type) {
    case 'everyNDays': return plural('day');
    case 'everyNWeeks': return plural('week');
    case 'everyNMonths': return plural('month');
    case 'everyNYears': return plural('year');
    case 'weekdays': return `Every ${(rule.weekdays ?? []).map((w) => days[w]).join(', ') || 'week'}`;
    case 'dayOfMonth': return `Day ${rule.dayOfMonth ?? 1} of ${n === 1 ? 'every month' : `every ${n} months`}`;
    case 'ordinalWeekday': {
      const ord = rule.ordinal === -1 ? 'last' : ['', 'first', 'second', 'third', 'fourth'][rule.ordinal ?? 1];
      return `The ${ord} ${days[rule.weekdays?.[0] ?? 1]} of ${n === 1 ? 'every month' : `every ${n} months`}`;
    }
    case 'afterCompletion': return `${n} day${n === 1 ? '' : 's'} after completion`;
  }
}
