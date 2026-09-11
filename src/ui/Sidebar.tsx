'use client';

import { useEffect, useState } from 'react';
import { byRank } from '@/core/rank';
import { projectProgress } from '@/core/membership';
import { tagPath } from '@/core/tags';
import { BUILT_IN_ORDER, VIEW_TITLES, type ViewKey } from '@/core/selectors';
import { useApp, useCounts, useIndexes } from '@/state/store';
import * as actions from '@/state/actions';
import { IconButton, Popover, ProgressRing } from './primitives';
import { CloudIcon, FolderIcon, MoreIcon, PlusIcon, SearchIcon, SettingsIcon, TagIcon, UserIcon } from './icons';
import { sidebarIcon, viewStyle } from './view-style';

/** Views that live behind "More lists" rather than in the main navigation. */
const OVERFLOW_VIEWS: ViewKey[] = ['tomorrow', 'deadlines', 'repeating', 'allProjects', 'loggedProjects', 'trash'];

const SYNC_LABELS: Record<string, string> = {
  local: 'Saved on this device',
  savedOnDevice: 'Saved on device',
  syncing: 'Syncing…',
  upToDate: 'Up to date',
  error: 'Sync error',
  unsaved: 'Not saved',
};

/** `⌘` on Apple hardware, `Ctrl` elsewhere. Resolved after mount to avoid a mismatch. */
function useShortcutPrefix(): string {
  const [prefix, setPrefix] = useState('Ctrl');
  useEffect(() => {
    const platform = `${navigator.platform} ${navigator.userAgent}`;
    setPrefix(/Mac|iPhone|iPad|iPod/.test(platform) ? '⌘' : 'Ctrl');
  }, []);
  return prefix;
}

