'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VIEW_TITLES, type ViewKey } from '@/core/selectors';
import { emptyTagFilter, tagFilterActive } from '@/core/tags';
import { useApp, useListDocument } from '@/state/store';
import { refreshStaleCalendars } from '@/state/calendar';
import * as actions from '@/state/actions';
import { Sidebar } from './Sidebar';
import { ListView } from './ListView';
import { ProjectHeader } from './ProjectHeader';
import { AreaHeader } from './AreaHeader';
import { SearchPalette } from './SearchPalette';
import { QuickCapture } from './QuickCapture';
import { SettingsPanel } from './SettingsPanel';
import { Toasts } from './Toasts';
import { DueReminders } from './DueReminders';
import { IconButton } from './primitives';
import { InboxIcon, LayersIcon, PlusIcon, SearchIcon, UndoIcon } from './icons';
import { usePhone } from './useMediaQuery';
import { viewStyle } from './view-style';

const JUMP_KEYS: Record<string, ViewKey> = {
  '1': 'inbox', '2': 'today', '3': 'upcoming', '4': 'anytime', '5': 'someday', '6': 'logbook',
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

export function AppShell() {
  const ready = useApp((s) => s.ready);
  const initialize = useApp((s) => s.initialize);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const doc = useListDocument();
  const settings = useApp((s) => s.db.settings);
  const selection = useApp((s) => s.selection);
  const clearSelection = useApp((s) => s.clearSelection);
  const openItem = useApp((s) => s.openItem);
  const openItemId = useApp((s) => s.openItemId);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const undoDepth = useApp((s) => s.undoStack.length);
  const tagFilter = useApp((s) => s.tagFilter);
  const setTagFilter = useApp((s) => s.setTagFilter);
  const runMaintenance = useApp((s) => s.runMaintenance);

  const [overlay, setOverlay] = useState<'search' | 'capture' | 'settings' | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isPhone = usePhone();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // The header only draws its hairline once content has scrolled beneath it.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!(entry?.isIntersecting ?? true)));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [ready]);

  // Stable links: `?view=` opens a list or project, `?task=` opens one item (R28, R30).
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const linkedView = params.get('view');
    const linkedTask = params.get('task');
    if (linkedView) setView(linkedView as ViewKey);
    if (linkedTask) openItem(linkedTask);
  }, [ready, setView, openItem]);

  // Keep the address bar in step, so the current list can be copied or reopened.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams();
    params.set('view', view);
    if (openItemId) params.set('task', openItemId);
    const next = `${window.location.pathname}?${params.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  }, [ready, view, openItemId]);

  // Register the service worker so the app opens offline after the first visit.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  // Resuming: catch up on rollover, missed recurrences and stale calendar caches.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      runMaintenance();
      void refreshStaleCalendars();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [runMaintenance]);

  const addHere = useCallback(() => {
    setComposerOpen(true);
    openItem(null);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }, [openItem]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);

      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOverlay('search');
        return;
      }
      if (meta && event.key.toLowerCase() === 'z') {
        // Leave undo alone while a text field has focus so native editing still works.
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === 'Escape') {
        if (overlay) setOverlay(null);
        else if (openItemId) openItem(null);
        else if (selection.length > 0) clearSelection();
        else if (composerOpen) setComposerOpen(false);
        return;
      }
      if (typing || meta || event.altKey) return;

      if (event.key === '/') {
        event.preventDefault();
        setOverlay('search');
      } else if (event.key === '?') {
        event.preventDefault();
        setOverlay('settings');
      } else if (event.key === 'n') {
        event.preventDefault();
        addHere();
      } else if (event.key === 'N') {
        event.preventDefault();
        setOverlay('capture');
      } else if (JUMP_KEYS[event.key]) {
        event.preventDefault();
        setView(JUMP_KEYS[event.key] as ViewKey);
      } else if (settings.typeToSearch && /^[a-z]$/i.test(event.key)) {
        // Type-to-search only ever starts when focus is outside an editable field, and
        // it can be turned off entirely (spec §9, keyboard behaviour).
        setOverlay('search');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlay, openItemId, selection.length, composerOpen, settings.typeToSearch, addHere, clearSelection, openItem, redo, setView, undo]);

  if (!ready) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-[14px] text-muted">
        <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-accent-fill text-accent-fill-contrast shadow-[var(--shadow-sm)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12.5 5.2 5.2L20 6.6" /></svg>
        </span>
        <span role="status">Opening your lists…</span>
      </div>
    );
  }

  const isProject = view.startsWith('project:');
  const isArea = view.startsWith('area:');
  const { icon, accent } = viewStyle(view);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="skip-link">Skip to list</a>

      {!isPhone && !settings.sidebarCollapsed ? (
        <aside className="w-[276px] shrink-0 border-r border-line">
          <Sidebar
            onOpenSearch={() => setOverlay('search')}
            onOpenSettings={() => setOverlay('settings')}
            onCollapse={() => actions.updateSettings({ sidebarCollapsed: true })}
          />
        </aside>
      ) : null}

      {isPhone && sidebarOpen ? (
        <div className="fixed inset-0 z-40 flex">
          <div className="scrim absolute inset-0" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="pop-in relative z-10 w-[86vw] max-w-[330px] rounded-r-xl border-r border-line shadow-[var(--shadow-pop)]">
            <Sidebar
              onOpenSearch={() => { setOverlay('search'); setSidebarOpen(false); }}
              onOpenSettings={() => { setOverlay('settings'); setSidebarOpen(false); }}
              onClose={() => setSidebarOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <main id="main" className="scroll-area min-w-0 flex-1 overflow-y-auto" style={{ '--view-accent': accent } as React.CSSProperties}>
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <header data-stuck={stuck} className="page-header sticky top-0 z-20">
          <div className="mx-auto flex w-full max-w-[800px] items-center gap-3 px-3 pb-3 pt-3 sm:px-7 sm:pt-6">
            {isPhone ? (
              <IconButton label="Open lists" onClick={() => setSidebarOpen(true)}><LayersIcon /></IconButton>
            ) : null}
            {!isPhone && settings.sidebarCollapsed ? (
              <IconButton
                label="Expand sidebar"
                onClick={() => actions.updateSettings({ sidebarCollapsed: false })}
              >
                <LayersIcon />
              </IconButton>
            ) : null}
            {!isProject && !isArea ? (
              <>
                {/* The list's own hue, washed behind its glyph, so each page is recognisable at a glance. */}
                <span aria-hidden="true" className="badge-wash flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] [&>svg]:h-[19px] [&>svg]:w-[19px]">
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[26px] font-bold leading-none tracking-[-0.025em]">{doc.title}</h1>
                  {doc.subtitle ? <p className="mt-1.5 truncate text-[13px] text-muted">{doc.subtitle}</p> : null}
                </div>
              </>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <span className={`shrink-0 rounded-full bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted ${isPhone || (doc.openCount === 0 && !doc.filtered) ? 'sr-only' : ''}`} aria-live="polite">
              {doc.openCount > 0
                ? `${doc.openCount} open${doc.filtered ? ', filtered' : ''}`
                : doc.filtered ? 'Filtered' : ''}
            </span>
            {isPhone ? <IconButton label="Search" onClick={() => setOverlay('search')}><SearchIcon /></IconButton> : null}
            {undoDepth > 0 ? <IconButton label="Undo" onClick={undo}><UndoIcon /></IconButton> : null}
            {!isPhone ? (
              <IconButton label="Quick capture to Inbox" onClick={() => setOverlay('capture')}><InboxIcon /></IconButton>
            ) : null}
            <button
              type="button"
              aria-label={`Add a task to ${doc.title}`}
              title={`Add a task to ${doc.title}`}
              onClick={addHere}
              className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-fill text-accent-fill-contrast shadow-[var(--shadow-sm),inset_0_1px_0_rgb(255_255_255_/_18%)] transition-[filter,transform] hover:brightness-[1.04]"
            >
              <PlusIcon size={17} strokeWidth={2.4} />
            </button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[800px] px-3 sm:px-7">
          {tagFilterActive(tagFilter) ? (
            <div className="fade-in mb-2 flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
              <span>{tagFilter.mode === 'exclude'
                ? tagFilter.untagged && tagFilter.tagIds.length === 0
                  ? 'Showing items that have a tag.'
                  : `Excluding ${tagFilter.tagIds.length === 1 ? 'the selected tag' : 'selected tags'}${tagFilter.untagged ? ' and untagged items' : ''}.`
                : tagFilter.untagged && tagFilter.tagIds.length === 0
                  ? 'Showing untagged items.'
                  : `Showing items with ${tagFilter.tagIds.length === 1 ? 'the selected tag' : 'any selected tag'}${tagFilter.untagged ? ' or no tag' : ''}.`}</span>
              <button type="button" onClick={() => setTagFilter(emptyTagFilter())} className="font-medium underline">Clear</button>
            </div>
          ) : null}

          {isProject ? <ProjectHeader projectId={view.slice(8)} /> : null}
          {isArea ? <AreaHeader areaId={view.slice(5)} /> : null}

          {composerOpen ? (
            <div className="fade-in mb-2">
              <div className="card flex items-center gap-2.5 px-3 ring-2 ring-[color-mix(in_srgb,var(--accent-fill)_35%,transparent)]">
                <span aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-[7px] border-[1.5px] border-dashed border-control" />
                <input
                  ref={composerRef}
                  type="text"
                  aria-label={`New task in ${doc.title}`}
                  placeholder={`New task in ${doc.title}`}
                  onBlur={(event) => {
                    if (event.target.value.trim()) actions.addTask(doc.addTarget, event.target.value, { atTop: true });
                    setComposerOpen(false);
                  }}
                  onKeyDown={(event) => {
                    const input = event.currentTarget;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (!input.value.trim()) {
                        setComposerOpen(false);
                        return;
                      }
                      actions.addTask(doc.addTarget, input.value, { atTop: true });
                      input.value = '';
                    } else if (event.key === 'Escape') {
                      input.value = '';
                      setComposerOpen(false);
                    }
                  }}
                  className="h-11 w-full bg-transparent text-[14.5px] outline-none placeholder:text-faint"
                />
                <kbd className="hidden shrink-0 sm:inline-block">↵</kbd>
              </div>
            </div>
          ) : null}

          <ListView doc={doc} />
        </div>
      </main>

      {isPhone && selection.length === 0 && !openItemId && !overlay ? (
        <button
          type="button"
          aria-label="Quick capture"
          onClick={() => setOverlay('capture')}
          className="press fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent-fill text-accent-fill-contrast shadow-[var(--shadow-pop),inset_0_1px_0_rgb(255_255_255_/_18%)]"
        >
          <PlusIcon size={24} strokeWidth={2.4} />
        </button>
      ) : null}

      {overlay === 'search' ? <SearchPalette onClose={() => setOverlay(null)} /> : null}
      {overlay === 'capture' ? <QuickCapture onClose={() => setOverlay(null)} /> : null}
      {overlay === 'settings' ? <SettingsPanel onClose={() => setOverlay(null)} /> : null}

      <DueReminders />
      <Toasts />
      <span className="sr-only" aria-live="polite">{VIEW_TITLES[view] ?? doc.title}</span>
    </div>
  );
}
