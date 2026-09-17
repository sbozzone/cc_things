'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateLabel } from '@/core/dates';
import { inToday } from '@/core/membership';
import { tagPath } from '@/core/tags';
import type { AddTarget, ListDocument, ListItem, ListSection } from '@/core/selectors';
import type { CalendarEvent, Project, Task } from '@/core/types';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { TaskEditor } from './TaskEditor';
import { Button, Chip, IconButton, Modal, Popover, ProgressRing, StatusControl } from './primitives';
import { WhenPopover, DeadlinePopover, type WhenValue } from './DatePopover';
import { MovePicker } from './Pickers';
import { DuplicateDialog } from './DuplicateDialog';
import {
  AlertIcon, ArchiveBoxIcon, CalendarIcon, ChecklistIcon, CopyIcon, EveningIcon, FlagIcon,
  MoreIcon, MoveIcon, NoteIcon, PlusIcon, PromoteIcon, RepeatIcon, TrashIcon, ChevronIcon, SunIcon, TagIcon,
} from './icons';
import { usePhone } from './useMediaQuery';
import { viewStyle } from './view-style';
import { OrderHandle } from './OrderHandle';
import { TagDot } from './TagColor';
import { priorities, sortDocument, type ListSort } from '@/core/list-order';

/** Row currently being dragged. Drag is an accelerator; every move has a menu equivalent (R26). */
let dragSource: { id: string; sectionId: string } | null = null;

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
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[11.5px] font-medium ${tones[tone]}`}>
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
  item, sectionId, orderedIds, scope, isPhone, nested = false, canOrder = true,
}: {
  item: Extract<ListItem, { kind: 'task' }>;
  sectionId: string;
  orderedIds: string[];
  scope: 'structural' | 'today';
  isPhone: boolean;
  nested?: boolean;
  canOrder?: boolean;
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
  const isEditing = openItemId === task.id;
  const project = task.parentType === 'project' && task.parentId ? db.projects[task.parentId] ?? null : null;
  const isInMyDay = inToday(task, project, today);

  const move = (direction: -1 | 1) => {
    if (!canOrder) return;
    const index = orderedIds.indexOf(task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedIds.length) return;
    const reordered = [...orderedIds];
    reordered.splice(index, 1);
    reordered.splice(target, 0, task.id);
    const at = reordered.indexOf(task.id);
    actions.reorderTask(task.id, reordered[at - 1] ?? null, reordered[at + 1] ?? null, scope);
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
      <li ref={rowRef} data-row data-id={task.id} className="px-1 py-0.5">
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
        const ids = orderedIds.filter((id) => id !== source.id);
        const at = ids.indexOf(task.id);
        const insertAt = dropSide === 'above' ? at : at + 1;
        actions.reorderTask(source.id, ids[insertAt - 1] ?? null, ids[insertAt] ?? null, scope);
        dragSource = null;
      }}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) toggleSelected(task.id);
        else if (event.shiftKey) extendSelection(task.id, orderedIds);
        else if (selection.length > 0 && isPhone) toggleSelected(task.id);
        else if (selection.length > 0) setSelection([]);
        else openItem(task.id);
      }}
      className={`group relative flex cursor-default items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
        selected ? 'bg-selected' : 'hover:bg-surface-2'
      } ${nested ? 'ml-5 border-l border-line pl-3' : ''} ${
        dropSide === 'above' ? 'shadow-[inset_0_2px_0_0_var(--accent)]' : dropSide === 'below' ? 'shadow-[inset_0_-2px_0_0_var(--accent)]' : ''
      }`}
    >
      {selected ? (
        <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent-fill" />
      ) : null}
      <StatusControl
        status={task.status}
        label={task.title || 'Untitled task'}
        onComplete={() => actions.setStatus(selected ? selection : [task.id], 'completed')}
        onCancel={() => actions.setStatus(selected ? selection : [task.id], 'canceled')}
        onReopen={() => actions.setStatus(selected ? selection : [task.id], 'open')}
      />
      {isInMyDay ? (
        <span className="mt-0.5 shrink-0 text-[var(--today)]" title="In My Day">
          <SunIcon size={16} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-[14.5px] leading-snug ${task.status !== 'open' ? 'text-muted line-through' : ''}`}>
            {task.title || <span className="text-faint">Untitled</span>}
          </span>
          {meta.repeating ? <RepeatIcon size={12} className="translate-y-[1px] text-faint" /> : null}
          {task.notes.trim() ? <NoteIcon size={12} className="translate-y-[1px] text-faint" /> : null}
          {meta.checklistTotal > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[12px] text-faint">
              <ChecklistIcon size={12} />{meta.checklistChecked}/{meta.checklistTotal}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <DateChip task={task} today={today} hideStart={scope === 'today'} />
          {task.priority ? <Pill tone={task.priority === 'urgent' ? 'danger' : task.priority === 'low' ? 'neutral' : 'warm'} icon={<FlagIcon size={11} />}>{priorities[task.priority]}</Pill> : null}
          {meta.contextLabel ? <span className="text-[12px] text-faint">{meta.contextLabel}</span> : null}
          {meta.heldContextLabel ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--someday)]">
              <AlertIcon size={12} />Deadline reached in held “{meta.heldContextLabel}”
            </span>
          ) : null}
          {meta.tagIds.slice(0, 3).map((tagId) => (
            <Chip key={tagId}><TagDot color={db.tags[tagId]?.color} />{tagPath(db, tagId)}</Chip>
          ))}
        </div>
      </div>
      {canOrder && orderedIds.length > 1 ? <OrderHandle id={task.id} ids={orderedIds} group={sectionId} scope={scope} /> : null}
      {isPhone ? (
        <button
          type="button"
          aria-label={`${selected ? 'Remove' : 'Add'} ${task.title || 'untitled task'} ${selected ? 'from' : 'to'} selection`}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            toggleSelected(task.id);
          }}
          style={{ width: 44, minWidth: 44 }}
          className="-my-2 -mr-2 flex h-11 shrink-0 items-center justify-center rounded-lg"
        >
          <span
            aria-hidden="true"
            className={`flex h-6 w-6 items-center justify-center rounded-full border text-[14px] font-bold ${
              selected ? 'border-accent bg-accent-fill text-accent-fill-contrast' : 'border-line-strong bg-surface'
            }`}
          >
            {selected ? '✓' : ''}
          </span>
        </button>
      ) : null}
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
      className="flex min-h-[44px] cursor-default items-center gap-2.5 rounded-md px-2 hover:bg-surface-2"
    >
      <ProgressRing percent={progress.percent} size={17} />
      <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{project.title}</span>
      {project.deadline ? (
        <span className={`text-[12px] ${meta.overdue ? 'text-danger' : 'text-[var(--upcoming)]'}`}>
          <FlagIcon size={12} className="mr-1 inline" />Due {formatDateLabel(project.deadline, today)}
        </span>
      ) : null}
      <span className="text-[12px] text-faint">
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
    <li className="flex items-center gap-2.5 rounded-md px-2 py-[7px] text-muted">
      <span aria-hidden="true" className="h-4 w-[3px] shrink-0 rounded-full bg-[var(--upcoming)]" />
      <span className="min-w-0 flex-1 truncate text-[14px]">
        {event.sourceUrl ? (
          <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{event.title}</a>
        ) : event.title}
      </span>
      <span className="shrink-0 text-[12px] text-faint">{time}</span>
    </li>
  );
}

