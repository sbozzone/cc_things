'use client';

import { useState } from 'react';
import { useApp } from '@/state/store';
import { Button } from './primitives';

/**
 * Account access (R32) and the sync status line (R33).
 *
 * With no database configured the deployment stays local-only, and this panel says so
 * rather than offering an account that cannot exist.
 */
export function AccountPanel() {
  const syncConfigured = useApp((s) => s.syncConfigured);
  const signedIn = useApp((s) => s.signedIn);
  const email = useApp((s) => s.email);
  const syncStatus = useApp((s) => s.syncStatus);
  const pending = useApp((s) => s.pending.length);
  const lastSyncError = useApp((s) => s.lastSyncError);
  const refreshSession = useApp((s) => s.refreshSession);
  const syncNow = useApp((s) => s.syncNow);
  const signOutLocal = useApp((s) => s.signOutLocal);
  const pushToast = useApp((s) => s.pushToast);

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode === 'signIn' ? 'sign-in' : 'sign-up'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        pushToast({ message: body.error ?? 'Could not sign in.', tone: 'error' });
        return;
      }
      setForm({ email: '', password: '' });
      await refreshSession();
      pushToast({ message: 'Signed in. Your work will sync from here.', tone: 'info' });
    } catch {
      pushToast({ message: 'Could not reach the server.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async (keepLocal: boolean) => {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    if (!keepLocal) await signOutLocal();
    await refreshSession();
  };

  const statusText = {
    local: 'Saved on this device only',
    savedOnDevice: `Saved on device — ${pending} change${pending === 1 ? '' : 's'} waiting to sync`,
    syncing: 'Syncing…',
    upToDate: 'Up to date',
    error: 'Sync error',
    unsaved: 'Not saved — this browser is blocking local storage',
  }[syncStatus];

  return (
    <div className="py-2">
      <div className="mb-4 rounded-lg border border-line bg-surface-2 p-3">
        <h3 className="text-[14px] font-semibold">Status</h3>
        <p className="mt-0.5 text-[13.5px] text-muted">{statusText}</p>
        {lastSyncError ? <p className="mt-1 text-[12.5px] text-danger">{lastSyncError}</p> : null}
        {signedIn ? (
          <Button size="sm" onClick={() => void syncNow()} full={false}>Sync now</Button>
        ) : null}
      </div>

      {!syncConfigured ? (
        <div className="rounded-lg border border-line p-3">
          <h3 className="text-[14px] font-semibold">Accounts are not set up on this deployment</h3>
          <p className="mt-1 text-[13.5px] text-muted">
            Everything works offline and stays on this device. To sync across devices, set{' '}
            <code className="rounded bg-surface-2 px-1">DATABASE_URL</code> and{' '}
            <code className="rounded bg-surface-2 px-1">AUTH_SECRET</code> on the deployment, then reload. Your
            existing work can be moved across with Export and Import under Data.
          </p>
        </div>
      ) : signedIn ? (
        <div className="rounded-lg border border-line p-3">
          <h3 className="text-[14px] font-semibold">Signed in</h3>
          <p className="mt-0.5 text-[13.5px] text-muted">{email}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void signOut(true)}>Sign out, keep data here</Button>
            <Button size="sm" variant="danger" onClick={() => void signOut(false)}>Sign out and erase this device</Button>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            Signing out ends this device's session. Export your work first if you have changes still waiting to sync.
          </p>
        </div>
      ) : (
        <form
          className="rounded-lg border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h3 className="text-[14px] font-semibold">{mode === 'signIn' ? 'Sign in' : 'Create an account'}</h3>
          <label className="mt-2 block text-[13px]">
            <span className="mb-1 block text-muted">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
            />
          </label>
          <label className="mt-2 block text-[13px]">
            <span className="mb-1 block text-muted">Password</span>
            <input
              type="password"
              required
              minLength={10}
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
            />
            {mode === 'signUp' ? <span className="mt-1 block text-[12px] text-faint">At least 10 characters.</span> : null}
          </label>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={busy}>
              {mode === 'signIn' ? 'Sign in' : 'Create account'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
              {mode === 'signIn' ? 'Create an account instead' : 'I already have an account'}
            </Button>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            Work already on this device stays here. After signing in it is uploaded to your account.
          </p>
        </form>
      )}
    </div>
  );
}