function NavItem({
  label, count, icon, color, active, onSelect, indent = 0, trailing,
}: {
  label: string;
  count?: number;
  icon: React.ReactNode;
  color?: string;
  active: boolean;
  onSelect: () => void;
  indent?: number;
  trailing?: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={onSelect}
        className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl pr-2.5 text-left text-[15px] transition-colors ${
          active
            ? 'bg-accent-soft font-semibold text-accent'
            : 'hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]'
        }`}
        style={{ paddingLeft: 12 + indent * 16 }}
      >
        {/* The glyph keeps its own hue even on the active row, so the list stays identifiable. */}
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center" style={{ color }} aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
        {count !== undefined && count > 0 ? (
          <span className={`shrink-0 text-[13px] tabular-nums ${active ? 'text-accent' : 'text-faint'}`}>{count}</span>
        ) : null}
      </button>
    </li>
  );
}

function SectionHeading({ label, addLabel, onAdd }: { label: string; addLabel: string; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-1">
      <h2 className="flex-1 text-[12px] font-bold uppercase tracking-[0.1em] text-faint">{label}</h2>
      <IconButton label={addLabel} onClick={onAdd}><PlusIcon size={15} /></IconButton>
    </div>
  );
}

const Divider = () => <div className="mx-3 my-3 border-t border-line" aria-hidden="true" />;

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
  const email = useApp((s) => s.email);
  const pendingCount = useApp((s) => s.pending.length);

  const [creating, setCreating] = useState<'project' | 'area' | 'tag' | null>(null);
  const [draft, setDraft] = useState('');
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const shortcut = useShortcutPrefix();

  const select = (next: ViewKey) => {
    setView(next);
    onClose?.();
  };

  const tags = Object.values(db.tags).filter((t) => t.deletedAt === null).sort(byRank);

  const submitDraft = () => {
    const title = draft.trim();
    if (title) {
      if (creating === 'project') select(`project:${actions.createProject(title, null)}`);
      else if (creating === 'area') actions.createArea(title);
      else actions.createTagNamed(title);
    }
    setDraft('');
    setCreating(null);
  };

  const draftField = (placeholder: string) => (
    <div className="px-3 pb-1">
      <input
        type="text"
        autoFocus
        value={draft}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={submitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submitDraft();
          if (event.key === 'Escape') {
            setDraft('');
            setCreating(null);
          }
        }}
        className="h-10 w-full rounded-xl border border-accent bg-surface px-3 text-[15px] outline-none"
      />
    </div>
  );

  const accountName = signedIn && email ? email : 'Local account';
  const initial = (signedIn && email ? email[0] : '')?.toUpperCase();

  return (
    <nav aria-label="Lists" className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-3 px-4 pb-4 pt-5">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-accent text-accent-contrast shadow-[var(--shadow-sm)]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 12.5 5.2 5.2L20 6.6" />
          </svg>
        </span>
        <span className="text-[22px] font-bold tracking-[-0.02em]">Clearing</span>
      </div>

      {/* Quick find sits in the panel rather than behind an icon in the header. */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-left text-[15px] text-faint transition-colors hover:border-line-strong"
        >
          <SearchIcon size={17} />
          <span className="flex-1">Quick find</span>
          <kbd className="rounded-md px-1 font-sans text-[12.5px] text-faint">{shortcut} K</kbd>
        </button>
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto pb-2">
        <ul className="space-y-0.5 px-3">
          {BUILT_IN_ORDER.map((key) => (
            <NavItem
              key={key}
              label={VIEW_TITLES[key] as string}
              count={counts[key]}
              icon={sidebarIcon(key).icon}
              color={sidebarIcon(key).accent}
              active={view === key}
              onSelect={() => select(key)}
            />
          ))}
        </ul>

        <Divider />

        <SectionHeading label="Your areas" addLabel="New area" onAdd={() => { setDraft(''); setCreating('area'); }} />
        {creating === 'area' ? draftField('Area name') : null}
        <ul className="space-y-0.5 px-3">
          {indexes.areas.map((area) => (
            <li key={area.id}>
              <ul className="space-y-0.5">
                <NavItem
                  label={area.title}
                  icon={viewStyle(`area:${area.id}`).icon}
                  color="var(--accent)"
                  active={view === `area:${area.id}`}
                  onSelect={() => select(`area:${area.id}`)}
                />
                {(indexes.projectsByArea.get(area.id) ?? [])
                  .filter((p) => p.status === 'open')
                  .map((project) => (
                    <NavItem
                      key={project.id}
                      label={project.title}
                      icon={<ProgressRing percent={projectProgress(indexes.tasksByProject.get(project.id) ?? []).percent} size={15} />}
                      active={view === `project:${project.id}`}
                      onSelect={() => select(`project:${project.id}`)}
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
                label={project.title}
                icon={<FolderIcon size={17} />}
                color="var(--accent)"
                active={view === `project:${project.id}`}
                onSelect={() => select(`project:${project.id}`)}
              />
            ))}
        </ul>

        {creating === 'project' ? (
          draftField('Project name')
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(''); setCreating('project'); }}
            className="mt-0.5 flex min-h-[40px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
          >
            <PlusIcon size={17} />
            New project
          </button>
        )}

        <Divider />

        <SectionHeading label="Tags" addLabel="New tag" onAdd={() => { setDraft(''); setCreating('tag'); }} />
        {creating === 'tag' ? draftField('Tag name') : null}
        {tags.length > 0 ? (
          <ul className="space-y-0.5 px-3">
            {tags.map((tag) => {
              const active = tagFilter.includes(tag.id);
              return (
                <NavItem
                  key={tag.id}
                  label={tagPath(db, tag.id)}
                  icon={<TagIcon size={16} />}
                  color={active ? 'var(--accent)' : 'var(--text-faint)'}
                  active={active}
                  onSelect={() => setTagFilter(active ? tagFilter.filter((t) => t !== tag.id) : [...tagFilter, tag.id])}
                />
              );
            })}
          </ul>
        ) : (
          <p className="px-3 pb-1 text-[13px] text-faint">No tags yet.</p>
        )}
        {tagFilter.length > 0 ? (
          <button type="button" onClick={() => setTagFilter([])} className="px-3 pt-1 text-[13px] font-medium text-accent hover:underline">
            Clear tag filter
          </button>
        ) : null}

        {/* The special views stay reachable without crowding the main navigation. */}
        <button
          type="button"
          onClick={(event) => setMoreAnchor(event.currentTarget)}
          className="mt-3 flex min-h-[40px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
        >
          <MoreIcon size={17} />
          More lists
        </button>
        {moreAnchor ? (
          <Popover anchor={moreAnchor} onClose={() => setMoreAnchor(null)} label="More lists" width={240}>
            <ul className="space-y-0.5">
              {OVERFLOW_VIEWS.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => { select(key); setMoreAnchor(null); }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[14px] hover:bg-surface-2"
                  >
                    <span className="flex h-5 w-5 items-center justify-center" style={{ color: viewStyle(key).accent }} aria-hidden="true">
                      {viewStyle(key).icon}
                    </span>
                    {VIEW_TITLES[key]}
                  </button>
                </li>
              ))}
            </ul>
          </Popover>
        ) : null}
      </div>

      <div className="border-t border-line px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent"
          >
            {initial || <UserIcon size={16} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{accountName}</span>
          <IconButton label="Settings" onClick={onOpenSettings}><SettingsIcon size={17} /></IconButton>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-1.5 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[13px] text-faint hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
        >
          <CloudIcon size={14} />
          <span aria-live="polite">
            {SYNC_LABELS[syncStatus]}
            {signedIn && pendingCount > 0 ? ` · ${pendingCount} to sync` : ''}
          </span>
        </button>
      </div>
    </nav>
  );
}
