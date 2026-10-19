'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatDateLabel } from '@/core/dates';
import { emptyTagFilter, getSelectableTags, getTag, tagFilterActive, tagPath } from '@/core/tags';
import { ERRANDS_TAG_ID, isErrandTask } from '@/core/errands';
import { groupErrandsDocument, isErrandsOrderingView } from '@/core/errand-order';
import { inToday } from '@/core/membership';
import { contextLabelFor, suggestionsForMyDay, type AddTarget, type ListDocument, type ListItem, type ListSection } from '@/core/selectors';
import type { CalendarEvent, ItemOrderScope, Project, Task } from '@/core/types';
import { useApp, useIndexes } from '@/state/store';
import * as actions from '@/state/actions';
import { TaskEditor } from './TaskEditor';
import { Button, Chip, IconButton, Modal, Popover, ProgressRing, StatusControl } from './primitives';
import { WhenPopover, DeadlinePopover, type WhenValue } from './DatePopover';
import { MovePicker } from './Pickers';
import { DuplicateDialog } from './DuplicateDialog';
import {
  AlertIcon, ArchiveBoxIcon, CalendarIcon, ChecklistIcon, CopyIcon, EveningIcon, FlagIcon,
  MoreIcon, MoveIcon, NoteIcon, PlusIcon, PrintIcon, PromoteIcon, RepeatIcon, TrashIcon, ChevronIcon, SunIcon, TagIcon,
} from './icons';
import { usePhone } from './useMediaQuery';
import { viewStyle } from './view-style';
import { OrderHandle } from './OrderHandle';
import { TagDot } from './TagColor';
import { priorities, sortDocument, type ListSort } from '@/core/list-order';
import { balancedColumnSplit, needsBalancedColumns, upcomingItemsForDate } from '@/core/upcoming-print';
import { byRank } from '@/core/rank';
import { withoutAreaDocument } from '@/core/area-filter';

const sortChoices: { value: ListSort; label: string }[] = [
  { value: 'manual', label: 'Manual order' },
  { value: 'alphabetical', label: 'Alphabetical (A–Z)' },
  { value: 'alphabeticalDesc', label: 'Alphabetical (Z–A)' },
  { value: 'due', label: 'Due date (earliest first)' },
  { value: 'dueDesc', label: 'Due date (latest first)' },
  { value: 'created', label: 'Created date (newest first)' },
  { value: 'createdAsc', label: 'Created date (oldest first)' },
  { value: 'priority', label: 'Priority (highest first)' },
  { value: 'priorityDesc', label: 'Priority (lowest first)' },
  { value: 'tags', label: 'Tags (A–Z)' },
  { value: 'tagsDesc', label: 'Tags (Z–A)' },
];

/** Row currently being dragged. Drag is an accelerator; every move has a menu equivalent (R26). */
let dragSource: { id: string; sectionId: string } | null = null;

type MobileListMode = 'browse' | 'select' | 'arrange';

