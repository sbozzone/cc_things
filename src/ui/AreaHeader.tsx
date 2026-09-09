'use client';

import { useState } from 'react';
import { tagPath, effectiveProjectTags } from '@/core/tags';
import { directTags } from '@/core/tags';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { AutoTextarea, Button, Chip, Modal } from './primitives';
import { TagPicker } from './Pickers';
import { PlusIcon, TagIcon, TrashIcon } from './icons';

/**
 * Area header (§4, area lifecycle). Areas are ongoing containers: no progress ring, no
 * due date, and deleting one states its effect before anything happens.
 */
export function AreaHeader({ areaId }: { areaId: string }) {
  const db = useApp((s) => s.db);
  const indexes = useApp((s) => s.indexes());
  const setView = useApp((s) => s.setView);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const [newProject, setNewProject] = useState<string | null>(null);

  const area = db.areas[areaId];
  if (!area) return null;

  const assigned = [...directTags(indexes.tagIndex, 'area', areaId)];
  const projectCount = (indexes.projectsByArea.get(areaId) ?? []).filter((p) => p.status === 'open').length;
  const taskCount = (indexes.tasksByArea.get(areaId) ?? []).filter((t) => t.status === 'open').length;
  void effectiveProjectTags;

  return (
    <header className="mb-3 border-b border-line pb-3">
      <AutoTextarea
        value={area.title}
        ariaLabel="Area name"
        placeholder="Area name"
        className="text-[22px] font-semibold leading-tight"
        onChange={(value) => actions.renameArea(areaId, value)}
      />
      <p className="mt-0.5 text-[12.5px] text-muted">
        {projectCount} project{projectCount === 1 ? '' : 's'} · {taskCount} open task{taskCount === 1 ? '' : 's'}
      </p>

      {assigned.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {assigned.map((tagId) => (
            <Chip key={tagId} tone="accent" removable label={tagPath(db, tagId)} onRemove={() => actions.toggleTag('area', areaId, tagId, false)}>
              {tagPath(db, tagId)}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => setNewProject('')}><PlusIcon size={14} />Project</Button>
        <Button size="sm" variant="ghost" onClick={(event) => setTagAnchor(event.currentTarget)}><TagIcon size={14} />Tags</Button>
        <span className="flex-1" />
        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}><TrashIcon size={14} />Delete area</Button>
      </div>

      {newProject !== null ? (
        <input
          type="text"
          autoFocus
          value={newProject}
          aria-label="New project name"
          placeholder="Project name"
          onChange={(event) => setNewProject(event.target.value)}
          onBlur={() => {
            if (newProject.trim()) setView(`project:${actions.createProject(newProject, areaId)}`);
            setNewProject(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && newProject.trim()) setView(`project:${actions.createProject(newProject, areaId)}`);
            if (event.key === 'Enter' || event.key === 'Escape') setNewProject(null);
          }}
          className="mt-2 h-9 w-full rounded-md border border-accent bg-surface px-2.5 text-[14px] outline-none"
        />
      ) : null}

      {tagAnchor ? (
        <TagPicker
          anchor={tagAnchor}
          onClose={() => setTagAnchor(null)}
          db={db}
          directTagIds={assigned}
          inherited={[]}
          onToggle={(tagId, next) => actions.toggleTag('area', areaId, tagId, next)}
          onCreate={(name) => actions.createAndAssignTag('area', areaId, name)}
        />
      ) : null}

      {confirmDelete ? (
        <Modal label="Delete area" onClose={() => setConfirmDelete(false)}>
          <div className="p-4">
            <h2 className="text-[16px] font-semibold">Delete “{area.title}”?</h2>
            <p className="mt-1.5 text-[14px] text-muted">
              It holds {projectCount} project{projectCount === 1 ? '' : 's'} and {taskCount} task
              {taskCount === 1 ? '' : 's'}. Choose what happens to them.
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => {
                  actions.deleteArea(areaId, 'moveContentsOut');
                  setConfirmDelete(false);
                  setView('anytime');
                }}
              >
                Keep the contents, delete only the area
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  actions.deleteArea(areaId, 'deleteContents');
                  setConfirmDelete(false);
                  setView('anytime');
                }}
              >
                Move everything to Trash
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </header>
  );
}
