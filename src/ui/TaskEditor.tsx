'use client';

import { useEffect, useRef, useState } from 'react';
import { byRank } from '@/core/rank';
import { formatDateLabel } from '@/core/dates';
import { tagPath } from '@/core/tags';
import { describeRule } from '@/core/recurrence';
import type { Task } from '@/core/types';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { AutoTextarea, Button, Chip, IconButton, StatusControl } from './primitives';
import { Markdown } from './Markdown';
import { WhenPopover, DeadlinePopover, type WhenValue } from './DatePopover';
import { MovePicker, TagPicker } from './Pickers';
import {
  CalendarIcon, ChecklistIcon, CloseIcon, CopyIcon, FlagIcon, MoveIcon, NoteIcon,
  PromoteIcon, RepeatIcon, TagIcon, TrashIcon,
} from './icons';
import { RepeatEditor } from './RepeatEditor';
import { DuplicateDialog } from './DuplicateDialog';

/**
 * The expanded task editor. Optional fields are revealed on demand rather than always
 * shown (§2), and every field persists as it is edited — there is no separate Save.
 */
export function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const settings = useApp((s) => s.db.settings);
  const setView = useApp((s) => s.setView);
  const [popover, setPopover] = useState<'when' | 'deadline' | 'move' | 'tags' | 'repeat' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [showNotes, setShowNotes] = useState(task.notes.trim().length > 0);
  const [notesFocused, setNotesFocused] = useState(false);
  const [newChecklistText, setNewChecklistText] = useState('');
  const [duplicating, setDuplicating] = useState(false);
  const titleRef = useRef<HTMLDivElement | null>(null);

  const checklist = Object.values(db.checklistItems)
    .filter((c) => c.taskId === task.id && c.deletedAt === null)
    .sort(byRank);
  const directTags = actions.directTagsOf(task.id);
  const inherited = actions.inheritedTagsOf(task.id);
  const reminder = Object.values(db.reminders).find((r) => r.taskId === task.id && r.deletedAt === null && r.canceledAt === null);
  const template = Object.values(db.occurrenceLinks)
    .filter((l) => l.deletedAt === null && l.materializedId === task.id)
    .map((l) => db.repeatTemplates[l.templateId])
    .find(Boolean);

  const whenValue: WhenValue = {
    planning: task.planning,
    startDate: task.startDate,
    evening: task.eveningDate !== null && task.eveningDate === task.startDate,
    reminder: reminder?.wallTime ?? null,
  };

  useEffect(() => {
    titleRef.current?.querySelector('textarea')?.focus();
  }, [task.id]);

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
    <div className="rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow)]">
      <div className="flex items-start gap-2.5">
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
            value={task.title}
            ariaLabel="Task title"
            placeholder="New task"
            className="text-[15px] font-medium"
            onChange={(value) => actions.updateTask(task.id, { title: value }, 'edit title')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <IconButton label="Close editor" onClick={onClose}><CloseIcon /></IconButton>
      </div>

      {showNotes || task.notes.trim() ? (
        <div className="mt-2 pl-[34px]">
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
              className="block w-full rounded-md text-left hover:bg-surface-2"
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
        <ul className="mt-2 space-y-0.5 pl-[30px]">
          {checklist.map((item, index) => (
            <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={item.checked}
                aria-label={item.text || 'Checklist row'}
                onClick={() => actions.updateChecklistItem(item.id, { checked: !item.checked })}
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border text-[10px] ${
                  item.checked ? 'border-accent bg-accent text-accent-contrast' : 'border-control'
                }`}
              >
                {item.checked ? '✓' : ''}
              </button>
              <input
                type="text"
                value={item.text}
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
        </ul>
      ) : null}

      {checklist.length > 0 || newChecklistText ? (
        <div className="mt-1 pl-[52px]">
          <input
            type="text"
            value={newChecklistText}
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

      <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-line pt-2.5">
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('when')}>
          <CalendarIcon size={14} />
          {task.planning === 'someday'
            ? 'Someday'
            : task.startDate
              ? `${formatDateLabel(task.startDate, today)}${whenValue.evening ? ' evening' : ''}`
              : 'When'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('deadline')}>
          <FlagIcon size={14} />
          {task.deadline ? `Due ${formatDateLabel(task.deadline, today)}` : 'Deadline'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={openPopover('tags')}>
          <TagIcon size={14} />
          {directTags.length + inherited.length > 0 ? `${directTags.length + inherited.length} tags` : 'Tags'}
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

      {directTags.length + inherited.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1 pl-[34px]">
          {directTags.map((tagId) => (
            <Chip key={tagId} tone="accent" removable label={tagPath(db, tagId)} onRemove={() => actions.toggleTag('task', task.id, tagId, false)}>
              {tagPath(db, tagId)}
            </Chip>
          ))}
          {inherited.map((item) => (
            <Chip key={item.tagId} tone="default">
              <span className="opacity-80">{tagPath(db, item.tagId)}</span>
              <span className="text-faint">· from {item.from}</span>
            </Chip>
          ))}
        </div>
      ) : null}

      {popover === 'when' ? (
        <WhenPopover
          anchor={anchor}
          onClose={() => setPopover(null)}
          today={today}
          locale={settings.locale}
          timeZone={settings.planningTimeZone}
          value={whenValue}
          onChange={(value) => actions.applyWhen([task.id], value)}
        />
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
        <MovePicker anchor={anchor} onClose={() => setPopover(null)} db={db} onPick={(target) => actions.moveTasks([task.id], target)} />
      ) : null}
      {popover === 'tags' ? (
        <TagPicker
          anchor={anchor}
          onClose={() => setPopover(null)}
          db={db}
          directTagIds={directTags}
          inherited={inherited}
          onToggle={(tagId, next) => actions.toggleTag('task', task.id, tagId, next)}
          onCreate={(name) => actions.createAndAssignTag('task', task.id, name)}
        />
      ) : null}
      {popover === 'repeat' ? (
        <RepeatEditor anchor={anchor} onClose={() => setPopover(null)} task={task} />
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