/** A small tinted pill. Colour is paired with its own foreground so contrast holds. */
function Pill({
  tone, icon, children,
}: {
  tone: 'warm' | 'danger' | 'cool' | 'neutral';
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    warm: 'bg-chip-warm text-chip-warm-fg',
    danger: 'bg-chip-danger text-chip-danger-fg',
    cool: 'bg-chip-cool text-chip-cool-fg',
    neutral: 'bg-chip-neutral text-chip-neutral-fg',
  } as const;
  return (
    <span className={`task-pill inline-flex h-[20px] items-center gap-1 rounded-full px-1.5 text-[11.5px] font-medium leading-none ${tones[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

function DateChip({ task, today, hideStart }: { task: Task; today: string; hideStart?: boolean }) {
  const chips: React.ReactNode[] = [];
  const isEvening = task.eveningDate !== null && task.eveningDate === task.startDate;

  // Inside Today the start date is implied by the list itself, so it is not repeated.
  if (task.startDate && !(hideStart && task.startDate <= today)) {
    chips.push(
      <Pill
        key="start"
        tone={task.startDate <= today ? 'warm' : 'neutral'}
        icon={isEvening ? <EveningIcon size={11} /> : <CalendarIcon size={11} />}
      >
        Scheduled {formatDateLabel(task.startDate, today)}{isEvening ? ' evening' : ''}
      </Pill>,
    );
  }
  if (isEvening && hideStart) {
    chips.push(<Pill key="evening" tone="warm" icon={<EveningIcon size={11} />}>Evening</Pill>);
  }
  if (task.planning === 'someday' && !task.startDate) {
    chips.push(<Pill key="someday" tone="neutral" icon={<ArchiveBoxIcon size={11} />}>Someday</Pill>);
  }
  if (task.deadline) {
    const overdue = task.deadline < today;
    chips.push(
      <Pill key="due" tone={overdue ? 'danger' : 'warm'} icon={<FlagIcon size={11} />}>
        Due {formatDateLabel(task.deadline, today)}{overdue ? ' · Overdue' : ''}
      </Pill>,
    );
  }
  return <>{chips}</>;
}

function TaskRow({
  item, sectionId, orderedIds, orderIds = orderedIds, scope, isPhone, nested = false, canOrder = true, myDayView = scope === 'today', mobileMode = 'browse',
}: {
  item: Extract<ListItem, { kind: 'task' }>;
  sectionId: string;
  orderedIds: string[];
  orderIds?: string[];
  scope: ItemOrderScope;
  isPhone: boolean;
  nested?: boolean;
  canOrder?: boolean;
  myDayView?: boolean;
  mobileMode?: MobileListMode;
}) {
  const { task, meta } = item;
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const openItemId = useApp((s) => s.openItemId);
  const selection = useApp((s) => s.selection);
  const openItem = useApp((s) => s.openItem);
  const toggleSelected = useApp((s) => s.toggleSelected);
  const extendSelection = useApp((s) => s.extendSelection);
  const setSelection = useApp((s) => s.setSelection);
  const [dropSide, setDropSide] = useState<'above' | 'below' | null>(null);
  const rowRef = useRef<HTMLLIElement | null>(null);

  const selected = selection.includes(task.id);
  const selecting = isPhone && (mobileMode === 'select' || selection.length > 0);
  const isEditing = openItemId === task.id;
  const project = task.parentType === 'project' && task.parentId ? db.projects[task.parentId] ?? null : null;
  const isInMyDay = inToday(task, project, today);

  const move = (direction: -1 | 1) => {
    if (!canOrder) return;
    const index = orderIds.indexOf(task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderIds.length) return;
    const reordered = [...orderIds];
    reordered.splice(index, 1);
    reordered.splice(target, 0, task.id);
    const at = reordered.indexOf(task.id);
    if (scope === 'errands') actions.orderItems(reordered, scope);
    else actions.reorderTask(task.id, reordered[at - 1] ?? null, reordered[at + 1] ?? null, scope);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLLIElement>) => {
    const rows = Array.from(
      rowRef.current?.closest('[data-list-root]')?.querySelectorAll<HTMLElement>('[data-row]') ?? [],
    );
    const index = rows.indexOf(rowRef.current as HTMLElement);
    const meta = event.metaKey || event.ctrlKey;

    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault();
      rows[Math.min(index + 1, rows.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault();
      rows[Math.max(index - 1, 0)]?.focus();
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      move(event.key === 'ArrowUp' ? -1 : 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openItem(isEditing ? null : task.id);
    } else if (event.key === ' ' && !meta) {
      event.preventDefault();
      toggleSelected(task.id);
    } else if (meta && event.key === 'Enter') {
      event.preventDefault();
      actions.setStatus(selected ? selection : [task.id], task.status === 'open' ? 'completed' : 'open');
    } else if (meta && event.key === 'Backspace') {
      event.preventDefault();
      actions.deleteTasks(selected ? selection : [task.id]);
    } else if (!meta && ['t', 'e', 'a', 's'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const ids = selected ? selection : [task.id];
      const key = event.key.toLowerCase();
      const value: WhenValue =
        key === 't' ? { planning: 'scheduled', startDate: today, evening: false, reminder: null }
        : key === 'e' ? { planning: 'scheduled', startDate: today, evening: true, reminder: null }
        : key === 'a' ? { planning: 'anytime', startDate: null, evening: false, reminder: null }
        : { planning: 'someday', startDate: null, evening: false, reminder: null };
      actions.applyWhen(ids, value);
    }
  };

  if (isEditing && !isPhone) {
    return (
      <li ref={rowRef} data-row data-id={task.id} className="fade-in px-0.5 py-1.5">
        <TaskEditor task={task} onClose={() => openItem(null)} />
      </li>
    );
  }

  return (
    <li
      ref={rowRef}
      data-row
      data-id={task.id}
      data-order-group={canOrder ? sectionId : undefined}
      data-order-title={task.title}
      tabIndex={0}
      role="option"
      aria-selected={selected}
      aria-label={`${task.title || 'Untitled'}${isInMyDay ? ', in My Day' : ''}${task.priority ? `, ${priorities[task.priority]} priority` : ''}${meta.contextLabel ? `, in ${meta.contextLabel}` : ''}`}
      draggable={!isPhone && !nested && canOrder}
      onDragStart={(event) => {
        dragSource = { id: task.id, sectionId };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
      }}
      onDragEnd={() => {
        dragSource = null;
        setDropSide(null);
      }}
      onDragOver={(event) => {
        if (!canOrder || !dragSource || dragSource.sectionId !== sectionId || dragSource.id === task.id) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setDropSide(event.clientY - rect.top < rect.height / 2 ? 'above' : 'below');
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(event) => {
        event.preventDefault();
        const source = dragSource;
        setDropSide(null);
        // A cancelled drag makes no change (R26).
        if (!canOrder || !source || source.sectionId !== sectionId || source.id === task.id) return;
        const ids = orderIds.filter((id) => id !== source.id);
        const at = ids.indexOf(task.id);
        if (at < 0 || !orderIds.includes(source.id)) return;
        const insertAt = dropSide === 'above' ? at : at + 1;
        if (scope === 'errands') {
          ids.splice(insertAt, 0, source.id);
          actions.orderItems(ids, scope);
        } else actions.reorderTask(source.id, ids[insertAt - 1] ?? null, ids[insertAt] ?? null, scope);
        dragSource = null;
      }}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) toggleSelected(task.id);
        else if (event.shiftKey) extendSelection(task.id, orderedIds);
        else if (selecting) toggleSelected(task.id);
        else if (isPhone && mobileMode === 'arrange') return;
        else if (selection.length > 0) setSelection([]);
        else openItem(task.id);
      }}
      className={`task-row row group relative flex cursor-default items-start gap-3 px-3 py-2.5 ${
        nested ? 'ml-5 border-l border-line pl-3' : ''
      } ${
        dropSide === 'above' ? 'shadow-[inset_0_2px_0_0_var(--accent)]' : dropSide === 'below' ? 'shadow-[inset_0_-2px_0_0_var(--accent)]' : ''
      }`}
    >
      {selected ? (
        <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent-fill" />
      ) : null}
      {selecting ? (
        <button
          type="button"
          aria-label={`${selected ? 'Remove' : 'Add'} ${task.title || 'untitled task'} ${selected ? 'from' : 'to'} selection`}
          aria-pressed={selected}
          onClick={(event) => { event.stopPropagation(); toggleSelected(task.id); }}
          className="task-select-control flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-full border text-[14px] font-bold ${selected ? 'border-accent bg-accent-fill text-accent-fill-contrast' : 'border-line-strong bg-surface'}`}>
            {selected ? '✓' : ''}
          </span>
        </button>
      ) : <StatusControl
        status={task.status}
        label={task.title || 'Untitled task'}
        onComplete={() => actions.setStatus(selected ? selection : [task.id], 'completed')}
        onCancel={() => actions.setStatus(selected ? selection : [task.id], 'canceled')}
        onReopen={() => actions.setStatus(selected ? selection : [task.id], 'open')}
      />}
      {isInMyDay && !isPhone ? (
        <span className="mt-0.5 shrink-0 text-[var(--today)]" title="In My Day">
          <SunIcon size={16} />
        </span>
      ) : null}
      <div className="task-row-content min-w-0 flex-1">
        <div className="task-title-line flex flex-wrap items-baseline gap-x-2">
          <span className={`task-title text-[14.5px] leading-snug ${task.status !== 'open' ? 'text-muted line-through decoration-[color-mix(in_srgb,var(--text)_35%,transparent)]' : 'text-ink'}`}>
            {task.title || <span className="text-faint">Untitled</span>}
          </span>
          {meta.repeating ? <RepeatIcon size={12} className="translate-y-[1px] text-faint" /> : null}
          {task.notes.trim() ? <NoteIcon size={12} className="translate-y-[1px] text-faint" /> : null}
          {meta.checklistTotal > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[12px] tabular-nums text-faint">
              <ChecklistIcon size={12} />{meta.checklistChecked}/{meta.checklistTotal}
            </span>
          ) : null}
        </div>
        {(isPhone && isInMyDay && !myDayView) || (task.startDate && !(myDayView && task.startDate <= today)) || task.deadline || task.priority || meta.contextLabel || meta.heldContextLabel || meta.tagIds.length > 0 || task.planning === 'someday' || (myDayView && task.eveningDate !== null && task.eveningDate === task.startDate) ? (
          <div className="task-metadata mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {isPhone && isInMyDay && !myDayView ? <span className="inline-flex items-center gap-1 text-[var(--today)]"><SunIcon size={12} />My Day</span> : null}
            <DateChip task={task} today={today} hideStart={myDayView} />
            {task.priority ? <Pill tone={task.priority === 'urgent' ? 'danger' : task.priority === 'low' ? 'neutral' : 'warm'} icon={<FlagIcon size={11} />}>{priorities[task.priority]}</Pill> : null}
            {meta.contextLabel ? <span className="text-[12px] text-faint">{meta.contextLabel}</span> : null}
            {meta.heldContextLabel ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--someday)]">
                <AlertIcon size={12} />Due date reached in held “{meta.heldContextLabel}”
              </span>
            ) : null}
            {[...meta.tagIds].sort((a, b) => Number(b === ERRANDS_TAG_ID) - Number(a === ERRANDS_TAG_ID)).slice(0, 3).map((tagId) => (
              <span className="task-tag" key={tagId}><Chip><TagDot color={getTag(db, tagId)?.color} />{tagPath(db, tagId)}</Chip></span>
            ))}
          </div>
        ) : null}
      </div>
      {canOrder && orderIds.length > 1 && (!isPhone || mobileMode === 'arrange') ? <OrderHandle id={task.id} ids={orderIds} group={sectionId} scope={scope} /> : null}
    </li>
  );
}

