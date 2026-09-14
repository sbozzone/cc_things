'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VIEW_TITLES, type ViewKey } from '@/core/selectors';
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
  const composerRef = useRef<HTMLInputElement | null>(null);
  const isPhone = usePhone();

  useEffect(() => {
    void initialize();
  }, [initialize]);

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
      <div className="flex h-dvh items-center justify-center text-[14px] text-muted">
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
          <div className="absolute inset-0 bg-black/35" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="relative z-10 w-[86vw] max-w-[330px] border-r border-line shadow-[var(--shadow)]">
            <Sidebar
              onOpenSearch={() => { setOverlay('search'); setSidebarOpen(false); }}
              onOpenSettings={() => { setOverlay('settings'); setSidebarOpen(false); }}
              onClose={() => setSidebarOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <main id="main" className="scroll-area min-w-0 flex-1 overflow-y-auto" style={{ '--view-accent': accent } as React.CSSProperties}>
        <div className="mx-auto w-full max-w-[780px] px-3 sm:px-6">
          <header className="page-header sticky top-0 z-20 -mx-3 flex items-center gap-3 px-3 pb-2.5 pt-3 sm:-mx-6 sm:px-6 sm:pt-5">
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
                <span aria-hidden="true" className="badge-wash flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]">
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[25px] font-semibold leading-none tracking-[-0.02em]">{doc.title}</h1>
                  {doc.subtitle ? <p className="mt-1 truncate text-[12.5px] text-muted">{doc.subtitle}</p> : null}
                </div>
              </>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <span className={`shrink-0 text-[12.5px] text-faint ${isPhone ? 'sr-only' : ''}`} aria-live="polite">
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
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-fill text-accent-fill-contrast shadow-[var(--shadow-sm)] transition-transform hover:scale-105 active:scale-95"
            >
              <PlusIcon size={17} />
            </button>
          </header>

          {tagFilter.length > 0 ? (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-[12.5px] text-accent">
              <span>Showing items with {tagFilter.length === 1 ? 'this tag' : 'all of these tags'}.</span>
              <button type="button" onClick={() => setTagFilter([])} className="font-medium underline">Clear</button>
            </div>
          ) : null}

          {isProject ? <ProjectHeader projectId={view.slice(8)} /> : null}
          {isArea ? <AreaHeader areaId={view.slice(5)} /> : null}

          {composerOpen ? (
            <div className="mb-2">
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
                className="h-10 w-full rounded-md border border-accent bg-surface px-2.5 text-[14.5px] outline-none"
              />
            </div>
          ) : null}

          <ListView doc={doc} />
        </div>
      </main>

      {isPhone && selection.length === 0 ? (
        <button
          type="button"
          aria-label="Quick capture"
          onClick={() => setOverlay('capture')}
          className="fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent-fill text-accent-fill-contrast shadow-[var(--shadow)]"
        >
          <PlusIcon size={22} />
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
