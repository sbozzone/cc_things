'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { systemClock } from '@/core/clock';
import { contextFor } from '@/core/commands';
import { emptyDatabase, purgeIds } from '@/core/db';
import { today as todayOf, todayIn } from '@/core/dates';
import { newDeviceId, newId } from '@/core/ids';
import { applyPatches, inverseOf, type EntityPatch, type WriteContext } from '@/core/patches';
import { generateDueOccurrences } from '@/core/recurrence';
import { dailyResetPatches } from '@/core/my-day';
import { buildIndexes, runView, sidebarCounts, type Indexes, type ListDocument, type ViewKey } from '@/core/selectors';
import { purgeExpiredTrash } from '@/core/commands';
import type { Database, DateOnly, SyncOperation } from '@/core/types';
import {
  acknowledgeOps, loadLocal, persistIncoming, persistPatches, resetLocal, setLocalIdentity,
} from '@/db/local';
import { fetchSession, pushAndPull, SyncAuthError, SyncUnavailableError } from './sync-client';

/**
 * Application state.
 *
 * The store owns one record set and one write path: every change goes through
 * `dispatch`, which applies patches in memory, commits them with their sync operations
 * in a single durable local transaction, and records an exact inverse for Undo.
 */

/** The four states the requirement asks to be distinguishable, plus a local-only mode. */
export type SyncStatus = 'local' | 'savedOnDevice' | 'syncing' | 'upToDate' | 'error' | 'unsaved';

export interface UndoEntry {
  label: string;
  inverse: EntityPatch[];
  at: number;
}

export interface Toast {
  id: string;
  message: string;
  actionLabel?: string;
  action?: () => void;
  tone: 'info' | 'warning' | 'error';
}

export interface DispatchOptions {
  /** Enables Undo for this transaction and names it in the confirmation. */
  undoLabel?: string;
  /** Local-only changes (view state, device preferences) skip the sync queue. */
  local?: boolean;
  toast?: Omit<Toast, 'id'> | null;
}

interface AppState {
  ready: boolean;
  db: Database;
  ownerId: string;
  deviceId: string;
  today: DateOnly;

  view: ViewKey;
  openItemId: string | null;
  selection: string[];
  lastAnchorId: string | null;
  tagFilter: string[];
  showLogged: boolean;

  syncStatus: SyncStatus;
  syncConfigured: boolean;
  signedIn: boolean;
  email: string | null;
  pending: SyncOperation[];
  cursor: number;
  lastSyncError: string | null;
  conflictCount: number;

  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  toasts: Toast[];

  initialize: () => Promise<void>;
  dispatch: (patches: EntityPatch[], options?: DispatchOptions) => void;
  ctx: () => WriteContext;
  indexes: () => Indexes;
  list: (view?: ViewKey) => ListDocument;
  counts: () => Record<string, number>;

  setView: (view: ViewKey) => void;
  openItem: (id: string | null) => void;
  setSelection: (ids: string[], anchorId?: string | null) => void;
  toggleSelected: (id: string) => void;
  extendSelection: (id: string, orderedIds: string[]) => void;
  clearSelection: () => void;
  setTagFilter: (tagIds: string[]) => void;
  setShowLogged: (value: boolean) => void;

  undo: () => void;
  redo: () => void;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;

  syncNow: () => Promise<void>;
  refreshSession: () => Promise<void>;
  runMaintenance: () => void;
  replaceDatabase: (db: Database) => Promise<void>;
  signOutLocal: () => Promise<void>;
}

const LOCAL_OWNER = 'local-owner';
let indexCache: { db: Database; today: DateOnly; value: Indexes } | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let syncInFlight = false;