function ProjectRow({
  item, expandable = false, expanded = false, onToggle, order,
}: {
  item: Extract<ListItem, { kind: 'project' }>;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  order?: { ids: string[]; group: string };
}) {
  const setView = useApp((s) => s.setView);
  const today = useApp((s) => s.today);
  const { project, progress, meta } = item;
  return (
    <li data-row tabIndex={0} data-id={project.id} data-order-group={order?.group} data-order-title={project.title}
      role="option"
      aria-selected={false}
      onKeyDown={(event) => {
        if (event.key === 'Enter') setView(`project:${project.id}`);
        else if (expandable && event.key === 'ArrowRight' && !expanded) {
          event.preventDefault();
          onToggle?.();
        } else if (expandable && event.key === 'ArrowLeft' && expanded) {
          event.preventDefault();
          onToggle?.();
        }
      }}
      onClick={() => setView(`project:${project.id}`)}
      className="project-row row flex min-h-[46px] cursor-default items-center gap-3 px-3"
    >
      <ProgressRing percent={progress.percent} size={18} />
      <span className="project-title min-w-0 flex-1 truncate text-[14.5px] font-medium">{project.title}</span>
      {project.deadline ? (
        <span className={`text-[12px] ${meta.overdue ? 'text-danger' : 'text-[var(--upcoming)]'}`}>
          <FlagIcon size={12} className="mr-1 inline" />Due {formatDateLabel(project.deadline, today)}
        </span>
      ) : null}
      <span className="text-[12px] tabular-nums text-faint">
        {progress.percent === null ? 'No tasks' : `${progress.completed} of ${progress.total}`}
      </span>
      {order && order.ids.length > 1 ? <OrderHandle id={project.id} ids={order.ids} group={order.group} scope="structural" /> : null}
      {expandable ? (
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.title}`}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          style={{ width: 44, minWidth: 44 }}
          className="-my-1.5 -mr-2 flex h-11 shrink-0 items-center justify-center rounded-lg text-faint hover:text-muted"
        >
          <ChevronIcon size={16} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <ChevronIcon size={14} className="text-faint" />
      )}
    </li>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const time = event.allDay
    ? 'All day'
    : event.startInstant
      ? new Date(event.startInstant).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
  return (
    <li className="calendar-event-row flex items-center gap-3 rounded-md px-3 py-[7px] text-muted">
      <span aria-hidden="true" className="h-4 w-[3px] shrink-0 rounded-full bg-[var(--upcoming)]" />
      <span className="min-w-0 flex-1 truncate text-[14px]">
        {event.sourceUrl ? (
          <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{event.title}</a>
        ) : event.title}
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-faint">{time}</span>
    </li>
  );
}

function InlineComposer({ target, onDone }: { target: AddTarget; onDone: () => void }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <li className="fade-in px-0.5 py-1">
      <div className="card flex items-center gap-2.5 px-3 ring-2 ring-[color-mix(in_srgb,var(--accent-fill)_35%,transparent)]">
        <span aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-[7px] border-[1.5px] border-dashed border-control" />
        <input
          ref={ref}
          type="text"
          value={value}
          spellCheck={true}
          aria-label="New task title"
          placeholder="New task"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            // Closing an empty editor leaves the task count unchanged (R01).
            if (value.trim()) actions.addTask(target, value);
            onDone();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!value.trim()) {
                onDone();
                return;
              }
              actions.addTask(target, value);
              setValue('');
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setValue('');
              onDone();
            }
          }}
          className="h-10 w-full bg-transparent text-[14.5px] outline-none placeholder:text-faint"
        />
      </div>
    </li>
  );
}

function TaskTagFilter({
  view, expandPrintChecklists, onExpandPrintChecklistsChange, hidePrintControls = false,
}: {
  view: 'today' | 'allTasks';
  expandPrintChecklists: boolean;
  onExpandPrintChecklistsChange: (expanded: boolean) => void;
  hidePrintControls?: boolean;
}) {
  const db = useApp((s) => s.db);
  const tagFilter = useApp((s) => s.tagFilter);
  const setTagFilter = useApp((s) => s.setTagFilter);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [namingView, setNamingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const viewLabel = view === 'today' ? 'My Day' : 'All Tasks';
  const tags = useMemo(
    () => getSelectableTags(db)
      .sort((a, b) => tagPath(db, a.id).localeCompare(tagPath(db, b.id))),
    [db],
  );
  const filterCount = tagFilter.tagIds.length + Number(tagFilter.untagged);
  const active = tagFilterActive(tagFilter);
  const suggestedViewName = useMemo(() => {
    const names = tagFilter.tagIds.map((id) => tagPath(db, id));
    if (tagFilter.untagged) names.unshift('Untagged');
    if (names.length === 0) return `${viewLabel} view`;
    return `${tagFilter.mode === 'exclude' ? 'Without ' : ''}${names.join(' + ')}`;
  }, [db, tagFilter, viewLabel]);

  const toggle = (tagId: string) => {
    const selected = tagFilter.tagIds.includes(tagId);
    setTagFilter({
      ...tagFilter,
      tagIds: selected
        ? tagFilter.tagIds.filter((id) => id !== tagId)
        : [...tagFilter.tagIds, tagId],
    });
  };

  return (
    <div className="task-tag-filter flex items-center gap-1">
      <Button size="sm" variant={active ? 'secondary' : 'ghost'} onClick={(event) => { setNamingView(false); setAnchor(event.currentTarget); }}>
        <TagIcon size={14} /> Tags{active ? ` (${filterCount}${tagFilter.mode === 'exclude' ? ' excluded' : ''})` : ''}
      </Button>
      {active ? <Button size="sm" variant="ghost" onClick={() => setTagFilter(emptyTagFilter())}>Clear</Button> : null}
      {view === 'today' && !hidePrintControls ? (
        <>
          <label className="flex min-h-9 items-center gap-1.5 px-2 text-[12.5px] text-muted">
            <input
              type="checkbox"
              checked={expandPrintChecklists}
              onChange={(event) => onExpandPrintChecklistsChange(event.target.checked)}
              className="h-4 w-4"
            />
            Expand checklists
          </label>
          <Button size="sm" variant="ghost" onClick={() => window.print()}>
            <PrintIcon size={15} /> Print
          </Button>
        </>
      ) : null}
      {anchor ? (
        <Popover anchor={anchor} onClose={() => { setNamingView(false); setAnchor(null); }} label={`Filter ${viewLabel} by tags`} width={300}>
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <p className="text-[12px] text-faint">
              {tagFilter.mode === 'exclude'
                ? active ? 'Unchecked options are excluded.' : 'All selected. Uncheck an option to exclude it.'
                : 'Select tags to narrow the list. With nothing selected, all tasks appear.'}
            </p>
          </div>
          <div className="flex gap-2 px-2 pb-1">
            <button type="button" onClick={() => setTagFilter({ mode: 'exclude', tagIds: [], untagged: false })}
              className="min-h-11 text-[13px] font-medium text-accent hover:underline">Select all</button>
            <button type="button" onClick={() => setTagFilter(emptyTagFilter())}
              className="min-h-11 text-[13px] font-medium text-muted hover:underline">Reset</button>
          </div>
          <ul>
            <li>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] hover:bg-surface-2">
                <input type="checkbox" checked={tagFilter.mode === 'exclude' ? !tagFilter.untagged : tagFilter.untagged}
                  onChange={() => setTagFilter({ ...tagFilter, untagged: !tagFilter.untagged })} className="h-5 w-5" />
                <TagIcon size={14} className="text-faint" />
                <span>Untagged</span>
              </label>
            </li>
            {tags.map((tag) => (
              <li key={tag.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={tagFilter.mode === 'exclude' ? !tagFilter.tagIds.includes(tag.id) : tagFilter.tagIds.includes(tag.id)}
                    onChange={() => toggle(tag.id)}
                    className="h-5 w-5"
                  />
                  <TagDot color={tag.color} />
                  <span className="min-w-0 flex-1 truncate">{tagPath(db, tag.id)}{tag.id === ERRANDS_TAG_ID ? ' · Automatic' : ''}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-line px-2 pt-2">
            {namingView ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = viewName.trim();
                  if (!name || !active) return;
                  actions.createSavedView({ name, query: '', searchAll: false, tagFilter });
                  setNamingView(false);
                  setAnchor(null);
                }}
              >
                <label htmlFor="tag-view-name" className="w-full text-[12px] font-medium text-muted">View name</label>
                <input
                  id="tag-view-name" type="text" autoFocus value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13.5px] outline-none focus:border-accent"
                />
                <Button size="sm" type="submit" disabled={!viewName.trim()}>Save</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setNamingView(false)}>Cancel</Button>
              </form>
            ) : (
              <Button
                size="sm" variant="secondary" full disabled={!active}
                onClick={() => { setViewName(suggestedViewName); setNamingView(true); }}
              >
                Save combination as view
              </Button>
            )}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/** Heading actions: rename, archive, duplicate, promote and delete (R08, R10). */
function HeadingMenu({ headingId, title }: { headingId: string; title: string }) {
  const db = useApp((s) => s.db);
  const setView = useApp((s) => s.setView);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [draft, setDraft] = useState(title);

  const heading = db.headings[headingId];
  const openTasks = Object.values(db.tasks).filter(
    (t) => t.headingId === headingId && t.deletedAt === null && t.status === 'open',
  ).length;

  if (renaming) {
    return (
      <input
        type="text"
        autoFocus
        value={draft}
        aria-label={`Rename heading ${title}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft.trim()) actions.renameHeading(headingId, draft);
          setRenaming(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft.trim()) actions.renameHeading(headingId, draft);
          if (event.key === 'Enter' || event.key === 'Escape') setRenaming(false);
        }}
        className="h-7 rounded-md border border-accent bg-surface px-2 text-[13px] outline-none"
      />
    );
  }

  const item = 'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13.5px] hover:bg-surface-2';

  return (
    <>
      <IconButton label={`Actions for heading ${title}`} onClick={(event) => setAnchor(event.currentTarget)}>
        <MoreIcon size={15} />
      </IconButton>
      {anchor ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label={`Heading ${title}`} width={230}>
          <button type="button" className={item} onClick={() => { setDraft(title); setRenaming(true); setAnchor(null); }}>
            Rename
          </button>
          <button type="button" className={item} onClick={() => { setDuplicating(true); setAnchor(null); }}>
            <CopyIcon size={14} />Duplicate
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              const projectId = actions.promoteToProject('heading', headingId);
              setAnchor(null);
              if (projectId) setView(`project:${projectId}`);
            }}
          >
            <PromoteIcon size={14} />Make it a project
          </button>
          <button
            type="button"
            className={item}
            disabled={openTasks > 0 || heading?.archivedAt !== null}
            onClick={() => { actions.archiveHeading(headingId); setAnchor(null); }}
          >
            Archive
            {openTasks > 0 ? (
              <span className="ml-auto text-[11.5px] text-faint">{openTasks} still open</span>
            ) : null}
          </button>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            className={`${item} text-danger`}
            onClick={() => { actions.deleteHeading(headingId, false); setAnchor(null); }}
          >
            <TrashIcon size={14} />Delete, keep the tasks
          </button>
          <button
            type="button"
            className={`${item} text-danger`}
            onClick={() => { actions.deleteHeading(headingId, true); setAnchor(null); }}
          >
            <TrashIcon size={14} />Delete with its tasks
          </button>
        </Popover>
      ) : null}
      {duplicating ? (
        <DuplicateDialog
          kind="heading"
          title={title}
          onClose={() => setDuplicating(false)}
          onConfirm={(options) => actions.duplicate('heading', headingId, options)}
        />
      ) : null}
    </>
  );
}

