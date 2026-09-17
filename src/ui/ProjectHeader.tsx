'use client';

import { useState } from 'react';
import { formatDateLabel } from '@/core/dates';
import { projectProgress } from '@/core/membership';
import { tagPath } from '@/core/tags';
import { effectiveProjectTags } from '@/core/tags';
import { useApp, useIndexes } from '@/state/store';
import * as actions from '@/state/actions';
import { AutoTextarea, Button, Chip, IconButton, Modal, ProgressRing } from './primitives';
import { Markdown } from './Markdown';
import { WhenPopover, DeadlinePopover, type WhenValue } from './DatePopover';
import { MovePicker, TagPicker } from './Pickers';
import { CalendarIcon, CopyIcon, FlagIcon, MoveIcon, PlusIcon, TagIcon, TrashIcon } from './icons';
import { DuplicateDialog } from './DuplicateDialog';

/** Project header (§2): title, notes, schedule, deadline, progress and heading creation. */
export function ProjectHeader({ projectId }: { projectId: string }) {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const indexes = useIndexes();
  const settings = useApp((s) => s.db.settings);
  const showLogged = useApp((s) => s.showLogged);
  const setShowLogged = useApp((s) => s.setShowLogged);
  const setView = useApp((s) => s.setView);
  const [popover, setPopover] = useState<'when' | 'deadline' | 'area' | 'tags' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [newHeading, setNewHeading] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const project = db.projects[projectId];
  if (!project) return null;

  const progress = projectProgress(indexes.tasksByProject.get(projectId) ?? []);
  const openCount = (indexes.tasksByProject.get(projectId) ?? []).filter((t) => t.status === 'open').length;
  const tags = effectiveProjectTags(db, indexes.tagIndex, projectId);
  const area = project.areaId ? db.areas[project.areaId] : null;

  const open = (kind: typeof popover) => (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchor(event.currentTarget);
    setPopover(kind);
  };

  const whenValue: WhenValue = {
    planning: project.planning,
    startDate: project.startDate,
    evening: false,
    reminder: null,
  };

  return (
    <header className="mb-3 border-b border-line pb-3">
      <div className="flex items-start gap-3">
        <ProgressRing percent={progress.percent} size={22} />
        <div className="min-w-0 flex-1">
          <AutoTextarea
            value={project.title}
            ariaLabel="Project title"
            placeholder="Project name"
            className="text-[22px] font-semibold leading-tight"
            onChange={(value) => actions.updateProject(projectId, { title: value })}
          />
          <p className="mt-0.5 text-[12.5px] text-muted">
            {area ? (
              <button type="button" onClick={() => setView(`area:${area.id}`)} className="hover:underline">{area.title}</button>
            ) : 'No area'}
            {' · '}
            {progress.percent === null ? 'No tasks yet' : `${progress.completed} of ${progress.total} done`}
            {project.status !== 'open' ? ` · ${project.status}` : ''}
          </p>
        </div>
      </div>

      {notesOpen || project.notes.trim() ? (
        <div className="mt-2 pl-[34px]">
          {notesOpen ? (
            <AutoTextarea
              value={project.notes}
              ariaLabel="Project notes"
              placeholder="Notes — Markdown styling is supported"
              rows={2}
              autoFocus
              onBlur={() => setNotesOpen(false)}
              onChange={(value) => actions.updateProject(projectId, { notes: value })}
            />
          ) : (
            <button type="button" onClick={() => setNotesOpen(true)} className="block w-full rounded-md text-left hover:bg-surface-2">
              <Markdown source={project.notes} />
            </button>
          )}
        </div>
      ) : null}

      {tags.all.size > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1 pl-[34px]">
          {[...tags.direct].map((tagId) => (
            <Chip key={tagId} tone="accent" removable label={tagPath(db, tagId)} onRemove={() => actions.toggleTag('project', projectId, tagId, false)}>
              {tagPath(db, tagId)}
            </Chip>
          ))}
          {[...tags.inherited.keys()].map((tagId) => <Chip key={tagId}>{tagPath(db, tagId)}</Chip>)}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" keepFocus onClick={open('when')}>
          <CalendarIcon size={14} />
          {project.planning === 'someday' ? 'Someday' : project.startDate ? `Scheduled ${formatDateLabel(project.startDate, today)}` : 'When'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={open('deadline')}>
          <FlagIcon size={14} />{project.deadline ? `Due ${formatDateLabel(project.deadline, today)}` : 'Deadline'}
        </Button>
        <Button size="sm" variant="ghost" keepFocus onClick={open('area')}><MoveIcon size={14} />{area ? area.title : 'Area'}</Button>
        <Button size="sm" variant="ghost" keepFocus onClick={open('tags')}><TagIcon size={14} />Tags</Button>
        <Button size="sm" variant="ghost" keepFocus onClick={() => setNewHeading('')}><PlusIcon size={14} />Heading</Button>
        <Button size="sm" variant="ghost" keepFocus onClick={() => setDuplicating(true)}><CopyIcon size={14} />Duplicate</Button>
        {!notesOpen && !project.notes.trim() ? (
          <Button size="sm" variant="ghost" keepFocus onClick={() => setNotesOpen(true)}>Notes</Button>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <label className="flex items-center gap-1.5 px-1 text-[12.5px] text-muted">
            <input type="checkbox" checked={showLogged} onChange={(event) => setShowLogged(event.target.checked)} className="h-4 w-4" />
            Show logged
          </label>
          {project.status === 'open' ? (
            <Button size="sm" variant="ghost" keepFocus onClick={() => setConfirmComplete(true)}>Complete</Button>
          ) : (
            <Button size="sm" variant="ghost" keepFocus onClick={() => actions.setProjectStatus(projectId, 'open', null)}>Reopen</Button>
          )}
          <IconButton label="Move project to Trash" tone="danger" keepFocus onClick={() => { actions.deleteProject(projectId); setView('anytime'); }}>
            <TrashIcon />
          </IconButton>
        </span>
      </div>

      {newHeading !== null ? (
        <input
          type="text"
          autoFocus
          value={newHeading}
          aria-label="New heading title"
          placeholder="Heading name"
          onChange={(event) => setNewHeading(event.target.value)}
          onBlur={() => {
            if (newHeading.trim()) actions.createHeading(projectId, newHeading);
            setNewHeading(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (newHeading.trim()) actions.createHeading(projectId, newHeading);
              setNewHeading(null);
            }
            if (event.key === 'Escape') setNewHeading(null);
          }}
          className="mt-2 h-9 w-full rounded-md border border-accent bg-surface px-2.5 text-[14px] outline-none"
        />
      ) : null}

      {popover === 'when' ? (
        <WhenPopover
          anchor={anchor} onClose={() => setPopover(null)} today={today}
          locale={settings.locale} timeZone={settings.planningTimeZone}
          value={whenValue} onChange={(value) => actions.setProjectWhen(projectId, value)}
        />
      ) : null}
      {popover === 'deadline' ? (
        <DeadlinePopover
          anchor={anchor} onClose={() => setPopover(null)} today={today}
          locale={settings.locale} timeZone={settings.planningTimeZone}
          startDate={project.startDate} value={project.deadline}
          onChange={(value) => actions.updateProject(projectId, { deadline: value })}
        />
      ) : null}
      {popover === 'area' ? (
        <MovePicker
          anchor={anchor} onClose={() => setPopover(null)} db={db} title="Move project to area"
          currentTarget={project.areaId
            ? { parentType: 'area', parentId: project.areaId, headingId: null }
            : { parentType: 'inbox', parentId: null, headingId: null }}
          onPick={(target) => actions.updateProject(projectId, { areaId: target.parentType === 'area' ? target.parentId : null })}
        />
      ) : null}
      {popover === 'tags' ? (
        <TagPicker
          anchor={anchor} onClose={() => setPopover(null)} db={db}
          directTagIds={[...tags.direct]}
          inherited={[...tags.inherited.entries()].map(([tagId, origin]) => ({
            tagId, from: db.areas[origin.id]?.title ?? 'area',
          }))}
          onToggle={(tagId, next) => actions.toggleTag('project', projectId, tagId, next)}
          onCreate={(name) => actions.createAndAssignTag('project', projectId, name)}
        />
      ) : null}

      {duplicating ? (
        <DuplicateDialog
          kind="project"
          title={project.title}
          onClose={() => setDuplicating(false)}
          onConfirm={(options) => {
            const copyId = actions.duplicate('project', projectId, options);
            if (copyId) setView(`project:${copyId}`);
          }}
        />
      ) : null}

      {confirmComplete ? (
        <Modal label="Complete project" onClose={() => setConfirmComplete(false)}>
          <div className="p-4">
            <h2 className="text-[16px] font-semibold">Complete “{project.title}”?</h2>
            {openCount > 0 ? (
              <>
                <p className="mt-1.5 text-[14px] text-muted">
                  {openCount} task{openCount === 1 ? ' is' : 's are'} still open. Choose what happens to{' '}
                  {openCount === 1 ? 'it' : 'them'}.
                </p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" keepFocus onClick={() => setConfirmComplete(false)}>Cancel</Button>
                  <Button size="sm" onClick={() => { actions.setProjectStatus(projectId, 'completed', 'canceled'); setConfirmComplete(false); }}>
                    Cancel the open tasks
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => { actions.setProjectStatus(projectId, 'completed', 'completed'); setConfirmComplete(false); }}>
                    Complete them too
                  </Button>
                </div>
              </>
            ) : (
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" keepFocus onClick={() => setConfirmComplete(false)}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={() => { actions.setProjectStatus(projectId, 'completed', null); setConfirmComplete(false); }}>
                  Complete
                </Button>
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </header>
  );
}
