'use client';

import { useEffect, useRef, useState } from 'react';
import { byRank } from '@/core/rank';
import { checklistDropTarget } from '@/core/checklist-drop';
import { formatDateLabel } from '@/core/dates';
import { tagPath } from '@/core/tags';
import { getErrandsTag, isErrandTitle } from '@/core/errands';
import { describeRule } from '@/core/recurrence';
import type { Task } from '@/core/types';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { AutoTextarea, Button, Chip, IconButton, Popover, StatusControl } from './primitives';
import { Markdown } from './Markdown';
import { DeadlinePopover } from './DatePopover';
import { MovePicker, TagPicker } from './Pickers';
import {
  ChecklistIcon, CloseIcon, CopyIcon, FlagIcon, MoveIcon, NoteIcon,
  PromoteIcon, RepeatIcon, TagIcon, TrashIcon,
  SunIcon,
} from './icons';
import { RepeatEditor } from './RepeatEditor';
import { DuplicateDialog } from './DuplicateDialog';
import { priorities } from '@/core/list-order';
import { TagDot } from './TagColor';

/**
 * The expanded task editor. Optional fields are revealed on demand rather than always
 * shown (§2), and every field persists as it is edited — there is no separate Save.
 */
export function TaskEditor({ task, onClose, embedded = false }: { task: Task; onClose: () => void; embedded?: boolean }) {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const settings = useApp((s) => s.db.settings);
  const setView = useApp((s) => s.setView);
  const [popover, setPopover] = useState<'deadline' | 'move' | 'tags' | 'repeat' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [showNotes, setShowNotes] = useState(task.notes.trim().length > 0);
  const [notesFocused, setNotesFocused] = useState(false);
  const [newChecklistText, setNewChecklistText] = useState('');
  const newChecklistDraft = useRef('');
  const newChecklistInput = useRef<HTMLInputElement | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const checklistRef = useRef<HTMLUListElement | null>(null);
  const suppressChecklistClick = useRef(false);
  const [checklistMove, setChecklistMove] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const checklistDrag = useRef<{
    sourceId: string;
    startY: number;
    targetId: string;
    side: 'before' | 'after';
    moved: boolean;
  } | null>(null);
  const [checklistDrop, setChecklistDrop] = useState<{ targetId: string; side: 'before' | 'after' } | null>(null);
  const [checklistDragHint, setChecklistDragHint] = useState('');

  const checklist = Object.values(db.checklistItems)
    .filter((c) => c.taskId === task.id && c.deletedAt === null)
    .sort(byRank);
  const directTags = actions.directTagsOf(task.id);
  const inherited = actions.inheritedTagsOf(task.id);
  const automaticErrands = isErrandTitle(titleDraft);
  const errandsTag = getErrandsTag(db);
  const tagCount = directTags.length + inherited.length + (automaticErrands ? 1 : 0);
  const template = Object.values(db.occurrenceLinks)
    .filter((l) => l.deletedAt === null && l.materializedId === task.id)
    .map((l) => db.repeatTemplates[l.templateId])
    .find(Boolean);

  useEffect(() => {
    // Opening the mobile sheet is also how a person reads a task or its checklist.
    // Editing starts when they tap a field, so inspection does not open the keyboard.
    if (!embedded) titleRef.current?.querySelector('textarea')?.focus();
  }, [task.id, embedded]);

  useEffect(() => {
    setTitleDraft(task.title);
  }, [task.id, task.title]);

  const commitTitle = () => {
    if (titleDraft !== task.title) actions.updateTask(task.id, { title: titleDraft }, 'edit title');
  };

  const commitChecklistRow = () => {
    const text = newChecklistDraft.current.trim();
    newChecklistDraft.current = '';
    setNewChecklistText('');
    if (text) actions.addChecklistLines(task.id, [text]);
  };

  const closeEditor = () => {
    commitTitle();
    commitChecklistRow();
    onClose();
  };

  const moveChecklistItem = (id: string, direction: -1 | 1) => {
    const ids = checklist.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    actions.reorderChecklistItem(id, ids[to - 1] ?? null, ids[to + 1] ?? null);
  };

  const finishChecklistDrag = (cancel = false) => {
    const current = checklistDrag.current;
    if (current?.moved) suppressChecklistClick.current = true;
    checklistDrag.current = null;
    setChecklistDrop(null);
    setChecklistDragHint('');
    if (cancel || !current?.moved || current.targetId === current.sourceId) return;

    const original = checklist.map((item) => item.id);
    const reordered = original.filter((id) => id !== current.sourceId);
    const targetIndex = reordered.indexOf(current.targetId);
    if (targetIndex < 0) return;
    reordered.splice(targetIndex + (current.side === 'after' ? 1 : 0), 0, current.sourceId);
    if (reordered.every((id, index) => id === original[index])) return;

    const nextIndex = reordered.indexOf(current.sourceId);
    actions.reorderChecklistItem(
      current.sourceId,
      reordered[nextIndex - 1] ?? null,
      reordered[nextIndex + 1] ?? null,
    );
  };

  const openPopover = (kind: typeof popover) => (event: React.MouseEvent<HTMLButtonElement>) => {
    commitTitle();
    setAnchor(event.currentTarget);
    setPopover(kind);
  };

  const contextLabel = task.parentType === 'project' && task.parentId
    ? db.projects[task.parentId]?.title ?? null
    : task.parentType === 'area' && task.parentId
      ? db.areas[task.parentId]?.title ?? null
      : 'Inbox';

  return (
    <div className={`task-editor ${embedded ? 'task-editor-embedded relative overflow-hidden rounded-xl p-3.5' : 'card relative overflow-hidden p-3.5 shadow-[var(--shadow-pop)]'}`}>
      {/* A hairline of the page's hue along the top ties the open card to the list it sits in. */}
      <span aria-hidden="true" className="task-editor-accent view-accent-bg absolute inset-x-0 top-0 h-[3px] opacity-80" />
      {embedded ? (
        <div className="task-editor-sheet-header">
          <span aria-hidden="true" className="task-editor-grabber" />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold text-muted">Task details</span>
            <button type="button" data-autofocus aria-label="Close editor" onClick={closeEditor} className="mobile-sheet-done rounded-md px-2 font-semibold text-accent">Done</button>
          </div>
        </div>
      ) : null}
      <div className="task-editor-content">
      <div className="task-editor-title-row flex items-start gap-3">
        <StatusControl
          status={task.status}
          label={task.title || 'Untitled task'}
          onComplete={() => {
            commitTitle();
            actions.setStatus([task.id], 'completed');
            onClose();
          }}
          onCancel={() => {
            commitTitle();
            actions.setStatus([task.id], 'canceled');
            onClose();
          }}
          onReopen={() => actions.setStatus([task.id], 'open')}
        />
        <div ref={titleRef} className="min-w-0 flex-1">
          <AutoTextarea
            value={titleDraft}
            ariaLabel="Task title"
            placeholder="New task"
            autoFocus={!embedded}
            className="task-editor-title text-[16px] font-semibold leading-snug tracking-[-0.01em]"
            onChange={setTitleDraft}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                closeEditor();
              }
            }}
          />
        </div>
        {!embedded ? <IconButton label="Close editor" onClick={closeEditor}><CloseIcon /></IconButton> : null}
      </div>

      {showNotes || task.notes.trim() ? (
        <div className="task-editor-notes mt-2 pl-[36px]">
          {notesFocused ? (
            <AutoTextarea
              value={task.notes}
              ariaLabel="Notes"
              placeholder="Notes — Markdown styling is supported"
              rows={3}
              autoFocus
              className="text-[14px] leading-relaxed"
              onBlur={() => setNotesFocused(false)}
              onChange={(value) => actions.updateTask(task.id, { notes: value }, 'edit notes')}
            />
          ) : (
            <button
              type="button"
              onClick={() => setNotesFocused(true)}
              aria-label="Edit notes"
              className="block w-full rounded-md px-1.5 py-1 -mx-1.5 text-left hover:bg-[color-mix(in_srgb,var(--text)_4.5%,transparent)]"
            >
              {task.notes.trim() ? (
                <Markdown source={task.notes} />
              ) : (
                <span className="text-[14px] text-faint">Notes — Markdown styling is supported</span>
              )}
            </button>
          )}
        </div>
      ) : null}

      {checklist.length > 0 || newChecklistText ? (
        <ul ref={checklistRef} className="task-editor-checklist mt-2.5 space-y-0.5 pl-[32px]">
          {checklist.map((item, index) => (
            <li
              key={item.id}
              data-checklist-id={item.id}
              className={`checklist-row group relative flex min-h-10 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--text)_4.5%,transparent)] ${
                checklistDrop?.targetId === item.id && checklistDrop.side === 'before'
                  ? 'shadow-[inset_0_2px_0_0_var(--accent)]'
                  : checklistDrop?.targetId === item.id && checklistDrop.side === 'after'
                    ? 'shadow-[inset_0_-2px_0_0_var(--accent)]'
                    : ''
              }`}
            >
              <button
                type="button"
                aria-label={`Reorder checklist row ${index + 1}: ${item.text || 'Untitled row'}. Drag or use the up and down arrow keys.`}
                title="Drag to reorder or tap for move options"
                className="checklist-reorder-handle absolute -left-11 top-1/2 flex h-11 w-11 min-[620px]:-translate-y-1/2 touch-none cursor-grab items-center justify-center rounded-lg text-[18px] leading-none text-faint hover:bg-surface-2 active:cursor-grabbing"
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressChecklistClick.current) { suppressChecklistClick.current = false; return; }
                  setChecklistMove({ id: item.id, anchor: event.currentTarget });
                }}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  suppressChecklistClick.current = false;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  checklistDrag.current = {
                    sourceId: item.id,
                    startY: event.clientY,
                    targetId: item.id,
                    side: 'before',
                    moved: false,
                  };
                }}
                onPointerMove={(event) => {
                  const current = checklistDrag.current;
                  if (!current || current.sourceId !== item.id) return;
                  current.moved ||= Math.abs(event.clientY - current.startY) > 6;
                  if (!current.moved) return;
                  event.preventDefault();

                  const rows = Array.from(checklistRef.current?.querySelectorAll<HTMLElement>('[data-checklist-id]') ?? []);
                  const drop = checklistDropTarget(rows.map((row) => {
                    const rect = row.getBoundingClientRect();
                    return { id: row.dataset.checklistId!, top: rect.top, height: rect.height };
                  }), current.sourceId, event.clientY);
                  if (!drop) return;
                  const { targetId, side } = drop;
                  current.targetId = targetId;
                  current.side = side;
                  setChecklistDrop({ targetId, side });
                  const targetItem = checklist.find((row) => row.id === targetId);
                  setChecklistDragHint(`${side === 'after' ? 'After' : 'Before'} ${targetItem?.text || 'checklist row'}`);
                  // Scroll the actual sheet a small amount; centering a row moves
                  // the drop target abruptly underneath a stationary finger.
                  const panel = checklistRef.current?.closest<HTMLElement>('.mobile-modal-panel');
                  if (panel && panel.scrollHeight > panel.clientHeight) {
                    const bounds = panel.getBoundingClientRect();
                    const top = Math.max(bounds.top + 90, 90);
                    const bottom = Math.min(bounds.bottom, window.visualViewport?.height ?? window.innerHeight) - 60;
                    const step = event.clientY < top ? -6 : event.clientY > bottom ? 6 : 0;
                    if (step) panel.scrollBy({ top: step, behavior: 'instant' });
                  }
                }}
                onPointerUp={() => finishChecklistDrag(false)}
                onPointerCancel={() => finishChecklistDrag(true)}
                onLostPointerCapture={() => finishChecklistDrag(true)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault();
                  moveChecklistItem(item.id, event.key === 'ArrowUp' ? -1 : 1);
                }}
              >
                <span aria-hidden="true">⠿</span>
              </button>
              <button
                type="button"
                role="checkbox"
                aria-checked={item.checked}
                aria-label={item.text || 'Checklist row'}
                onClick={() => actions.updateChecklistItem(item.id, { checked: !item.checked })}
                className="checklist-toggle flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md"
              >
                <span aria-hidden="true" data-status={item.checked ? 'completed' : 'open'} className={`checklist-glyph check-box flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] text-[10px] ${
                  item.checked ? 'border-accent bg-accent-fill text-accent-fill-contrast' : 'border-control hover:border-accent'
                }`}>
                  {item.checked ? '✓' : ''}
                </span>
              </button>
              {embedded ? (
                <AutoTextarea
                  value={item.text}
                  ariaLabel={`Checklist row ${index + 1}`}
                  onChange={(text) => actions.updateChecklistItem(item.id, { text: text.replace(/[\r\n]/g, '') })}
                  onKeyDown={(event) => {
                    // Rows wrap visually, while Enter retains the existing single-row
                    // editing behavior. The Add a row field creates the next item.
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
                    if (event.key === 'Backspace' && item.text === '') {
                      event.preventDefault();
                      actions.deleteChecklistItem(item.id);
                    }
                  }}
                  className={`checklist-text min-w-0 flex-1 bg-transparent text-[14px] outline-none ${item.checked ? 'text-muted line-through' : ''}`}
                />
              ) : <input
                type="text"
                value={item.text}
                spellCheck={true}
                aria-label={`Checklist row ${index + 1}`}
                onChange={(event) => actions.updateChecklistItem(item.id, { text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && item.text === '') {
                    event.preventDefault();
                    actions.deleteChecklistItem(item.id);
                  }
                }}
                className={`checklist-text min-w-0 flex-1 bg-transparent text-[14px] outline-none ${item.checked ? 'text-muted line-through' : ''}`}
              />}
              <IconButton label={`Delete checklist row ${index + 1}`} className="checklist-delete" onClick={() => actions.deleteChecklistItem(item.id)}>
                <CloseIcon size={13} />
              </IconButton>
            </li>
          ))}
          <li className="sr-only" role="status" aria-live="polite">{checklistDragHint}</li>
        </ul>
      ) : null}

      {checklist.length > 0 || newChecklistText ? (
        <div className="task-editor-add-checklist mt-1 flex items-center gap-2 pl-[52px]">
          <input
            ref={newChecklistInput}
            type="text"
            enterKeyHint="done"
            value={newChecklistText}
            spellCheck={true}
            placeholder="Add a row"
            aria-label="Add a checklist row"
            onChange={(event) => {
              newChecklistDraft.current = event.target.value;
              setNewChecklistText(event.target.value);
            }}
            onBlur={commitChecklistRow}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (!text.includes('\n')) return;
              // Pasting several lines offers one row per non-blank line (R03).
              event.preventDefault();
              actions.addChecklistLines(task.id, text.split('\n'));
              newChecklistDraft.current = '';
              setNewChecklistText('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commitChecklistRow();
              }
            }}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <button type="button" aria-label="Add checklist item"
            className="min-h-11 min-w-11 shrink-0 rounded-md px-2 text-sm font-medium text-accent"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { commitChecklistRow(); newChecklistInput.current?.focus(); }}>
            Add
          </button>
        </div>
      ) : null}

      <div className="task-editor-actions mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
        <div className="task-editor-properties contents">
        <Button size="sm" variant={task.isInToday ? 'secondary' : 'ghost'} keepFocus onClick={() => actions.setInToday(task.id, !task.isInToday)}>
          <SunIcon size={14} />{task.isInToday ? 'Remove from My Day' : 'Add to My Day'}
        </Button>
        <label className="flex min-h-11 items-center gap-1 px-2 text-sm">
          <FlagIcon size={14} />
          <select aria-label="Task priority" value={task.priority ?? ''}
            className="min-h-11 max-w-40 rounded-md bg-surface text-sm text-muted min-[620px]:min-h-8"
            onChange={(e) => actions.updateTask(task.id, { priority: (e.target.value || null) as Task['priority'] }, 'priority')}>
            <option value="">No priority</option>
            {Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {task.planning !== 'anytime' ? (
          <Button
            size="sm"
            variant="ghost"
            keepFocus
            onClick={() => actions.applyWhen([task.id], {
              planning: 'anytime',
              startDate: null,
              evening: false,
              reminder: null,
            })}
          >
            <MoveIcon size={14} />Move to Anytime
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('deadline')}>
          <FlagIcon size={14} />
          {task.deadline ? `Due ${formatDateLabel(task.deadline, today)}` : 'Due'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('tags')}>
          <TagIcon size={14} />
          {tagCount > 0 ? `${tagCount} tags` : 'Tags'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('move')}>
          <MoveIcon size={14} />{contextLabel ? `Move · ${contextLabel}` : 'Move'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('repeat')}>
          <RepeatIcon size={14} />{template ? describeRule(template.rule) : 'Repeat'}
        </Button>
        </div>
        <div className="task-editor-secondary contents">
        {!showNotes && !task.notes.trim() ? (
          <Button size="sm" variant="ghost" keepFocus onClick={() => { setShowNotes(true); setNotesFocused(true); }}>
            <NoteIcon size={14} />Notes
          </Button>
        ) : null}
        {checklist.length === 0 && !newChecklistText ? (
          <Button size="sm" variant="ghost" keepFocus onClick={() => setNewChecklistText(' ')}>
            <ChecklistIcon size={14} />Checklist
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" keepFocus onClick={() => { commitTitle(); setDuplicating(true); }}>
          <CopyIcon size={14} />Duplicate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          keepFocus
          onClick={() => {
            commitTitle();
            const projectId = actions.promoteToProject('task', task.id);
            onClose();
            if (projectId) setView(`project:${projectId}`);
          }}
        >
          <PromoteIcon size={14} />Make project
        </Button>
        <span className="flex-1" />
        <IconButton label="Move to Trash" tone="danger" keepFocus onClick={() => { commitTitle(); actions.deleteTasks([task.id]); onClose(); }}>
          <TrashIcon />
        </IconButton>
        </div>
      </div>

      {tagCount > 0 ? (
        <div className="task-editor-tags mt-2.5 flex flex-wrap gap-1 pl-[36px]">
          {automaticErrands ? (
            <Chip tone="accent">
              <TagDot color={errandsTag.color} />
              <span>{errandsTag.name}</span>
              <span className="text-faint">· automatic from @</span>
            </Chip>
          ) : null}
          {directTags.map((tagId) => (
            <Chip key={tagId} tone="accent" removable label={tagPath(db, tagId)} onRemove={() => actions.toggleTag('task', task.id, tagId, false)}>
              <TagDot color={db.tags[tagId]?.color} />
              {tagPath(db, tagId)}
            </Chip>
          ))}
          {inherited.map((item) => (
            <Chip key={item.tagId} tone="default">
              <TagDot color={db.tags[item.tagId]?.color} />
              <span className="opacity-80">{tagPath(db, item.tagId)}</span>
              <span className="text-faint">· from {item.from}</span>
            </Chip>
          ))}
        </div>
      ) : null}
      </div>

      {popover === 'deadline' ? (
        <DeadlinePopover
          anchor={anchor}
          onClose={() => setPopover(null)}
          today={today}
          locale={settings.locale}
          timeZone={settings.planningTimeZone}
          startDate={task.startDate}
          value={task.deadline}
          onChange={(value) => actions.applyDeadline([task.id], value)}
        />
      ) : null}
      {checklistMove ? (
        <Popover anchor={checklistMove.anchor} onClose={() => setChecklistMove(null)} label="Move checklist item">
          <p className="px-2 py-1 text-sm text-muted">{checklist.find((row) => row.id === checklistMove.id)?.text}</p>
          <div className="flex flex-col gap-1">
            <button type="button" className="min-h-11 rounded-md px-3 text-left hover:bg-surface-2 disabled:opacity-40"
              disabled={checklist[0]?.id === checklistMove.id}
              onClick={() => { moveChecklistItem(checklistMove.id, -1); setChecklistMove(null); }}>Move up</button>
            <button type="button" className="min-h-11 rounded-md px-3 text-left hover:bg-surface-2 disabled:opacity-40"
              disabled={checklist[checklist.length - 1]?.id === checklistMove.id}
              onClick={() => { moveChecklistItem(checklistMove.id, 1); setChecklistMove(null); }}>Move down</button>
          </div>
        </Popover>
      ) : null}
      {popover === 'move' ? (
        <MovePicker
          anchor={anchor}
          onClose={() => setPopover(null)}
          db={db}
          currentTarget={{ parentType: task.parentType, parentId: task.parentId, headingId: task.headingId }}
          onPick={(target) => actions.moveTasks([task.id], target)}
        />
      ) : null}
      {popover === 'tags' ? (
        <TagPicker
          anchor={anchor}
          onClose={() => setPopover(null)}
          db={db}
          directTagIds={directTags}
          inherited={inherited}
          automaticErrands={automaticErrands}
          onToggle={(tagId, next) => actions.toggleTag('task', task.id, tagId, next)}
          onCreate={(name) => actions.createAndAssignTag('task', task.id, name)}
        />
      ) : null}
      {popover === 'repeat' ? (
        <RepeatEditor anchor={anchor} onClose={() => setPopover(null)} subject={{ kind: 'task', task }} />
      ) : null}
      {duplicating ? (
        <DuplicateDialog
          kind="task"
          title={task.title || 'Untitled'}
          onClose={() => setDuplicating(false)}
          onConfirm={(options) => actions.duplicate('task', task.id, options)}
        />
      ) : null}
    </div>
  );
}