function SectionHeader({ section, onAdd, onPrint }: { section: ListSection; onAdd: () => void; onPrint?: () => void }) {
  if (!section.title) return null;
  const isHeading = section.id.startsWith('heading:');
  return (
    <div className="list-section-header mt-6 mb-1.5 flex items-center gap-2 px-3 first:mt-1">
      {isHeading ? (
        <span aria-hidden="true" className="h-[14px] w-[3px] shrink-0 rounded-full view-accent-bg opacity-80" />
      ) : null}
      <h2
        className={
          isHeading
            ? 'text-[14px] font-semibold tracking-[-0.01em] text-ink'
            : 'text-[11.5px] font-bold uppercase tracking-[0.1em] text-faint'
        }
      >
        {section.title}
      </h2>
      {section.subtitle ? <span className="text-[12px] text-faint">{section.subtitle}</span> : null}
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      {isHeading ? <HeadingMenu headingId={section.id.slice(8)} title={section.title} /> : null}
      {onPrint ? <IconButton label={`Print ${section.title}`} onClick={onPrint}><PrintIcon size={15} /></IconButton> : null}
      {section.addTarget ? (
        <IconButton label={section.title === 'Other tasks' ? 'Add a task' : `Add a task to ${section.title}`} onClick={onAdd}><PlusIcon size={15} /></IconButton>
      ) : null}
    </div>
  );
}

/** The batch toolbar shown while a multiple selection is active (R24). */
function SelectionBar({ ids }: { ids: string[] }) {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const settings = useApp((s) => s.db.settings);
  const clearSelection = useApp((s) => s.clearSelection);
  const isPhone = usePhone();
  const [popover, setPopover] = useState<'when' | 'deadline' | 'move' | 'more' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const commonCurrentTarget = useMemo(() => {
    const tasks = ids.map((id) => db.tasks[id]).filter((task): task is Task => Boolean(task));
    const first = tasks[0];
    if (!first || tasks.length !== ids.length) return null;
    const matches = tasks.every((task) =>
      task.parentType === first.parentType &&
      task.parentId === first.parentId &&
      task.headingId === first.headingId);
    return matches
      ? { parentType: first.parentType, parentId: first.parentId, headingId: first.headingId }
      : null;
  }, [db.tasks, ids]);

  const open = (kind: typeof popover) => (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchor(event.currentTarget);
    setPopover(kind);
  };

  return (
    <div
      role="toolbar"
      aria-label={`${ids.length} selected`}
      className="list-selection-bar pop-in sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]"
    >
      <span className="selection-count rounded-full bg-accent-soft px-2.5 py-0.5 text-[12.5px] font-semibold tabular-nums text-accent" aria-live="polite">{ids.length} selected</span>
      {!isPhone ? <Button size="sm" variant="ghost" onClick={open('when')}><CalendarIcon size={14} />When</Button> : null}
      <Button size="sm" variant="ghost" onClick={open('deadline')}><FlagIcon size={14} />Due</Button>
      <Button size="sm" variant="ghost" onClick={open('move')}><MoveIcon size={14} />Move</Button>
      <Button size="sm" variant="ghost" onClick={() => { actions.setStatus(ids, 'completed'); clearSelection(); }}>Complete</Button>
      {!isPhone ? <>
        <Button size="sm" variant="ghost" onClick={() => { actions.setStatus(ids, 'canceled'); clearSelection(); }}>Cancel</Button>
        <IconButton label="Move selection to Trash" tone="danger" onClick={() => actions.deleteTasks(ids)}><TrashIcon /></IconButton>
      </> : <IconButton label="More selection actions" onClick={open('more')}><MoreIcon /></IconButton>}
      <IconButton label="Clear selection" onClick={clearSelection}>×</IconButton>

      {popover === 'more' ? (
        <Popover anchor={anchor} onClose={() => setPopover(null)} label="Selection actions" width={270}>
          <div className="mobile-list-options">
            <button type="button" onClick={() => setPopover('when')}><CalendarIcon size={17} />Schedule selected tasks</button>
            <button type="button" onClick={() => { actions.setStatus(ids, 'canceled'); clearSelection(); setPopover(null); }}>Cancel selected tasks</button>
            <button type="button" className="text-danger" onClick={() => { actions.deleteTasks(ids); clearSelection(); setPopover(null); }}><TrashIcon size={17} />Move selection to Trash</button>
          </div>
        </Popover>
      ) : null}

      {popover === 'when' ? (
        <WhenPopover
          anchor={anchor} onClose={() => setPopover(null)} today={today}
          locale={settings.locale} timeZone={settings.planningTimeZone}
          value={{ planning: 'scheduled', startDate: today, evening: false, reminder: null }}
          onChange={(value) => { actions.applyWhen(ids, value); clearSelection(); }}
        />
      ) : null}
      {popover === 'deadline' ? (
        <DeadlinePopover
          anchor={anchor} onClose={() => setPopover(null)} today={today}
          locale={settings.locale} timeZone={settings.planningTimeZone}
          startDate={null} value={null}
          onChange={(value) => { actions.applyDeadline(ids, value); clearSelection(); }}
        />
      ) : null}
      {popover === 'move' ? (
        <MovePicker
          anchor={anchor} onClose={() => setPopover(null)} db={db}
          currentTarget={commonCurrentTarget}
          onPick={(target) => { actions.moveTasks(ids, target); clearSelection(); }}
        />
      ) : null}
    </div>
  );
}

