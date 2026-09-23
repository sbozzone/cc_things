'use client';

import { useMemo, useState } from 'react';
import { formatDateLabel } from '@/core/dates';
import {
  createNextEarly, createTemplate, describeRule, pauseTemplate, previewNext, projectSnapshot,
  resumeTemplate, skipOccurrence, stopTemplate, updateTemplate, canRepeatTask,
} from '@/core/recurrence';
import { byRank } from '@/core/rank';
import type { Project, RepeatRule, RepeatRuleType, RepeatSnapshot, Task } from '@/core/types';
import { useApp } from '@/state/store';
import { Button, Popover } from './primitives';

const RULE_LABELS: { value: RepeatRuleType; label: string }[] = [
  { value: 'everyNDays', label: 'Every N days' },
  { value: 'weekdays', label: 'Selected weekdays' },
  { value: 'everyNWeeks', label: 'Every N weeks' },
  { value: 'dayOfMonth', label: 'Day of the month' },
  { value: 'ordinalWeekday', label: 'Ordinal weekday' },
  { value: 'everyNYears', label: 'Every N years' },
  { value: 'afterCompletion', label: 'Days after completion' },
];

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** What is being made repeating: a single task, or a whole project with its structure. */
export type RepeatSubject = { kind: 'task'; task: Task } | { kind: 'project'; project: Project };

/**
 * The recurrence editor (R17, R18). It always says whether the user is looking at the
 * template or at one copy, and it previews upcoming dates without creating anything.
 */