function opsFor(patches: EntityPatch[], deviceId: string, ownerId: string, now: string): SyncOperation[] {
  return patches.map((patch) => ({
    opId: newId('op_'),
    deviceId,
    ownerId,
    table: patch.table,
    entityId: patch.id,
    baseRevision: 0,
    patch: patch.remove ? { __removed: true, ...patch.patch } : patch.patch,
    createdAt: now,
    serverSeq: null,
  }));
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  db: emptyDatabase(LOCAL_OWNER, new Date().toISOString(), systemClock.timeZone()),
  ownerId: LOCAL_OWNER,
  deviceId: 'pending',
  today: todayOf(systemClock),

  view: 'today',
  openItemId: null,
  selection: [],
  lastAnchorId: null,
  tagFilter: [],
  showLogged: false,

  syncStatus: 'local',
  syncConfigured: false,
  signedIn: false,
  email: null,
  pending: [],
  cursor: 0,
  lastSyncError: null,
  conflictCount: 0,

  undoStack: [],
  redoStack: [],
  toasts: [],

  async initialize() {
    if (get().ready) return;
    const timeZone = systemClock.timeZone();
    const loaded = await loadLocal(LOCAL_OWNER, timeZone).catch(() => null);

    if (!loaded) {
      // Storage is unavailable (private window, blocked site data). The app still runs;
      // the status line says work is not being saved.
      set({ ready: true, syncStatus: 'unsaved' });
      get().pushToast({ message: 'Local storage is unavailable, so changes will not be kept.', tone: 'error' });
      return;
    }

    const deviceId = loaded.deviceId ?? newDeviceId();
    const ownerId = loaded.ownerId ?? LOCAL_OWNER;
    if (!loaded.deviceId || !loaded.ownerId) await setLocalIdentity(ownerId, deviceId).catch(() => undefined);

    const planningZone = loaded.db.settings.planningTimeZone || timeZone;
    set({
      ready: true,
      db: loaded.db,
      ownerId,
      deviceId,
      pending: loaded.pending,
      cursor: loaded.cursor,
      today: todayIn(planningZone, Date.now()),
      syncStatus: loaded.pending.length > 0 ? 'savedOnDevice' : 'local',
    });

    get().runMaintenance();
    await get().refreshSession();

    if (clockTimer === null && typeof window !== 'undefined') {
      // The planning date is recomputed rather than incremented, so DST and a sleeping
      // device cannot make a naive 24-hour timer skip or repeat a My Day reset.
      clockTimer = setInterval(() => {
        get().runMaintenance();
      }, 30_000);
    }
  },

  ctx() {
    const state = get();
    return {
      ownerId: state.ownerId,
      now: new Date().toISOString(),
      today: state.today,
      timeZone: state.db.settings.planningTimeZone || systemClock.timeZone(),
    };
  },

  dispatch(patches, options = {}) {
    if (patches.length === 0) {
      if (options.toast) get().pushToast(options.toast);
      return;
    }
    const state = get();
    const inverse = inverseOf(state.db, patches);
    const db = applyPatches(state.db, patches);
    const now = new Date().toISOString();
    const ops = options.local ? [] : opsFor(patches, state.deviceId, state.ownerId, now);

    set({
      db,
      pending: [...state.pending, ...ops],
      undoStack: options.undoLabel
        ? [...state.undoStack, { label: options.undoLabel, inverse, at: Date.now() }].slice(-50)
        : state.undoStack,
      redoStack: options.undoLabel ? [] : state.redoStack,
      syncStatus: state.syncStatus === 'unsaved' ? 'unsaved' : ops.length > 0 ? 'savedOnDevice' : state.syncStatus,
    });

    void persistPatches(db, patches, ops)
      .then(() => {
        if (get().syncConfigured && get().signedIn) void get().syncNow();
      })
      .catch(() => {
        // A quota or storage failure must be visible rather than silently dropped (R33).
        set({ syncStatus: 'unsaved' });
        get().pushToast({
          message: 'Changes could not be saved to this device. Export your work from Settings.',
          tone: 'error',
        });
      });

    if (options.toast) get().pushToast(options.toast);
  },

  indexes() {
    const { db, today } = get();
    if (indexCache && indexCache.db === db && indexCache.today === today) return indexCache.value;
    const value = buildIndexes(db, today);
    indexCache = { db, today, value };
    return value;
  },

  list(view) {
    const state = get();
    return runView(state.db, state.indexes(), view ?? state.view, {
      tagFilter: state.tagFilter,
      todayGrouping: state.db.settings.todayGrouping,
    });
  },

  counts() {
    const state = get();
    return sidebarCounts(state.db, state.indexes(), { tagFilter: state.tagFilter });
  },

  setView(view) {
    set({ view, selection: [], lastAnchorId: null, openItemId: null, showLogged: false });
  },
  openItem(id) {
    set({ openItemId: id, selection: id ? [] : get().selection });
  },
  setSelection(ids, anchorId) {
    set({ selection: ids, lastAnchorId: anchorId ?? ids[ids.length - 1] ?? null, openItemId: null });
  },
  toggleSelected(id) {
    const selection = get().selection;
    const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
    set({ selection: next, lastAnchorId: id, openItemId: null });
  },
  extendSelection(id, orderedIds) {
    const anchor = get().lastAnchorId ?? id;
    const from = orderedIds.indexOf(anchor);
    const to = orderedIds.indexOf(id);
    if (from < 0 || to < 0) {
      set({ selection: [id], lastAnchorId: id, openItemId: null });
      return;
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    set({ selection: orderedIds.slice(lo, hi + 1), openItemId: null });
  },
  clearSelection() {
    set({ selection: [], lastAnchorId: null });
  },
  setTagFilter(tagIds) {
    set({ tagFilter: tagIds });
  },
  setShowLogged(value) {
    set({ showLogged: value });
  },

  undo() {
    const state = get();
    const entry = state.undoStack[state.undoStack.length - 1];
    if (!entry) return;
    const redoInverse = inverseOf(state.db, entry.inverse);
    set({ undoStack: state.undoStack.slice(0, -1) });
    get().dispatch(entry.inverse);
    set({ redoStack: [...get().redoStack, { label: entry.label, inverse: redoInverse, at: Date.now() }].slice(-50) });
    get().pushToast({ message: `Undid ${entry.label}`, tone: 'info' });
  },

  redo() {
    const state = get();
    const entry = state.redoStack[state.redoStack.length - 1];
    if (!entry) return;
    const undoInverse = inverseOf(state.db, entry.inverse);
    set({ redoStack: state.redoStack.slice(0, -1) });
    get().dispatch(entry.inverse);
    set({ undoStack: [...get().undoStack, { label: entry.label, inverse: undoInverse, at: Date.now() }].slice(-50) });
  },

  pushToast(toast) {
    const id = newId('toast_');
    set({ toasts: [...get().toasts, { ...toast, id }].slice(-4) });
    if (typeof window !== 'undefined') {
      window.setTimeout(() => get().dismissToast(id), toast.actionLabel ? 8000 : 4500);
    }
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  /**
   * Housekeeping that must run on load, on rollover and after foregrounding. Its first
   * step is the idempotent My Day reset, before list consumers observe the new day.
   */
  runMaintenance() {
    const initial = get();
    const zone = initial.db.settings.planningTimeZone || systemClock.timeZone();
    const currentToday = todayIn(zone, Date.now());
    if (currentToday !== initial.today) set({ today: currentToday });
    const state = get();
    const ctx = contextFor({ now: () => Date.now(), timeZone: () => state.db.settings.planningTimeZone }, state.ownerId);
    const dailyReset = dailyResetPatches(state.db, ctx);
    if (dailyReset.length > 0) get().dispatch(dailyReset);

    const occurrences = generateDueOccurrences(get().db, ctx);
    if (occurrences.length > 0) get().dispatch(occurrences);

    const purge = purgeExpiredTrash(get().db, ctx);
    if (purge.purgedIds.length > 0) {
      set({ db: purgeIds(get().db, purge.purgedIds) });
      void persistIncoming(get().db, [], get().cursor);
    }
  },

  async refreshSession() {
    const session = await fetchSession();
    set({
      syncConfigured: session.syncConfigured,
      signedIn: session.signedIn,
      email: session.email,
      syncStatus: session.signedIn ? get().syncStatus : 'local',
    });
    if (session.signedIn && session.ownerId) {
      if (session.ownerId !== get().ownerId) {
        // A different account signed in on this device: start from that account's data.
        await resetLocal();
        const db = emptyDatabase(session.ownerId, new Date().toISOString(), get().db.settings.planningTimeZone);
        const deviceId = newDeviceId();
        await setLocalIdentity(session.ownerId, deviceId);
        set({ db, ownerId: session.ownerId, deviceId, pending: [], cursor: 0, undoStack: [], redoStack: [] });
      }
      await get().syncNow();
      if (syncTimer === null && typeof window !== 'undefined') {
        syncTimer = setInterval(() => void get().syncNow(), 20_000);
      }
    }
  },

  async syncNow() {
    const state = get();
    if (!state.syncConfigured || !state.signedIn || syncInFlight) return;
    syncInFlight = true;
    set({ syncStatus: 'syncing' });
    try {
      const response = await pushAndPull({
        deviceId: state.deviceId,
        cursor: state.cursor,
        ops: state.pending.slice(0, 500),
      });
      const db = applyPatches(get().db, response.changes);
      set({
        db,
        cursor: response.cursor,
        pending: get().pending.filter((op) => !response.applied.includes(op.opId)),
        conflictCount: get().conflictCount + response.conflicts.length,
        lastSyncError: null,
      });
      await persistIncoming(db, response.changes, response.cursor);
      await acknowledgeOps(response.applied, response.cursor);
      set({ syncStatus: get().pending.length > 0 ? 'savedOnDevice' : 'upToDate' });
      if (response.conflicts.length > 0) {
        get().pushToast({
          message: `${response.conflicts.length} conflicting edit${response.conflicts.length === 1 ? '' : 's'} kept for review in Settings.`,
          tone: 'warning',
        });
      }
    } catch (error) {
      if (error instanceof SyncAuthError) {
        set({ signedIn: false, syncStatus: 'local', lastSyncError: error.message });
      } else if (error instanceof SyncUnavailableError) {
        set({ syncStatus: get().pending.length > 0 ? 'savedOnDevice' : 'local', lastSyncError: error.message });
      } else {
        set({ syncStatus: 'error', lastSyncError: error instanceof Error ? error.message : 'Sync failed' });
      }
    } finally {
      syncInFlight = false;
    }
  },

  async replaceDatabase(db) {
    set({ db, undoStack: [], redoStack: [] });
    await resetLocal();
    const records: EntityPatch[] = [];
    for (const table of [
      'areas', 'projects', 'headings', 'tasks', 'checklistItems', 'tags', 'tagAssignments',
      'repeatTemplates', 'occurrenceLinks', 'reminders',
    ] as const) {
      for (const id of Object.keys(db[table])) records.push({ table, id, patch: {} });
    }
    records.push({ table: 'settings', id: 'settings', patch: {} });
    await setLocalIdentity(get().ownerId, get().deviceId);
    await persistIncoming(db, records, 0);
    set({ cursor: 0, pending: [] });
  },

  async signOutLocal() {
    await resetLocal();
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    const db = emptyDatabase(LOCAL_OWNER, new Date().toISOString(), systemClock.timeZone());
    set({
      db, ownerId: LOCAL_OWNER, pending: [], cursor: 0, signedIn: false,
      email: null, syncStatus: 'local', undoStack: [], redoStack: [], view: 'today',
    });
  },
}));