/** A read-only paper layout of the same filtered and sorted My Day document. */
function PrintChecklist({ taskId, expanded }: { taskId: string; expanded: boolean }) {
  const checklistItems = useApp((s) => s.db.checklistItems);
  if (!expanded) return null;
  const rows = Object.values(checklistItems)
    .filter((row) => row.taskId === taskId && row.deletedAt === null)
    .sort(byRank);
  if (rows.length === 0) return null;

  return (
    <ul className="print-checklist" aria-label="Checklist">
      {rows.map((row) => (
        <li key={row.id} className={`print-checklist-row${row.checked ? ' is-checked' : ''}`}>
          <span className="print-checklist-checkbox" aria-hidden="true">{row.checked ? '✓' : ''}</span>
          <span className="print-checklist-text">{row.text || 'Untitled row'}</span>
        </li>
      ))}
    </ul>
  );
}

function MyDayPrint({ doc, expandChecklists }: { doc: ListDocument; expandChecklists: boolean }) {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const sections = doc.sections.filter((section) => section.items.length > 0);

  return (
    <article data-print-my-day>
      <header className="my-day-print-header">
        <h1>My Day</h1>
        <p>{doc.subtitle}</p>
      </header>
      {sections.length === 0 ? <p>No items in My Day.</p> : sections.map((section) => (
        <section key={section.id} className="my-day-print-section">
          <h2>{section.title ?? (section.isEventSection ? 'Calendar' : 'Tasks')}</h2>
          <ul>
            {section.items.map((item) => {
              if (item.kind === 'event') {
                const time = item.event.allDay ? 'All day' : item.event.startInstant
                  ? new Date(item.event.startInstant).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
                return <li key={item.id} className="my-day-print-row my-day-print-event"><span>{item.event.title}</span><span>{time}</span></li>;
              }
              if (item.kind === 'project') {
                return <li key={item.id} className="my-day-print-row my-day-print-project"><span>{item.project.title}</span><span>Project</span></li>;
              }
              if (item.kind !== 'task') return null;
              return (
                <li key={item.id} className="my-day-print-row">
                  <span className="my-day-print-checkbox" aria-hidden="true" />
                  <div className="my-day-print-task-body">
                    <div className="my-day-print-task-title">{item.task.title || 'Untitled'}</div>
                    {item.task.deadline || item.meta.contextLabel || item.task.priority || item.meta.tagIds.length > 0 ? (
                      <div className="my-day-print-meta">
                        {item.task.deadline ? <span>Due {formatDateLabel(item.task.deadline, today)}</span> : null}
                        {item.meta.contextLabel ? <span>{item.meta.contextLabel}</span> : null}
                        {item.task.priority ? <span>{priorities[item.task.priority]}</span> : null}
                        {item.meta.tagIds.map((tagId) => <span key={tagId}>#{tagPath(db, tagId)}</span>)}
                      </div>
                    ) : null}
                    <PrintChecklist taskId={item.task.id} expanded={expandChecklists} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </article>
  );
}

/** Paper layout for exactly one Upcoming date, including its calendar events. */
function UpcomingDayPrint({
  date, items, twoColumns, splitIndex, printRef, expandChecklists,
}: {
  date: string;
  items: ListItem[];
  twoColumns: boolean;
  splitIndex: number;
  printRef: React.RefObject<HTMLElement | null>;
  expandChecklists: boolean;
}) {
  const db = useApp((s) => s.db);
  const settings = db.settings;
  const title = new Intl.DateTimeFormat(settings.locale, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  const taskCount = items.filter((item) => item.kind === 'task').length;
  const eventCount = items.filter((item) => item.kind === 'event').length;

  const renderItem = (item: ListItem) => {
    if (item.kind === 'event') {
      const time = item.event.allDay ? 'All day' : item.event.startInstant
        ? new Intl.DateTimeFormat(settings.locale, {
          hour: 'numeric', minute: '2-digit', timeZone: settings.planningTimeZone,
        }).format(new Date(item.event.startInstant)) : '';
      return <li key={item.id} className="day-print-row day-print-event"><span>{item.event.title}</span><span>{time}</span></li>;
    }
    if (item.kind === 'project') {
      return <li key={item.id} className="day-print-row day-print-project"><span>{item.project.title}</span><span>Project</span></li>;
    }
    if (item.kind !== 'task') return null;
    return (
      <li key={item.id} className="day-print-row day-print-task">
        <span className="day-print-checkbox" aria-hidden="true" />
        <div className="day-print-task-body">
          <div className="day-print-task-title">{item.task.title || 'Untitled'}</div>
          {item.meta.contextLabel || item.task.priority || item.meta.tagIds.length > 0 || item.meta.showStartMarker || item.meta.showDeadlineMarker ? (
            <div className="day-print-meta">
              {item.meta.showStartMarker ? <span>Scheduled</span> : null}
              {item.meta.showDeadlineMarker ? <span>Due</span> : null}
              {item.meta.contextLabel ? <span>{item.meta.contextLabel}</span> : null}
              {item.task.priority ? <span>{priorities[item.task.priority]}</span> : null}
              {item.meta.tagIds.map((tagId) => <span key={tagId}>#{tagPath(db, tagId)}</span>)}
            </div>
          ) : null}
          <PrintChecklist taskId={item.task.id} expanded={expandChecklists} />
        </div>
      </li>
    );
  };

  return (
    <article ref={printRef} data-print-upcoming-day data-columns={twoColumns ? '2' : '1'}>
      <header className="day-print-header">
        <h1>{title}</h1>
        <p>{taskCount} {taskCount === 1 ? 'task' : 'tasks'}{eventCount ? ` · ${eventCount} ${eventCount === 1 ? 'event' : 'events'}` : ''}</p>
      </header>
      <div className="day-print-columns">
        <ul className="day-print-items">{(twoColumns ? items.slice(0, splitIndex) : items).map(renderItem)}</ul>
        {twoColumns ? <ul className="day-print-items">{items.slice(splitIndex).map(renderItem)}</ul> : null}
      </div>
    </article>
  );
}

export function ListView({ doc: sourceDoc }: { doc: ListDocument }) {
  const selection = useApp((s) => s.selection);
  const openItemId = useApp((s) => s.openItemId);
  const openItem = useApp((s) => s.openItem);
  const clearSelection = useApp((s) => s.clearSelection);
  const db = useApp((s) => s.db);
  const indexes = useIndexes();
  const tagFilter = useApp((s) => s.tagFilter);
  const sort = db.settings.listSorts?.[sourceDoc.view] ?? (sourceDoc.view.startsWith('saved:') ? 'alphabetical' : 'manual');
  const [noArea, setNoArea] = useState(false);
  const supportsAreaFilter = sourceDoc.view === 'today' || sourceDoc.view === 'allTasks';
  const areaFilterActive = supportsAreaFilter && noArea;
  const doc = useMemo(() => groupErrandsDocument(sortDocument(areaFilterActive ? withoutAreaDocument(db, sourceDoc) : sourceDoc, sort, (tagId) => tagPath(db, tagId))), [sourceDoc, sort, db, areaFilterActive]);
  const canOrder = sort === 'manual' && !doc.view.startsWith('saved:') && !['upcoming', 'logbook', 'trash', 'review', 'allTasks'].includes(doc.view);
  const errandsView = isErrandsOrderingView(doc.view);
  const hasErrands = errandsView && doc.sections.some((section) => section.items.some((item) => item.kind === 'task' && isErrandTask(item.task)));
  const isPhone = usePhone();
  const [composerSection, setComposerSection] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [chosenPrintDate, setChosenPrintDate] = useState(() =>
    sourceDoc.sections.find((s) => s.id.startsWith('day:') && s.items.length)?.date
      ?? sourceDoc.sections.find((s) => s.id.startsWith('day:'))?.date ?? '');
  const [twoPrintColumns, setTwoPrintColumns] = useState(false);
  const [printSplitIndex, setPrintSplitIndex] = useState(0);
  const [expandPrintChecklists, setExpandPrintChecklists] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mobileMode, setMobileMode] = useState<MobileListMode>('browse');
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLElement | null>(null);
  const printRef = useRef<HTMLElement | null>(null);
  const selectedPrintItems = useMemo(() => chosenPrintDate ? upcomingItemsForDate(doc, chosenPrintDate) : [], [doc, chosenPrintDate]);
  const myDaySuggestions = useMemo(
    () => doc.view === 'today' ? suggestionsForMyDay(db, indexes, { tagFilter }) : [],
    [db, doc.view, indexes, tagFilter],
  );

  useEffect(() => {
    setMobileMode('browse');
    setOptionsAnchor(null);
    setNoArea(false);
  }, [doc.view]);

  useEffect(() => {
    if (doc.view !== 'upcoming') return;
    const firstDay = doc.sections.find((section) => section.id.startsWith('day:') && section.items.length)?.date
      ?? doc.sections.find((section) => section.id.startsWith('day:'))?.date;
    if (firstDay) setChosenPrintDate((current) => current || firstDay);
  }, [doc.view, doc.sections]);

  const prepareUpcomingPrint = useCallback(() => {
    const count = printRef.current?.querySelectorAll('.day-print-row').length ?? 0;
    flushSync(() => { setTwoPrintColumns(false); setPrintSplitIndex(count); });
    const height = printRef.current?.scrollHeight ?? 0;
    if (count > 1 && needsBalancedColumns(height)) {
      // Measure at the actual half-page width before choosing the paper break.
      flushSync(() => setTwoPrintColumns(true));
      const rowHeights = [...(printRef.current?.querySelectorAll('.day-print-row') ?? [])]
        .map((row) => row.getBoundingClientRect().height);
      const split = rowHeights.length === count
        ? balancedColumnSplit(rowHeights)
        : Math.ceil(count / 2);
      flushSync(() => setPrintSplitIndex(split));
    }
  }, []);

  useEffect(() => {
    if (doc.view !== 'upcoming') return;
    // AirPrint ends individual preview/PDF render phases with afterprint. Keep
    // the selected day's article mounted for every phase, including Share > Print.
    window.addEventListener('beforeprint', prepareUpcomingPrint);
    return () => window.removeEventListener('beforeprint', prepareUpcomingPrint);
  }, [doc.view, prepareUpcomingPrint]);

  const printUpcomingDate = useCallback((date: string) => {
    if (!date || upcomingItemsForDate(doc, date).length === 0) return;
    flushSync(() => setChosenPrintDate(date));
    prepareUpcomingPrint();
    window.print();
  }, [doc, prepareUpcomingPrint]);

  const scope: 'structural' | 'today' = doc.view === 'today' ? 'today' : 'structural';
  const orderedIdsBySection = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const section of doc.sections) {
      map.set(section.id, section.items.filter((i) => i.kind === 'task').map((i) => (i as { task: Task }).task.id));
    }
    return map;
  }, [doc]);

  const allProjectIds = useMemo(
    () => doc.sections.flatMap((section) => section.items)
      .filter((item) => item.kind === 'project')
      .map((item) => item.project.id),
    [doc],
  );
  const everyProjectExpanded = allProjectIds.length > 0 && allProjectIds.every((id) => expandedProjects.has(id));
  const anyProjectExpanded = allProjectIds.some((id) => expandedProjects.has(id));

  const openTask: Task | undefined = openItemId ? db.tasks[openItemId] : undefined;

  const isEmpty = doc.sections.every((s) => s.items.length === 0);
  const trashItemCount = doc.view === 'trash'
    ? doc.sections.reduce((count, section) => count + section.items.length, 0)
    : 0;

  const addTo = useCallback((section: ListSection) => {
    setComposerSection(section.id);
    openItem(null);
  }, [openItem]);

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const activeMobileMode: MobileListMode = selection.length > 0 ? 'select' : mobileMode;
  const hasTaskRows = doc.sections.some((section) => section.items.some((item) =>
    item.kind === 'task' || (item.kind === 'project' && (item.children?.length ?? 0) > 0)));
  const changeSort = (value: ListSort) => actions.updateSettings({ listSorts: { ...db.settings.listSorts, [doc.view]: value } });
  const areaFilterControl = supportsAreaFilter ? (
    <label className="flex min-h-11 items-center gap-2 px-2 text-sm text-muted">
      <input type="checkbox" checked={areaFilterActive} onChange={(event) => setNoArea(event.target.checked)} className="h-5 w-5" />
      No area
    </label>
  ) : null;
  const sortControl = !['logbook', 'trash'].includes(doc.view) ? isPhone ? (
    <fieldset className="mobile-sort-choices">
      <legend>Sort</legend>
      {sortChoices.map((choice) => <label key={choice.value}>
        <input type="radio" name="list-sort" value={choice.value} checked={sort === choice.value}
          onChange={() => changeSort(choice.value)} />
        <span>{choice.label}</span>
      </label>)}
    </fieldset>
  ) : (
    <label className="list-sort-control flex items-center gap-1.5 text-[12.5px] text-muted">
      <span className={isPhone ? '' : 'sr-only sm:not-sr-only'}>Sort</span>
      <select aria-label="Sort items" className="h-8 max-w-[200px] rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink shadow-[var(--shadow-card)]" value={sort}
        onChange={(e) => changeSort(e.target.value as ListSort)}>
        <option value="manual">Manual order</option>
        <option value="alphabetical">Alphabetical (A–Z)</option>
        <option value="alphabeticalDesc">Alphabetical (Z–A)</option>
        <option value="due">Due date (earliest first)</option>
        <option value="dueDesc">Due date (latest first)</option>
        <option value="created">Created date (newest first)</option>
        <option value="createdAsc">Created date (oldest first)</option>
        <option value="priority">Priority (highest first)</option>
        <option value="priorityDesc">Priority (lowest first)</option>
        <option value="tags">Tags (A–Z)</option>
        <option value="tagsDesc">Tags (Z–A)</option>
      </select>
    </label>
  ) : null;
  const expandChecklistControl = (
    <label className="flex min-h-9 items-center gap-1.5 px-1 text-[12.5px] text-muted">
      <input type="checkbox" checked={expandPrintChecklists}
        onChange={(event) => setExpandPrintChecklists(event.target.checked)} className="h-4 w-4" />
      Expand checklists when printing
    </label>
  );
  const finishMobileMode = () => {
    clearSelection();
    setMobileMode('browse');
  };
  // Grouped My Day can contain only appointments/errands/Evening. Preserve a
  // regular-day creation target even when no ordinary project group exists yet.
  const displaySections: ListSection[] = isPhone && doc.view === 'today' &&
    !doc.sections.some((section) => !section.isEventSection && section.id !== 'evening' && section.addTarget)
    ? [{ id: 'mobile-day-add', title: null, subtitle: null, date: null, items: [], addTarget: doc.addTarget }, ...doc.sections]
    : doc.sections;

  return (
    <>
      <div data-list-root data-mobile-mode={activeMobileMode} className="task-list pt-1 pb-24">
        {doc.view === 'upcoming' && !isPhone ? (
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2 px-1 text-[12.5px] text-muted">
            <label htmlFor="upcoming-print-date">Print a day</label>
            <input
              id="upcoming-print-date" type="date" value={chosenPrintDate}
              onChange={(event) => setChosenPrintDate(event.target.value)}
              className="h-9 rounded-md border border-line bg-surface px-2 text-ink"
            />
            <label className="flex min-h-9 items-center gap-1.5 px-1">
              <input
                type="checkbox"
                checked={expandPrintChecklists}
                onChange={(event) => setExpandPrintChecklists(event.target.checked)}
                className="h-4 w-4"
              />
              Expand checklists
            </label>
            <Button size="sm" variant="ghost" disabled={selectedPrintItems.length === 0} onClick={() => printUpcomingDate(chosenPrintDate)}>
              <PrintIcon size={15} /> Print
            </Button>
          </div>
        ) : null}
        {isPhone ? (
          <div className="mobile-list-toolbar">
            {activeMobileMode !== 'browse' ? (
              <>
                <span className="mobile-list-mode-label">{activeMobileMode === 'select' ? 'Select tasks' : 'Arrange list'}</span>
                <Button size="sm" variant="ghost" onClick={finishMobileMode}>Done</Button>
              </>
            ) : (
              <>
                {doc.view === 'today' || doc.view === 'allTasks' ? <TaskTagFilter
                  view={doc.view} expandPrintChecklists={expandPrintChecklists}
                  onExpandPrintChecklistsChange={setExpandPrintChecklists} hidePrintControls /> : null}
                <span className="flex-1" />
                {areaFilterActive ? <Button size="sm" variant="secondary" onClick={() => setNoArea(false)}>No area ×</Button> : null}
                {hasTaskRows ? <Button size="sm" variant="ghost" onClick={() => setMobileMode('select')}>Select</Button> : null}
                <IconButton label="View options" onClick={(event) => setOptionsAnchor(event.currentTarget)}><MoreIcon size={20} /></IconButton>
              </>
            )}
          </div>
        ) : <div className="mb-2 flex flex-wrap items-center justify-end gap-x-1 gap-y-1 px-1">
          {doc.view === 'today' && myDaySuggestions.length > 0 ? (
            <Button size="sm" variant={showSuggestions ? 'secondary' : 'ghost'} onClick={() => setShowSuggestions((value) => !value)}>
              <SunIcon size={14} />Suggestions ({myDaySuggestions.length})
            </Button>
          ) : null}
          {doc.view === 'today' || doc.view === 'allTasks' ? (
            <TaskTagFilter
              view={doc.view}
              expandPrintChecklists={expandPrintChecklists}
              onExpandPrintChecklistsChange={setExpandPrintChecklists}
            />
          ) : null}
          {doc.view === 'trash' ? (
            <Button size="sm" variant="danger" disabled={isEmpty} onClick={() => setConfirmEmptyTrash(true)}>
              <TrashIcon size={14} />Empty Trash
            </Button>
          ) : null}
          {sortControl}
          {areaFilterControl}
        </div>}
        {isPhone && optionsAnchor ? (
          <Popover anchor={optionsAnchor} onClose={() => setOptionsAnchor(null)} label="View options" width={320}>
            <div className="mobile-list-options">
              {areaFilterControl}
              {sortControl}
              {hasTaskRows ? <button type="button" onClick={() => { setMobileMode('select'); setOptionsAnchor(null); }}><ChecklistIcon size={17} />Select tasks</button> : null}
              {(canOrder || hasErrands) && !isEmpty ? <button type="button" onClick={() => { clearSelection(); setMobileMode('arrange'); setOptionsAnchor(null); }}><span aria-hidden="true">⠿</span>{canOrder ? 'Arrange list' : 'Arrange errands'}</button> : null}
              {doc.view === 'today' && myDaySuggestions.length > 0 ? <button type="button" onClick={() => { setShowSuggestions((value) => !value); setOptionsAnchor(null); }}><SunIcon size={17} />{showSuggestions ? 'Hide' : 'Show'} suggestions ({myDaySuggestions.length})</button> : null}
              {doc.view === 'today' || doc.view === 'upcoming' ? (
                <div className="mobile-print-options">
                  <h3>Print</h3>
                  {doc.view === 'upcoming' ? <label className="mobile-print-date-label" htmlFor="upcoming-print-date">Choose a day<input
                    id="upcoming-print-date" type="date" value={chosenPrintDate}
                    onChange={(event) => setChosenPrintDate(event.target.value)}
                    className="h-9 rounded-md border border-line bg-surface px-2 text-ink" />
                  </label> : null}
                  {expandChecklistControl}
                  <Button size="sm" variant="secondary" full disabled={doc.view === 'upcoming' && selectedPrintItems.length === 0} onClick={() => {
                    flushSync(() => setOptionsAnchor(null));
                    if (doc.view === 'upcoming') printUpcomingDate(chosenPrintDate);
                    else window.print();
                  }}><PrintIcon size={17} />Print {doc.view === 'today' ? 'My Day' : 'selected day'}</Button>
                </div>
              ) : null}
              {doc.view === 'trash' ? <button type="button" disabled={isEmpty} className="text-danger" onClick={() => { setOptionsAnchor(null); setConfirmEmptyTrash(true); }}><TrashIcon size={17} />Empty Trash</button> : null}
            </div>
          </Popover>
        ) : null}
        {isPhone && activeMobileMode !== 'browse' ? <p role="status" className="mobile-list-mode-hint">{activeMobileMode === 'select' ? 'Tap tasks to select them for a shared action.' : canOrder ? 'Drag a handle to change the order.' : 'Drag the handles to arrange your errand stops.'}</p> : null}
        {doc.view === 'today' && showSuggestions && myDaySuggestions.length > 0 ? (
          <section aria-label="My Day suggestions" className="mx-1 mb-3 rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-3 px-1 pb-1.5">
              <div>
                <h2 className="text-[14px] font-semibold">Suggested for My Day</h2>
                <p className="text-[12px] text-faint">Due soon or important. Nothing is added automatically.</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowSuggestions(false)}>Hide</Button>
            </div>
            <ul className="divide-y divide-line">
              {myDaySuggestions.map((task) => {
                const context = contextLabelFor(db, task);
                return (
                  <li key={task.id} className="flex min-h-11 items-center gap-2 px-1 py-1.5">
                    <button type="button" onClick={() => openItem(task.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[14px] text-ink">{task.title || 'Untitled'}</span>
                      <span className="block truncate text-[11.5px] text-faint">
                        {[task.deadline ? `Due ${formatDateLabel(task.deadline, indexes.today)}` : null,
                          task.priority ? priorities[task.priority] : null, context].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    <Button size="sm" variant="ghost" onClick={() => actions.setInToday(task.id, true)}>
                      <PlusIcon size={13} />My Day
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {hasErrands ? <p className="list-order-hint mb-2 px-3 text-[12px] text-faint">{isPhone ? 'Errands first' : 'Errands first · drag the handles to arrange your stops. Sort applies to other tasks.'}</p> : null}
        {doc.view === 'allProjects' && allProjectIds.length > 0 ? (
          <div role="group" aria-label="Project display" className="mb-1 flex justify-end gap-1 px-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={everyProjectExpanded}
              onClick={() => setExpandedProjects(new Set(allProjectIds))}
            >
              Show all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!anyProjectExpanded}
              onClick={() => setExpandedProjects(new Set())}
            >
              Hide all
            </Button>
          </div>
        ) : null}

        {isEmpty && !composerSection ? (
          <div className="fade-in flex flex-col items-center gap-3 px-4 py-16 text-center">
            <span aria-hidden="true" className="badge-wash flex h-16 w-16 items-center justify-center rounded-[22px] [&>svg]:h-7 [&>svg]:w-7">
              {viewStyle(doc.view).icon}
            </span>
            <p className="max-w-[34ch] text-[14px] leading-relaxed text-muted">{doc.emptyMessage}</p>
          </div>
        ) : null}

        {displaySections.map((section) => {
          if (section.items.length === 0 && composerSection !== section.id && !section.title && !(isPhone && section.addTarget)) return null;
          const orderedIds = orderedIdsBySection.get(section.id) ?? [];
          return (
            <section key={section.id} aria-label={section.title ?? doc.title}>
              <SectionHeader section={section} onAdd={() => addTo(section)}
                onPrint={doc.view === 'upcoming' && section.id.startsWith('day:') && section.date && section.items.length > 0
                  ? () => printUpcomingDate(section.date!) : undefined} />
              <ul
                role={section.isEventSection ? 'list' : 'listbox'}
                aria-multiselectable={section.isEventSection ? undefined : true}
                aria-label={section.title ?? doc.title}
                className={section.isEventSection ? 'mb-2 border-b border-line pb-2' : ''}
              >
                {section.items.map((item) => {
                  if (item.kind === 'event') return <EventRow key={item.id} event={item.event} />;
                  if (item.kind === 'project') {
                    const expandable = doc.view === 'allProjects';
                    const expanded = expandable && expandedProjects.has(item.project.id);
                    const childIds = (item.children ?? []).map((child) => child.task.id);
                    return (
                      <Fragment key={item.id}>
                        <ProjectRow
                          item={item}
                          order={canOrder && (!isPhone || activeMobileMode === 'arrange') ? { ids: section.items.filter((i) => i.kind === 'project').map((i) => i.project.id), group: `${section.id}:projects` } : undefined}
                          expandable={expandable}
                          expanded={expanded}
                          onToggle={expandable ? () => toggleProject(item.project.id) : undefined}
                        />
                        {expanded && childIds.length === 0 ? (
                          <li role="note" className="ml-8 border-l border-line px-4 py-2 text-[13px] text-faint">No open tasks</li>
                        ) : null}
                        {expanded ? (item.children ?? []).map((child) => (
                          <TaskRow
                            key={`${item.id}:${child.id}`}
                            item={child}
                            sectionId={`expanded-project:${item.project.id}:${child.task.headingId ?? 'none'}`}
                            orderedIds={(item.children ?? []).filter((c) => c.task.headingId === child.task.headingId).map((c) => c.task.id)}
                            scope="structural"
                            isPhone={isPhone}
                            mobileMode={activeMobileMode}
                            nested
                            canOrder={canOrder}
                          />
                        )) : null}
                      </Fragment>
                    );
                  }
                  if (item.kind === 'heading') return null;
                  const errand = errandsView && isErrandTask(item.task);
                  // Later-month sections contain several dates. A route drag must
                  // stay within the displayed day and must never change task dates.
                  const routeDate = doc.view === 'upcoming' ? /@(\d{4}-\d{2}-\d{2})$/.exec(item.id)?.[1] ?? section.date : null;
                  const orderIds = errandsView ? section.items
                    .filter((row) => row.kind === 'task' && isErrandTask(row.task) === errand &&
                      (!routeDate || /@(\d{4}-\d{2}-\d{2})$/.exec(row.id)?.[1] === routeDate))
                    .map((row) => (row as { task: Task }).task.id) : orderedIds;
                  return (
                    <TaskRow
                      key={item.id}
                      item={item}
                      sectionId={errandsView ? `${section.id}:${routeDate ?? ''}:${errand ? 'errands' : 'tasks'}` : section.id}
                      orderedIds={orderedIds}
                      orderIds={orderIds}
                      scope={errand ? 'errands' : scope}
                      myDayView={doc.view === 'today'}
                      isPhone={isPhone}
                      mobileMode={activeMobileMode}
                      canOrder={errand || canOrder}
                    />
                  );
                })}
                {composerSection === section.id && section.addTarget ? (
                  <InlineComposer target={section.addTarget} onDone={() => setComposerSection(null)} />
                ) : null}
              </ul>
              {section.addTarget && (section.items.length > 0 || (isPhone && !section.title)) && composerSection !== section.id ? (
                <button
                  type="button"
                  onClick={() => addTo(section)}
                  className="inline-add-task row mt-0.5 flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] text-faint hover:text-muted"
                >
                  <span aria-hidden="true" className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-[1.5px] border-dashed border-line-strong"><PlusIcon size={12} /></span>
                  Add a task{section.title && section.title !== 'Other tasks' ? ` to ${section.title}` : ''}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>

      {doc.view === 'today' ? <MyDayPrint doc={doc} expandChecklists={expandPrintChecklists} /> : null}
      {doc.view === 'upcoming' && chosenPrintDate ? (
        <UpcomingDayPrint
          date={chosenPrintDate}
          items={selectedPrintItems}
          twoColumns={twoPrintColumns}
          splitIndex={printSplitIndex}
          printRef={printRef}
          expandChecklists={expandPrintChecklists}
        />
      ) : null}

      {selection.length > 0 ? <SelectionBar ids={selection} /> : null}

      {isPhone && openTask ? (
        <Modal label="Edit task" onClose={() => openItem(null)}>
          <TaskEditor task={openTask} onClose={() => openItem(null)} embedded />
        </Modal>
      ) : null}

      {confirmEmptyTrash ? (
        <Modal label="Empty Trash" onClose={() => setConfirmEmptyTrash(false)}>
          <div className="p-4">
            <h2 className="text-[16px] font-semibold">Permanently delete everything in Trash?</h2>
            <p className="mt-1.5 text-[14px] text-muted">
              This will permanently delete {trashItemCount} {trashItemCount === 1 ? 'item' : 'items'} and cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmEmptyTrash(false)}>Cancel</Button>
              <Button size="sm" variant="danger" onClick={() => { actions.emptyTrash(); setConfirmEmptyTrash(false); }}>
                Empty Trash
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export { PrintChecklist, SelectionBar };
export type { Project };
