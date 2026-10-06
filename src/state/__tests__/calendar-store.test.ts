import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDatabase } from '@/core/db';
import type { CalendarSubscription } from '@/core/types';
import { useApp } from '../store';

const mocks = vi.hoisted(() => ({
  persistPatches: vi.fn(async () => undefined), persistIncoming: vi.fn(async () => undefined),
  resetLocal: vi.fn(async () => undefined), setLocalIdentity: vi.fn(async () => undefined),
  acknowledgeOps: vi.fn(async () => undefined), loadLocal: vi.fn(),
  fetchSession: vi.fn(), pushAndPull: vi.fn(), refreshStaleCalendars: vi.fn(async () => undefined),
}));
vi.mock('@/db/local', () => mocks);
vi.mock('../calendar', () => ({ refreshStaleCalendars: mocks.refreshStaleCalendars }));
vi.mock('../sync-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../sync-client')>(),
  fetchSession: mocks.fetchSession, pushAndPull: mocks.pushAndPull,
}));

const now = '2026-10-06T12:00:00.000Z';
const subscription: CalendarSubscription = {
  id: 'cal', ownerId: 'owner', providerId: 'ics', calendarId: 'cal', title: 'Work',
  url: 'https://example.com/work.ics', enabled: true, lastRefreshedAt: now, lastError: null, parserVersion: 2,
};

beforeEach(async () => {
  await useApp.getState().signOutLocal();
  vi.clearAllMocks();
  useApp.setState({
    ownerId: 'owner', deviceId: 'device', db: emptyDatabase('owner', now),
    ready: true, signedIn: true, syncConfigured: true, pending: [], cursor: 0,
  });
  mocks.fetchSession.mockResolvedValue({ signedIn: true, syncConfigured: true, ownerId: 'owner', email: 'tester@example.com' });
  mocks.pushAndPull.mockImplementation(async (request) => ({
    applied: request.ops.map((op: { opId: string }) => op.opId), changes: [],
    cursor: 1, conflicts: [], serverTime: now,
  }));
});

afterEach(async () => {
  await useApp.getState().signOutLocal();
});

