'use client';

import { useState } from 'react';
import { byRank } from '@/core/rank';
import { projectProgress } from '@/core/membership';
import { tagPath } from '@/core/tags';
import { BUILT_IN_ORDER, VIEW_TITLES, type ViewKey } from '@/core/selectors';
import { useApp, useCounts, useIndexes } from '@/state/store';
import * as actions from '@/state/actions';
import { Button, IconButton, ProgressRing } from './primitives';
import { CloudIcon, FolderIcon, LayersIcon, PlusIcon, SearchIcon, SettingsIcon, TagIcon } from './icons';
import { sidebarIcon } from './view-style';

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
        className={`group relative flex min-h-[38px] w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left text-[14px] transition-all ${
          active
            ? 'bg-surface font-semibold shadow-[var(--shadow-sm)]'
            : 'hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]'
        }`}
        style={{ paddingLeft: 10 + indent * 14 }}
      >
        {/* The active row is marked by a bar in the list's own colour, not by fill alone. */}
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full transition-opacity"
          style={{ background: color ?? 'var(--accent)', opacity: active ? 1 : 0 }}
        />
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center transition-transform group-hover:scale-110"
          style={{ color }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 ? (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11.5px] font-medium tabular-nums ${
              active ? 'bg-accent-soft text-accent' : 'text-faint'
            }`}
          >
            {count}
          </span>
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
  const counts = useCounts();
  const indexes = useIndexes();
  const tagFilter = useApp((s) => s.tagFilter);
  const setTagFilter = useApp((s) => s.setTagFilter);
  const syncStatus = useApp((s) => s.syncStatus);
  const signedIn = useApp((s) => s.signedIn);
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
      <div className="flex items-center gap-1 px-2 pt-3 pb-2">
        <span className="flex flex-1 select-none items-center gap-2 px-1">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-accent text-accent-contrast shadow-[var(--shadow-sm)]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 12.5 5.2 5.2L20 6.6" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Clearing</span>
        </span>
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
              icon={sidebarIcon(key).icon}
              color={sidebarIcon(key).accent}
              active={view === key}
              onSelect={select}
            />
          ))}
        </ul>

        {indexes.areas.length > 0 || indexes.unfiledProjects.length > 0 ? (
          <div className="mt-4">
            <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Areas</h2>
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
            <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
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
            <NavItem view="trash" label="Trash" icon={sidebarIcon('trash').icon} color="var(--text-faint)" active={view === 'trash'} onSelect={select} />
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
            {signedIn && pendingCount > 0 ? ` · ${pendingCount} to sync` : ''}
          </span>
        </button>
      </div>
    </nav>
  );
}