function InlineComposer({ target, onDone }: { target: AddTarget; onDone: () => void }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <li className="px-2 py-1">
      <input
        ref={ref}
        type="text"
        value={value}
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
        className="h-9 w-full rounded-md border border-accent bg-surface px-2.5 text-[14.5px] outline-none"
      />
    </li>
  );
}

function TaskTagFilter({ view }: { view: 'today' | 'allTasks' }) {
  const db = useApp((s) => s.db);
  const tagFilter = useApp((s) => s.tagFilter);
  const setTagFilter = useApp((s) => s.setTagFilter);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const viewLabel = view === 'today' ? 'My Day' : 'All Tasks';
  const tags = useMemo(
    () => Object.values(db.tags)
      .filter((tag) => tag.deletedAt === null)
      .sort((a, b) => tagPath(db, a.id).localeCompare(tagPath(db, b.id))),
    [db],
  );

  const toggle = (tagId: string) => {
    setTagFilter(tagFilter.includes(tagId)
      ? tagFilter.filter((id) => id !== tagId)
      : [...tagFilter, tagId]);
  };

  return (
    <div className="mb-2 flex flex-wrap items-center justify-end gap-1 px-2">
      <Button size="sm" variant={tagFilter.length > 0 ? 'secondary' : 'ghost'} onClick={(event) => setAnchor(event.currentTarget)}>
        <TagIcon size={14} /> Tags{tagFilter.length > 0 ? ` (${tagFilter.length})` : ''}
      </Button>
      {tagFilter.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setTagFilter([])}>Clear</Button> : null}
      {anchor ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label={`Filter ${viewLabel} by tags`} width={280}>
          {tags.length > 0 ? (
            <>
              <p className="px-2 pb-1 text-[12px] text-faint">Tasks match any selected tag.</p>
              <ul>
                {tags.map((tag) => (
                  <li key={tag.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={tagFilter.includes(tag.id)}
                        onChange={() => toggle(tag.id)}
                        className="h-5 w-5"
                      />
                      <TagDot color={tag.color} />
                      <span className="min-w-0 flex-1 truncate">{tagPath(db, tag.id)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="px-2 py-3 text-[13px] text-muted">Create a tag to filter this list.</p>}
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

function SectionHeader({ section, onAdd }: { section: ListSection; onAdd: () => void }) {
  if (!section.title) return null;
  const isHeading = section.id.startsWith('heading:');
  return (
    <div className="mt-5 mb-1.5 flex items-center gap-2 px-2.5 first:mt-1">
      {isHeading ? (
        <span aria-hidden="true" className="h-[13px] w-[3px] shrink-0 rounded-full view-accent-bg opacity-70" />
      ) : null}
      <h2
        className={
          isHeading
            ? 'text-[13.5px] font-semibold tracking-[-0.01em] text-ink'
            : 'text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint'
        }
      >
        {section.title}
      </h2>
      {section.subtitle ? <span className="text-[12px] text-faint">{section.subtitle}</span> : null}
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      {isHeading ? <HeadingMenu headingId={section.id.slice(8)} title={section.title} /> : null}
      {section.addTarget ? (
        <IconButton label={`Add a task to ${section.title}`} onClick={onAdd}><PlusIcon size={15} /></IconButton>
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
  const [popover, setPopover] = useState<'when' | 'deadline' | 'move' | null>(null);
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
      className="sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow)]"
    >
      <span className="px-2 text-[13px] font-medium" aria-live="polite">{ids.length} selected</span>
      <Button size="sm" variant="ghost" onClick={open('when')}><CalendarIcon size={14} />When</Button>
      <Button size="sm" variant="ghost" onClick={open('deadline')}><FlagIcon size={14} />Deadline</Button>
      <Button size="sm" variant="ghost" onClick={open('move')}><MoveIcon size={14} />Move</Button>
      <Button size="sm" variant="ghost" onClick={() => { actions.setStatus(ids, 'completed'); clearSelection(); }}>Complete</Button>
      <Button size="sm" variant="ghost" onClick={() => { actions.setStatus(ids, 'canceled'); clearSelection(); }}>Cancel</Button>
      <IconButton label="Move selection to Trash" tone="danger" onClick={() => actions.deleteTasks(ids)}><TrashIcon /></IconButton>
      <IconButton label="Clear selection" onClick={clearSelection}>×</IconButton>

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

export function ListView({ doc: sourceDoc }: { doc: ListDocument }) {
  const selection = useApp((s) => s.selection);
  const openItemId = useApp((s) => s.openItemId);
  const openItem = useApp((s) => s.openItem);
  const db = useApp((s) => s.db);
  const sort = db.settings.listSorts?.[sourceDoc.view] ?? 'manual';
  const doc = useMemo(() => sortDocument(sourceDoc, sort, (tagId) => tagPath(db, tagId)), [sourceDoc, sort, db]);
  const canOrder = sort === 'manual' && !['upcoming', 'logbook', 'trash', 'review', 'allTasks'].includes(doc.view);
  const isPhone = usePhone();
  const [composerSection, setComposerSection] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

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

  return (
    <>
      <div data-list-root className="pt-1 pb-24">
        {doc.view === 'today' || doc.view === 'allTasks' ? <TaskTagFilter view={doc.view} /> : null}
        {!['logbook', 'trash'].includes(doc.view) ? <label className="mb-2 flex flex-wrap items-center justify-end gap-2 px-2 text-sm text-muted">
          Sort
          <select aria-label="Sort items" className="min-h-11 rounded-md border border-line bg-surface px-2" value={sort}
            onChange={(e) => actions.updateSettings({ listSorts: { ...db.settings.listSorts, [doc.view]: e.target.value as ListSort } })}>
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
        </label> : null}
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
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <span aria-hidden="true" className="badge-wash flex h-14 w-14 items-center justify-center rounded-2xl [&>svg]:h-6 [&>svg]:w-6">
              {viewStyle(doc.view).icon}
            </span>
            <p className="max-w-[34ch] text-[14px] leading-relaxed text-muted">{doc.emptyMessage}</p>
          </div>
        ) : null}

        {doc.sections.map((section) => {
          if (section.items.length === 0 && composerSection !== section.id && !section.title) return null;
          const orderedIds = orderedIdsBySection.get(section.id) ?? [];
          return (
            <section key={section.id} aria-label={section.title ?? doc.title}>
              <SectionHeader section={section} onAdd={() => addTo(section)} />
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
                          order={canOrder ? { ids: section.items.filter((i) => i.kind === 'project').map((i) => i.project.id), group: `${section.id}:projects` } : undefined}
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
                            nested
                            canOrder={canOrder}
                          />
                        )) : null}
                      </Fragment>
                    );
                  }
                  if (item.kind === 'heading') return null;
                  return (
                    <TaskRow
                      key={item.id}
                      item={item}
                      sectionId={section.id}
                      orderedIds={orderedIds}
                      scope={scope}
                      isPhone={isPhone}
                      canOrder={canOrder}
                    />
                  );
                })}
                {composerSection === section.id && section.addTarget ? (
                  <InlineComposer target={section.addTarget} onDone={() => setComposerSection(null)} />
                ) : null}
              </ul>
              {section.addTarget && section.items.length > 0 && composerSection !== section.id ? (
                <button
                  type="button"
                  onClick={() => addTo(section)}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-faint hover:bg-surface-2 hover:text-muted"
                >
                  <PlusIcon size={14} /> Add a task{section.title ? ` to ${section.title}` : ''}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>

      {selection.length > 0 ? <SelectionBar ids={selection} /> : null}

      {isPhone && openTask ? (
        <Modal label="Edit task" onClose={() => openItem(null)}>
          <div className="p-1">
            <TaskEditor task={openTask} onClose={() => openItem(null)} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export { SelectionBar };
export type { Project };