describe('calendar account backup and restore', () => {
  it('queues an old local connection once and durably commits its marker with its configuration operation', async () => {
    const db = emptyDatabase('owner', now);
    db.calendarSubscriptions.cal = { ...subscription };
    useApp.setState({ db });
    await useApp.getState().refreshSession();
    const [savedDb, savedPatches, savedOps] = mocks.persistPatches.mock.calls[0] as unknown as [typeof db, unknown[], { patch: Record<string, unknown> }[]];
    expect(savedDb.calendarSubscriptions.cal?.configSynced).toBe(true);
    expect(savedPatches).toHaveLength(1);
    expect(savedOps).toHaveLength(1);
    expect(Object.keys(savedOps[0]!.patch).sort()).toEqual(['id', 'ownerId', 'providerId', 'calendarId', 'title', 'url', 'enabled'].sort());
    expect(mocks.pushAndPull.mock.calls[0]?.[0].ops).toEqual([]);
    await vi.waitFor(() => expect(useApp.getState().pending).toEqual([]));
    expect(mocks.pushAndPull.mock.calls[1]?.[0].ops).toHaveLength(1);
    await useApp.getState().refreshSession();
    expect(mocks.persistPatches).toHaveBeenCalledTimes(1);
    expect(mocks.pushAndPull.mock.calls[2]?.[0].ops).toEqual([]);
  });

  it('restores account connections and fetches their events on a fresh device', async () => {
    const { lastRefreshedAt: _time, lastError: _error, parserVersion: _parser, ...config } = subscription;
    mocks.pushAndPull.mockResolvedValueOnce({
      applied: [], changes: [{ table: 'calendarSubscriptions', id: 'cal', patch: config, create: true }],
      cursor: 1, conflicts: [], serverTime: now,
    });
    await useApp.getState().syncNow();
    expect(useApp.getState().db.calendarSubscriptions.cal).toMatchObject({ configSynced: true, url: subscription.url, lastRefreshedAt: null });
    await vi.waitFor(() => expect(mocks.refreshStaleCalendars).toHaveBeenCalledTimes(1));
    await useApp.getState().refreshSession();
    expect(mocks.pushAndPull.mock.calls[1]?.[0].ops).toEqual([]);
  });

  it('pulls newer account settings before migrating a stale legacy copy', async () => {
    const db = emptyDatabase('owner', now);
    db.calendarSubscriptions.cal = { ...subscription };
    useApp.setState({ db });
    mocks.pushAndPull.mockResolvedValueOnce({
      applied: [], changes: [{ table: 'calendarSubscriptions', id: 'cal', patch: { ...subscription, enabled: false }, create: true }],
      cursor: 1, conflicts: [], serverTime: now,
    });
    await useApp.getState().refreshSession();
    expect(useApp.getState().db.calendarSubscriptions.cal?.enabled).toBe(false);
    expect(mocks.persistPatches).not.toHaveBeenCalled();
    expect(mocks.pushAndPull.mock.calls[0]?.[0].ops).toEqual([]);
  });

  it('finishes every pull page before adopting an account connection with another legacy identity', async () => {
    const db = emptyDatabase('owner', now);
    db.calendarSubscriptions.cal = { ...subscription };
    useApp.setState({ db });
    mocks.pushAndPull.mockResolvedValueOnce({ applied: [], changes: [], cursor: 1000, hasMore: true, conflicts: [], serverTime: now });
    mocks.pushAndPull.mockResolvedValueOnce({
      applied: [], changes: [{ table: 'calendarSubscriptions', id: 'remote', patch: { ...subscription, id: 'remote', calendarId: 'remote', enabled: false }, create: true }],
      cursor: 1001, hasMore: false, conflicts: [], serverTime: now,
    });
    await useApp.getState().refreshSession();
    await vi.waitFor(() => expect(Object.keys(useApp.getState().db.calendarSubscriptions)).toEqual(['remote']));
    await vi.waitFor(() => expect(useApp.getState().pending).toEqual([]));
    expect(useApp.getState().db.calendarSubscriptions.remote?.enabled).toBe(false);
    expect(mocks.pushAndPull.mock.calls[0]?.[0].ops).toEqual([]);
    expect(mocks.pushAndPull.mock.calls[1]?.[0].ops).toEqual([]);
    expect(mocks.pushAndPull.mock.calls[2]?.[0].ops.every((op: { patch: Record<string, unknown> }) => op.patch.__removed === true)).toBe(true);
  });

  it('keeps calendar configuration during a task-only import replacement and persists it for reload', async () => {
    const db = emptyDatabase('owner', now);
    db.calendarSubscriptions.cal = { ...subscription, configSynced: true };
    useApp.setState({ db });
    await useApp.getState().replaceDatabase(emptyDatabase('owner', now));
    expect(useApp.getState().db.calendarSubscriptions.cal?.url).toBe(subscription.url);
    const [savedDb, savedPatches] = mocks.persistPatches.mock.calls[0] as unknown as [typeof db, { table: string; id: string }[]];
    expect(savedDb.calendarSubscriptions.cal).toBeDefined();
    expect(savedPatches).toContainEqual({ table: 'calendarSubscriptions', id: 'cal', patch: {} });
  });

  it('ignores a sync response from an account that signed out while it was in flight', async () => {
    let finish!: (value: unknown) => void;
    mocks.pushAndPull.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = useApp.getState().syncNow();
    useApp.setState({ ownerId: 'other-owner', db: emptyDatabase('other-owner', now) });
    finish({
      applied: [], changes: [{ table: 'calendarSubscriptions', id: 'cal', patch: subscription, create: true }],
      cursor: 1, conflicts: [], serverTime: now,
    });
    await pending;
    expect(useApp.getState().db.calendarSubscriptions).toEqual({});
    expect(mocks.persistIncoming).not.toHaveBeenCalled();
  });

  it('invalidates in-flight account secrets before awaiting sign-out storage clearing', async () => {
    let finishSync!: (value: unknown) => void;
    let finishReset!: () => void;
    mocks.pushAndPull.mockImplementationOnce(() => new Promise((resolve) => { finishSync = resolve; }));
    mocks.resetLocal.mockImplementationOnce(() => new Promise((resolve) => { finishReset = () => resolve(undefined); }));
    const pending = useApp.getState().syncNow();
    const signOut = useApp.getState().signOutLocal();
    expect(useApp.getState().signedIn).toBe(false);
    finishSync({
      applied: [], changes: [{ table: 'calendarSubscriptions', id: 'cal', patch: subscription, create: true }],
      cursor: 1, conflicts: [], serverTime: now,
    });
    await pending;
    expect(mocks.persistIncoming).not.toHaveBeenCalled();
    expect(useApp.getState().db.calendarSubscriptions).toEqual({});
    finishReset();
    await signOut;
  });

  it('does not restore preserved calendar secrets when a task import overlaps sign-out', async () => {
    const db = emptyDatabase('owner', now);
    db.calendarSubscriptions.cal = { ...subscription, configSynced: true };
    useApp.setState({ db });
    let finishReset!: () => void;
    mocks.resetLocal.mockImplementationOnce(() => new Promise((resolve) => { finishReset = () => resolve(undefined); }));
    const replacement = useApp.getState().replaceDatabase(emptyDatabase('owner', now));
    await useApp.getState().signOutLocal();
    finishReset();
    await replacement;
    expect(useApp.getState().db.calendarSubscriptions).toEqual({});
    expect(mocks.setLocalIdentity).not.toHaveBeenCalled();
    expect(mocks.persistPatches).not.toHaveBeenCalled();
  });
});
