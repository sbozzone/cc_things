'use client';

import { useMemo, useState } from 'react';
import {
  addDays, addMonths, daysInMonth, formatDateLabel, makeDate, monthName, resolveInstant, weekdayOf,
} from '@/core/dates';
import { parseNaturalDate } from '@/core/natural-dates';
import type { DateOnly, PlanningState } from '@/core/types';
import { Button, Popover } from './primitives';
import { CalendarIcon, ClockIcon, EveningIcon, LayersIcon, ArchiveBoxIcon, StarIcon, CloseIcon } from './icons';

export interface WhenValue {
  planning: PlanningState;
  startDate: DateOnly | null;
  evening: boolean;
  /** `HH:mm`, or null for no reminder. */
  reminder: string | null;
}

interface CommonProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  today: DateOnly;
  locale: string;
  timeZone: string;
}

const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MiniCalendar({
  month, selected, today, onSelect, onMonthChange,
}: {
  month: DateOnly;
  selected: DateOnly | null;
  today: DateOnly;
  onSelect: (date: DateOnly) => void;
  onMonthChange: (month: DateOnly) => void;
}) {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const first = makeDate(year, monthNumber, 1);
  const lead = weekdayOf(first);
  const total = daysInMonth(year, monthNumber);
  const cells: (DateOnly | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => makeDate(year, monthNumber, i + 1)),
  ];

  return (
    <div className="px-1 pb-1">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(month, -1))}
          className="h-8 w-8 rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        >
          ‹
        </button>
        <span className="text-[13px] font-semibold" aria-live="polite">{monthName(first)} {year}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="h-8 w-8 rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK_LABELS.map((label, i) => (
          <span key={i} className="py-1 text-[11px] font-medium text-faint" aria-hidden="true">{label}</span>
        ))}
        {cells.map((date, i) =>
          date === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-label={`${monthName(date)} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`}
              aria-current={date === today ? 'date' : undefined}
              aria-pressed={date === selected}
              className={`flex h-8 items-center justify-center rounded-md text-[13px] transition-colors ${
                date === selected
                  ? 'bg-accent font-semibold text-accent-contrast'
                  : date === today
                    ? 'font-semibold text-accent hover:bg-accent-soft'
                    : 'hover:bg-surface-2'
              }`}
            >
              {Number(date.slice(8, 10))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function OptionRow({
  icon, label, detail, onClick, selected,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[14px] transition-colors ${
        selected ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'
      }`}
    >
      <span className="flex h-5 w-5 items-center justify-center text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {detail ? <span className="text-[12px] text-faint">{detail}</span> : null}
    </button>
  );
}

/**
 * The single When control (R15): Today, This Evening, Anytime, Someday, or a calendar
 * start date, plus an optional timed reminder on that start (R19). Natural language is
 * previewed before it is committed (R16).
 */
export function WhenPopover({
  anchor, onClose, today, locale, timeZone, value, onChange,
}: CommonProps & { value: WhenValue; onChange: (value: WhenValue) => void }) {
  const [text, setText] = useState('');
  const [month, setMonth] = useState<DateOnly>(value.startDate ?? today);
  const parsed = useMemo(() => (text.trim() ? parseNaturalDate(text, today, locale) : null), [text, today, locale]);

  const commit = (next: Partial<WhenValue>) => {
    onChange({ ...value, ...next });
    onClose();
  };

  const reminderPreview = value.startDate && value.reminder
    ? resolveInstant(value.startDate, value.reminder, timeZone)
    : null;

  return (
    <Popover anchor={anchor} onClose={onClose} label="When" width={320}>
      <div className="mb-1 px-1">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && parsed) {
              event.preventDefault();
              commit({ planning: 'scheduled', startDate: parsed.date, evening: false, reminder: parsed.time ?? value.reminder });
            }
          }}
          placeholder="tomorrow, next friday, in 3 days…"
          aria-label="Type a date"
          className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
        />
        {text.trim() ? (
          <p className="mt-1.5 px-1 text-[12px]" aria-live="polite">
            {parsed ? (
              <span className="text-accent">
                {parsed.interpretation} → {formatDateLabel(parsed.date, today)}, {parsed.date}
                {parsed.time ? ` at ${parsed.time} (${timeZone})` : ''} — press Enter
              </span>
            ) : (
              <span className="text-muted">Not a date we recognise. Pick one below instead.</span>
            )}
          </p>
        ) : null}
      </div>

      <div className="space-y-0.5">
        <OptionRow
          icon={<StarIcon />} label="Today" detail={formatDateLabel(today, today)}
          selected={value.planning === 'scheduled' && value.startDate === today && !value.evening}
          onClick={() => commit({ planning: 'scheduled', startDate: today, evening: false })}
        />
        <OptionRow
          icon={<EveningIcon />} label="This Evening"
          selected={value.evening && value.startDate === today}
          onClick={() => commit({ planning: 'scheduled', startDate: today, evening: true })}
        />
        <OptionRow
          icon={<LayersIcon />} label="Anytime"
          selected={value.planning === 'anytime'}
          onClick={() => commit({ planning: 'anytime', startDate: null, evening: false, reminder: null })}
        />
        <OptionRow
          icon={<ArchiveBoxIcon />} label="Someday"
          selected={value.planning === 'someday'}
          onClick={() => commit({ planning: 'someday', startDate: null, evening: false, reminder: null })}
        />
      </div>

      <div className="my-1.5 border-t border-line" />
      <MiniCalendar
        month={month}
        selected={value.startDate}
        today={today}
        onMonthChange={setMonth}
        onSelect={(date) => commit({ planning: 'scheduled', startDate: date, evening: false })}
      />

      <div className="border-t border-line px-1 pt-2">
        <div className="flex items-center gap-2">
          <ClockIcon className="text-muted" />
          <label className="flex-1 text-[13px]" htmlFor="reminder-time">Reminder</label>
          <input
            id="reminder-time"
            type="time"
            value={value.reminder ?? ''}
            disabled={value.startDate === null}
            onChange={(event) => onChange({ ...value, reminder: event.target.value || null })}
            className="h-8 rounded-md border border-line px-1.5 text-[13px] disabled:opacity-40"
          />
          {value.reminder ? (
            <button type="button" aria-label="Clear reminder" onClick={() => onChange({ ...value, reminder: null })} className="text-muted hover:text-ink">
              <CloseIcon size={14} />
            </button>
          ) : null}
        </div>
        {value.startDate === null ? (
          <p className="mt-1 text-[12px] text-faint">A reminder needs a start date.</p>
        ) : reminderPreview ? (
          <p className="mt-1 text-[12px] text-muted">
            {value.reminder} in {timeZone}
            {reminderPreview.adjustment === 'nonexistent'
              ? ' — that local time does not exist on this day, so the next valid time is used.'
              : reminderPreview.adjustment === 'ambiguous'
                ? ' — that local time occurs twice; the first is used.'
                : ''}
          </p>
        ) : null}
      </div>

      {value.planning !== 'anytime' || value.startDate ? (
        <div className="mt-2 border-t border-line px-1 pt-2">
          <Button
            variant="ghost"
            size="sm"
            full
            onClick={() => commit({ planning: 'anytime', startDate: null, evening: false, reminder: null })}
          >
            Clear start date{value.reminder ? ' and its reminder' : ''}
          </Button>
        </div>
      ) : null}
    </Popover>
  );
}

/**
 * The deadline control, deliberately separate from When: a deadline names the finish
 * date and never schedules a notification (R15, R19).
 */
export function DeadlinePopover({
  anchor, onClose, today, locale, value, onChange, startDate,
}: CommonProps & { value: DateOnly | null; onChange: (value: DateOnly | null) => void; startDate: DateOnly | null }) {
  const [text, setText] = useState('');
  const [month, setMonth] = useState<DateOnly>(value ?? today);
  const parsed = useMemo(() => (text.trim() ? parseNaturalDate(text, today, locale) : null), [text, today, locale]);
  const conflict = (candidate: DateOnly | null) => startDate !== null && candidate !== null && startDate > candidate;

  const commit = (date: DateOnly | null) => {
    onChange(date);
    onClose();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} label="Deadline" width={320}>
      <div className="mb-1 px-1">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && parsed) {
              event.preventDefault();
              commit(parsed.date);
            }
          }}
          placeholder="friday, sep 15, in 2 weeks…"
          aria-label="Type a deadline"
          className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
        />
        {text.trim() ? (
          <p className="mt-1.5 px-1 text-[12px]" aria-live="polite">
            {parsed
              ? <span className="text-accent">{parsed.interpretation} → {parsed.date} — press Enter</span>
              : <span className="text-muted">Not a date we recognise. Pick one below instead.</span>}
          </p>
        ) : null}
      </div>

      <div className="space-y-0.5">
        <OptionRow icon={<CalendarIcon />} label="Today" detail={today} onClick={() => commit(today)} />
        <OptionRow icon={<CalendarIcon />} label="Tomorrow" onClick={() => commit(addDays(today, 1))} />
        <OptionRow icon={<CalendarIcon />} label="Next week" onClick={() => commit(addDays(today, 7))} />
      </div>

      <div className="my-1.5 border-t border-line" />
      <MiniCalendar month={month} selected={value} today={today} onMonthChange={setMonth} onSelect={commit} />

      {conflict(value) ? (
        <p className="mx-1 mb-1 rounded-md bg-danger-soft px-2 py-1.5 text-[12px] text-danger" role="status">
          This start date is after the deadline. The reached deadline will still bring the task into Today.
        </p>
      ) : null}

      {value ? (
        <div className="border-t border-line px-1 pt-2">
          <Button variant="ghost" size="sm" full onClick={() => commit(null)}>Clear deadline</Button>
        </div>
      ) : null}
    </Popover>
  );
}