export function useIsReady(): boolean {
  return useApp((s) => s.ready);
}

/* ------------------------------------------------------------------ hooks */

/**
 * Derived values must be memoized outside the selector.
 *
 * A zustand selector that builds a fresh object on every read compares unequal each
 * time and re-renders forever, so `list()`, `counts()` and `indexes()` are exposed as
 * hooks that recompute only when their inputs actually change.
 */
export function useIndexes(): Indexes {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  return useMemo(() => buildIndexes(db, today), [db, today]);
}

export function useListDocument(view?: ViewKey): ListDocument {
  const db = useApp((s) => s.db);
  const today = useApp((s) => s.today);
  const currentView = useApp((s) => s.view);
  const tagFilter = useApp((s) => s.tagFilter);
  const grouping = useApp((s) => s.db.settings.todayGrouping);
  const indexes = useIndexes();
  const key = view ?? currentView;
  return useMemo(
    () => runView(db, indexes, key, { tagFilter, todayGrouping: grouping }),
    [db, indexes, key, tagFilter, grouping],
  );
}

export function useCounts(): Record<string, number> {
  const db = useApp((s) => s.db);
  const tagFilter = useApp((s) => s.tagFilter);
  const indexes = useIndexes();
  return useMemo(() => sidebarCounts(db, indexes, { tagFilter }), [db, indexes, tagFilter]);
}