export function RepeatEditor({ anchor, onClose, subject }: { anchor: HTMLElement | null; onClose: () => void; subject: RepeatSubject }) {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const ctx = useApp((s) => s.ctx);
  const dispatch = useApp((s) => s.dispatch);
  const pushToast = useApp((s) => s.pushToast);

  const item = subject.kind === 'task' ? subject.task : subject.project;
  const noun = subject.kind === 'task' ? 'task' : 'project';
  const link = Object.values(db.occurrenceLinks).find((l) => l.deletedAt === null && l.materializedId === item.id);
  const existing = link ? db.repeatTemplates[link.templateId] : undefined;

  const [rule, setRule] = useState<RepeatRule>(existing?.rule ?? { type: 'everyNWeeks', interval: 1, weekdays: [] });
  const [useDeadline, setUseDeadline] = useState(existing?.useDeadline ?? false);
  const [leadDays, setLeadDays] = useState(existing?.leadDays ?? 0);
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');

  const anchorDate = existing?.anchorDate ?? item.startDate ?? today;
  const draftSnapshot = useMemo<RepeatSnapshot>(() => {
    if (subject.kind === 'project') return projectSnapshot(db, subject.project, anchorDate);
    const { task } = subject;
    const checklist = Object.values(db.checklistItems)
      .filter((c) => c.taskId === task.id && c.deletedAt === null)
      .sort(byRank)
      .map((c) => ({ text: c.text }));
    const tagIds = Object.values(db.tagAssignments)
      .filter((a) => a.deletedAt === null && a.targetType === 'task' && a.targetId === task.id)
      .map((a) => a.tagId);
    return {
      priority: task.priority ?? null,
      title: task.title, notes: task.notes, parentType: task.parentType, parentId: task.parentId,
      headingId: task.headingId, areaId: null, tagIds, checklist,
    };
  }, [db, subject, anchorDate]);

  const preview = useMemo(() => {
    const draft = {
      ...(existing ?? {
        id: 'draft', ownerId: '', entityKind: subject.kind, snapshot: draftSnapshot,
        timeZone: db.settings.planningTimeZone, pausedAt: null, stoppedAt: null, ruleVersion: 1,
        lastGeneratedKey: null, createdAt: '', updatedAt: '', deletedAt: null,
      }),
      rule, anchorDate, endDate: endDate || null, useDeadline, leadDays,
    };
    return previewNext(draft as Parameters<typeof previewNext>[0], today);
  }, [rule, anchorDate, endDate, useDeadline, leadDays, existing, subject.kind, draftSnapshot, today, db.settings.planningTimeZone]);

  const allowed = subject.kind === 'project' || canRepeatTask(db, subject.task);
  const headingCount = draftSnapshot.headings?.length ?? 0;
  const childCount = (draftSnapshot.tasks?.length ?? 0) + (draftSnapshot.headings ?? []).reduce((n, h) => n + h.tasks.length, 0);
  const structureSummary = subject.kind === 'project'
    ? `${childCount} open task${childCount === 1 ? '' : 's'}${headingCount > 0 ? ` under ${headingCount} heading${headingCount === 1 ? '' : 's'}` : ''}`
    : null;

  const save = () => {
    if (existing) {
      dispatch(updateTemplate(db, ctx(), existing.id, { rule, useDeadline, leadDays, endDate: endDate || null }), { undoLabel: 'repeat rule' });
      onClose();
      return;
    }
    const created = createTemplate(ctx(), {
      entityKind: subject.kind,
      snapshot: draftSnapshot,
      rule, anchorDate, endDate: endDate || null, useDeadline, leadDays,
      existingId: item.id,
    });
    dispatch(created.patches, { undoLabel: 'repeat' });
    pushToast({ message: `Repeating: ${describeRule(rule)}. The next copies appear as their dates arrive.`, tone: 'info' });
    onClose();
  };

  const needsWeekdays = rule.type === 'weekdays' || rule.type === 'everyNWeeks';
  const needsDayOfMonth = rule.type === 'dayOfMonth';
  const needsOrdinal = rule.type === 'ordinalWeekday';

  return (
    <Popover anchor={anchor} onClose={onClose} label="Repeat" width={340}>
      <div className="space-y-3 p-1">
        <p className="rounded-md bg-surface-2 px-2 py-1.5 text-[12px] text-muted">
          {existing
            ? 'You are editing the template. Changes apply to future copies; copies already made are untouched.'
            : `This creates a template. The ${noun} in front of you becomes its first copy${
              structureSummary ? `, and each later copy carries its ${structureSummary}, with dates kept relative to the copy` : ''
            }.`}
        </p>

        {!allowed ? (
          <p className="rounded-md bg-danger-soft px-2 py-1.5 text-[12px] text-danger">
            A task inside a repeating project cannot repeat on its own.
          </p>
        ) : null}

        <label className="block text-[13px]">
          <span className="mb-1 block font-semibold text-muted">Pattern</span>
          <select
            value={rule.type}
            onChange={(event) => setRule({ ...rule, type: event.target.value as RepeatRuleType })}
            className="h-10 w-full rounded-md border border-line bg-surface px-2 text-[14px]"
          >
            {RULE_LABELS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-[13px]">
          <span className="mb-1 block font-semibold text-muted">
            {rule.type === 'afterCompletion' ? 'Days after completion' : 'Interval'}
          </span>
          <input
            type="number"
            min={1}
            max={999}
            value={rule.interval}
            onChange={(event) => setRule({ ...rule, interval: Math.max(1, Number(event.target.value) || 1) })}
            className="h-10 w-24 rounded-md border border-line px-2 text-[14px]"
          />
        </label>

        {needsWeekdays ? (
          <fieldset>
            <legend className="mb-1 text-[13px] font-semibold text-muted">Weekdays</legend>
            <div className="flex gap-1">
              {DAY_NAMES.map((name, index) => {
                const active = (rule.weekdays ?? []).includes(index);
                return (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={active}
                    aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]}
                    onClick={() => {
                      const current = new Set(rule.weekdays ?? []);
                      if (current.has(index)) current.delete(index);
                      else current.add(index);
                      setRule({ ...rule, weekdays: [...current].sort((a, b) => a - b) });
                    }}
                    className={`h-9 w-9 rounded-md border text-[13px] ${
                      active ? 'border-accent bg-accent-fill text-accent-fill-contrast' : 'border-line hover:bg-surface-2'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {needsDayOfMonth ? (
          <label className="block text-[13px]">
            <span className="mb-1 block font-semibold text-muted">Day</span>
            <input
              type="number"
              min={1}
              max={31}
              value={rule.dayOfMonth ?? 1}
              onChange={(event) => setRule({ ...rule, dayOfMonth: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })}
              className="h-10 w-24 rounded-md border border-line px-2 text-[14px]"
            />
            <span className="mt-1 block text-[12px] text-faint">Day 31 uses the final day in shorter months.</span>
          </label>
        ) : null}

        {needsOrdinal ? (
          <div className="flex gap-2">
            <label className="block flex-1 text-[13px]">
              <span className="mb-1 block font-semibold text-muted">Which</span>
              <select
                value={rule.ordinal ?? 1}
                onChange={(event) => setRule({ ...rule, ordinal: Number(event.target.value) })}
                className="h-10 w-full rounded-md border border-line bg-surface px-2 text-[14px]"
              >
                <option value={1}>First</option><option value={2}>Second</option>
                <option value={3}>Third</option><option value={4}>Fourth</option>
                <option value={-1}>Last</option>
              </select>
            </label>
            <label className="block flex-1 text-[13px]">
              <span className="mb-1 block font-semibold text-muted">Weekday</span>
              <select
                value={rule.weekdays?.[0] ?? 1}
                onChange={(event) => setRule({ ...rule, weekdays: [Number(event.target.value)] })}
                className="h-10 w-full rounded-md border border-line bg-surface px-2 text-[14px]"
              >
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((name, i) => (
                  <option key={name} value={i}>{name}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={useDeadline} onChange={(event) => setUseDeadline(event.target.checked)} className="h-4 w-4" />
          The occurrence date is a deadline
        </label>
        {useDeadline ? (
          <label className="block text-[13px]">
            <span className="mb-1 block font-semibold text-muted">Start this many days before</span>
            <input
              type="number"
              min={0}
              max={365}
              value={leadDays}
              onChange={(event) => setLeadDays(Math.max(0, Number(event.target.value) || 0))}
              className="h-10 w-24 rounded-md border border-line px-2 text-[14px]"
            />
          </label>
        ) : null}

        <label className="block text-[13px]">
          <span className="mb-1 block font-semibold text-muted">End date (optional)</span>
          <input
            type="date"
            value={endDate ?? ''}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-10 w-full rounded-md border border-line px-2 text-[14px]"
          />
        </label>

        <div className="rounded-md bg-surface-2 px-2 py-1.5">
          <span className="block text-[12px] font-semibold text-muted">Next dates</span>
          {preview.length === 0 ? (
            <span className="text-[13px] text-faint">No further occurrences.</span>
          ) : (
            <ul className="mt-0.5 text-[13px]">
              {preview.map((date) => (
                <li key={date}>{formatDateLabel(date, today)} — {date}</li>
              ))}
            </ul>
          )}
          {rule.type === 'afterCompletion' ? (
            <span className="mt-1 block text-[12px] text-faint">Later dates depend on when each copy is finished.</span>
          ) : null}
        </div>

        {existing ? (
          <div className="flex flex-wrap gap-1 border-t border-line pt-2">
            {existing.pausedAt ? (
              <Button size="sm" onClick={() => { dispatch(resumeTemplate(db, ctx(), existing.id), { undoLabel: 'resume' }); onClose(); }}>Resume</Button>
            ) : (
              <Button size="sm" onClick={() => { dispatch(pauseTemplate(db, ctx(), existing.id), { undoLabel: 'pause' }); onClose(); }}>Pause</Button>
            )}
            <Button size="sm" onClick={() => { dispatch(createNextEarly(db, ctx(), existing.id), { undoLabel: 'next copy' }); onClose(); }}>Create next now</Button>
            {link ? (
              <Button size="sm" onClick={() => { dispatch(skipOccurrence(db, ctx(), existing.id, link.occurrenceKey), { undoLabel: 'skip' }); onClose(); }}>Skip this one</Button>
            ) : null}
            <Button size="sm" variant="danger" onClick={() => { dispatch(stopTemplate(db, ctx(), existing.id), { undoLabel: 'stop repeating' }); onClose(); }}>Stop repeating</Button>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line pt-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={save} disabled={!allowed}>{existing ? 'Update template' : 'Start repeating'}</Button>
        </div>
      </div>
    </Popover>
  );
}
