'use client';

import { useEffect, useRef, useState } from 'react';
import { byRank } from '@/core/rank';
import { formatDateLabel } from '@/core/dates';
import { tagPath } from '@/core/tags';
import { getErrandsTag, isErrandTitle } from '@/core/errands';
import { describeRule } from '@/core/recurrence';
import type { Task } from '@/core/types';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { AutoTextarea, Button, Chip, IconButton, StatusControl } from './primitives';
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
  const [duplicating, setDuplicating] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const checklistRef = useRef<HTMLUListElement | null>(null);
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
    titleRef.current?.querySelector('textarea')?.focus();
  }, [task.id]);

  useEffect(() => {
    setTitleDraft(task.title);
  }, [task.id, task.title]);

  const commitTitle = () => {
    if (titleDraft !== task.title) actions.updateTask(task.id, { title: titleDraft }, 'edit title');
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
    setAnchor(event.currentTarget);
    setPopover(kind);
  };

  const contextLabel = task.parentType === 'project' && task.parentId
    ? db.projects[task.parentId]?.title ?? null
    : task.parentType === 'area' && task.parentId
      ? db.areas[task.parentId]?.title ?? null
      : 'Inbox';

  return (
    <div className={embedded ? 'relative overflow-hidden rounded-xl p-3.5' : 'card relative overflow-hidden p-3.5 shadow-[var(--shadow-pop)]'}>
      {/* A hairline of the page's hue along the top ties the open card to the list it sits in. */}
      <span aria-hidden="true" className="view-accent-bg absolute inset-x-0 top-0 h-[3px] opacity-80" />
      <div className="flex items-start gap-3">
        <StatusControl
          status={task.status}
          label={task.title || 'Untitled task'}
          onComplete={() => {
            actions.setStatus([task.id], 'completed');
            onClose();
          }}
          onCancel={() => {
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
            autoFocus
            className="text-[16px] font-semibold leading-snug tracking-[-0.01em]"
            onChange={setTitleDraft}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commitTitle();
                onClose();
              }
            }}
          />
        </div>
        <IconButton label="Close editor" onClick={onClose}><CloseIcon /></IconButton>
      </div>

      {showNotes || task.notes.trim() ? (
        <div className="mt-2 pl-[36px]">
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
        <ul ref={checklistRef} className="mt-2.5 space-y-0.5 pl-[32px]">
          {checklist.map((item, index) => (
            <li
              key={item.id}
              data-checklist-id={item.id}
              className={`group relative flex min-h-10 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--text)_4.5%,transparent)] ${
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
                title="Drag to reorder"
                className="absolute -left-11 top-1/2 flex h-11 w-11 -translate-y-1/2 touch-none cursor-grab items-center justify-center rounded-lg text-[18px] leading-none text-faint hover:bg-surface-2 active:cursor-grabbing"
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
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
                  let target: HTMLElement | null = null;
                  let nearest = Number.POSITIVE_INFINITY;
                  for (const row of rows) {
                    const rect = row.getBoundingClientRect();
                    const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
                    if (distance < nearest) {
                      nearest = distance;
                      target = row;
                    }
                  }
                  if (!target) return;
                  const rect = target.getBoundingClientRect();
                  const targetId = target.dataset.checklistId;
                  if (!targetId) return;
                  const side = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                  current.targetId = targetId;
                  current.side = side;
                  setChecklistDrop({ targetId, side });
                  const targetItem = checklist.find((row) => row.id === targetId);
                  setChecklistDragHint(`${side === 'after' ? 'After' : 'Before'} ${targetItem?.text || 'checklist row'}`);
                  if (event.clientY < 90 || event.clientY > window.innerHeight - 100) {
                    target.scrollIntoView({ block: 'center', behavior: 'auto' });
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
                className={`check-box flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] text-[10px] ${
                  item.checked ? 'border-accent bg-accent-fill text-accent-fill-contrast' : 'border-control hover:border-accent'
                }`}
              >
                {item.checked ? '✓' : ''}
              </button>
              <input
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
                className={`flex-1 bg-transparent text-[14px] outline-none ${item.checked ? 'text-muted line-through' : ''}`}
              />
              <IconButton label={`Delete checklist row ${index + 1}`} onClick={() => actions.deleteChecklistItem(item.id)}>
                <CloseIcon size={13} />
              </IconButton>
            </li>
          ))}
          <li className="sr-only" role="status" aria-live="polite">{checklistDragHint}</li>
        </ul>
      ) : null}

      {checklist.length > 0 || newChecklistText ? (
        <div className="mt-1 pl-[52px]">
          <input
            type="text"
            value={newChecklistText}
            spellCheck={true}
            placeholder="Add a row"
            aria-label="Add a checklist row"
            onChange={(event) => setNewChecklistText(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (!text.includes('\n')) return;
              // Pasting several lines offers one row per non-blank line (R03).
              event.preventDefault();
              actions.addChecklistLines(task.id, text.split('\n'));
              setNewChecklistText('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newChecklistText.trim()) {
                event.preventDefault();
                actions.addChecklistLines(task.id, [newChecklistText]);
                setNewChecklistText('');
              }
            }}
            className="h-8 w-full bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
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
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('repeat')}>
          <RepeatIcon size={14} />{template ? describeRule(template.rule) : 'Repeat'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={() => setDuplicating(true)}>
          <CopyIcon size={14} />Duplicate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          keepFocus
          onClick={() => {
            const projectId = actions.promoteToProject('task', task.id);
            onClose();
            if (projectId) setView(`project:${projectId}`);
          }}
        >
          <PromoteIcon size={14} />Make project
        </Button>
        <span className="flex-1" />
        <IconButton label="Move to Trash" tone="danger" keepFocus onClick={() => { actions.deleteTasks([task.id]); onClose(); }}>
          <TrashIcon />
        </IconButton>
      </div>

      {tagCount > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1 pl-[36px]">
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
