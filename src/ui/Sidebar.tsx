'use client';

import { useState } from 'react';
import { byRank } from '@/core/rank';
import { projectProgress } from '@/core/membership';
import { tagPath } from '@/core/tags';
import { BUILT_IN_ORDER, VIEW_TITLES, type ViewKey } from '@/core/selectors';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { Button, IconButton, ProgressRing } from './primitives';
import {
  ArchiveBoxIcon, BookIcon, CalendarIcon, CloudIcon, FolderIcon, InboxIcon, LayersIcon,
  PlusIcon, SearchIcon, SettingsIcon, StarIcon, TagIcon, TrashIcon,
} from './icons';

const VIEW_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  inbox: { icon: <InboxIcon size={15} />, color: 'var(--text-muted)' },
  today: { icon: <StarIcon size={15} />, color: 'var(--today)' },
  upcoming: { icon: <CalendarIcon size={15} />, color: 'var(--upcoming)' },
  anytime: { icon: <LayersIcon size={15} />, color: 'var(--anytime)' },
  someday: { icon: <ArchiveBoxIcon size={15} />, color: 'var(--someday)' },
  logbook: { icon: <BookIcon size={15} />, color: 'var(--logbook)' },
  trash: { icon: <TrashIcon size={15} />, color: 'var(--text-faint)' },
};

const SYNC_LABELS: Record<string, string> = {
  local: 'Saved on this device',
  savedOnDevice: 'Saved on device',
  syncing: 'Syncing…',
  upToDate: 'Up to date',
  error: 'Sync error',
  unsaved: 'Not saved',
};

function NavItem({
  view, label, count, icon, color, active, onSelect, indent = 0,
}: {
  view: ViewKey;
  label: string;
  count?: number;
  icon: React.ReactNode;
  color?: string;
  active: boolean;
  onSelect: (view: ViewKey) => void;
  indent?: number;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(view)}
        className={`flex min-h-[36px] w-full items-center gap-2.5 rounded-md py-1.5 pr-2 text-left text-[14px] transition-colors ${
          active ? 'bg-selected font-medium' : 'hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]'
        }`}
        style={{ paddingLeft: 8 + indent * 14 }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center" style={{ color }} aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 ? (
          <span className="shrink-0 text-[12px] tabular-nums text-faint">{count}</span>
        ) : null}
      </button>
    </li>
  );
}

export function Sidebar({
  onOpenSearch, onOpenSettings, onClose,
}: {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onClose?: () => void;
}) {
  const db = useApp((s) => s.db);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const counts = useApp((s) => s.counts());
  const indexes = useApp((s) => s.indexes());
  const tagFilter = useApp((s) => s.tagFilter);
  const setTagFilter = useApp((s) => s.setTagFilter);
  const syncStatus = useApp((s) => s.syncStatus);
  const pendingCount = useApp((s) => s.pending.length);
  const [creating, setCreating] = useState<'project' | 'area' | null>(null);
  const [draft, setDraft] = useState('');

  const select = (next: ViewKey) => {
    setView(next);
    onClose?.();
  };

  const tags = Object.values(db.tags).filter((t) => t.deletedAt === null).sort(byRank);

  const submitDraft = () => {
    const title = draft.trim();
    if (title) {
      if (creating === 'project') select(`project:${actions.createProject(title, null)}`);
      else actions.createArea(title);
    }
    setDraft('');
    setCreating(null);
  };

  return (
    <nav aria-label="Lists" className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-1 px-2 pt-3 pb-1">
        <span className="flex-1 select-none px-1 text-[14px] font-semibold tracking-tight">Clearing</span>
        <IconButton label="Search" onClick={onOpenSearch}><SearchIcon size={15} /></IconButton>
        <IconButton label="Settings" onClick={onOpenSettings}><SettingsIcon size={15} /></IconButton>
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {BUILT_IN_ORDER.map((key) => (
            <NavItem
              key={key}
              view={key}
              label={VIEW_TITLES[key] as string}
              count={counts[key]}
              icon={VIEW_ICONS[key]?.icon}
              color={VIEW_ICONS[key]?.color}
              active={view === key}
              onSelect={select}
            />
          ))}
        </ul>

        {indexes.areas.length > 0 || indexes.unfiledProjects.length > 0 ? (
          <div className="mt-4">
            <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Areas</h2>
            <ul className="space-y-0.5">
              {indexes.areas.map((area) => (
                <li key={area.id}>
                  <ul className="space-y-0.5">
                    <NavItem
                      view={`area:${area.id}`}
                      label={area.title}
                      icon={<LayersIcon size={15} />}
                      active={view === `area:${area.id}`}
                      onSelect={select}
                    />
                    {(indexes.projectsByArea.get(area.id) ?? [])
                      .filter((p) => p.status === 'open')
                      .map((project) => (
                        <NavItem
                          key={project.id}
                          view={`project:${project.id}`}
                          label={project.title}
                          icon={<ProgressRing percent={projectProgress(indexes.tasksByProject.get(project.id) ?? []).percent} size={14} />}
                          active={view === `project:${project.id}`}
                          onSelect={select}
                          indent={1}
                        />
                      ))}
                  </ul>
                </li>
              ))}
              {indexes.unfiledProjects
                .filter((p) => p.status === 'open')
                .map((project) => (
                  <NavItem
                    key={project.id}
                    view={`project:${project.id}`}
                    label={project.title}
                    icon={<FolderIcon size={15} />}
                    active={view === `project:${project.id}`}
                    onSelect={select}
                  />
                ))}
            </ul>
          </div>
        ) : null}

        {tags.length > 0 ? (
          <div className="mt-4">
            <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Filter by tag{tagFilter.length > 0 ? ` (${tagFilter.length})` : ''}
            </h2>
            <div className="flex flex-wrap gap-1 px-1">
              {tags.map((tag) => {
                const active = tagFilter.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTagFilter(active ? tagFilter.filter((t) => t !== tag.id) : [...tagFilter, tag.id])}
                    className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[12px] ${
                      active ? 'border-transparent bg-accent text-accent-contrast' : 'border-line text-muted hover:bg-surface-2'
                    }`}
                  >
                    <TagIcon size={11} />{tagPath(db, tag.id)}
                  </button>
                );
              })}
            </div>
            {tagFilter.length > 0 ? (
              <button type="button" onClick={() => setTagFilter([])} className="mt-1 px-2 text-[12px] text-accent hover:underline">
                Clear tag filter
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4">
          <ul className="space-y-0.5">
            <NavItem view="trash" label="Trash" icon={VIEW_ICONS.trash?.icon} color="var(--text-faint)" active={view === 'trash'} onSelect={select} />
          </ul>
        </div>
      </div>

      <div className="border-t border-line px-2 py-2">
        {creating ? (
          <input
            type="text"
            autoFocus
            value={draft}
            aria-label={creating === 'project' ? 'New project name' : 'New area name'}
            placeholder={creating === 'project' ? 'Project name' : 'Area name'}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitDraft();
              if (event.key === 'Escape') {
                setDraft('');
                setCreating(null);
              }
            }}
            className="h-9 w-full rounded-md border border-accent bg-surface px-2 text-[14px] outline-none"
          />
        ) : (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setCreating('project')}><PlusIcon size={14} />Project</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating('area')}><PlusIcon size={14} />Area</Button>
          </div>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-faint hover:bg-surface-2"
        >
          <CloudIcon size={13} />
          <span aria-live="polite">
            {SYNC_LABELS[syncStatus]}
            {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
          </span>
        </button>
      </div>
    </nav>
  );
}
