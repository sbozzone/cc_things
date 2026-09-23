'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/state/store';
import { Button, IconButton } from './primitives';
import { CopyIcon, TrashIcon } from './icons';

interface TokenRow {
  id: string;
  name: string;
  created_at: string;
  last_used: string | null;
}

interface Inbox {
  address: string;
  enabled: boolean;
  createdAt: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Scoped automation tokens (R30). The token is shown once, then only its name remains. */
function TokensSection() {
  const pushToast = useApp((s) => s.pushToast);
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/tokens', { cache: 'no-store' });
      const body = (await response.json()) as { tokens?: TokenRow[] };
      setTokens(body.tokens ?? []);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json()) as { name?: string; token?: string; error?: string };
      if (!response.ok || !body.token) {
        pushToast({ message: body.error ?? 'Could not create a token.', tone: 'error' });
        return;
      }
      setFresh({ name: body.name ?? name, token: body.token });
      setName('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/auth/tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  };

  return (
    <Section
      title="Automation tokens"
      hint="Bearer credentials for the HTTP API and Shortcuts. Each one can be revoked on its own."
    >
      {fresh ? (
        <div className="mb-2 rounded-lg border border-accent bg-accent-soft p-3 text-[13px]">
          <p className="font-medium text-accent">Copy “{fresh.name}” now — it will not be shown again.</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-2 py-1.5 font-mono text-[12px]">{fresh.token}</code>
            <IconButton
              label="Copy token"
              onClick={async () => {
                pushToast({ message: (await copyText(fresh.token)) ? 'Token copied.' : 'Copy failed — select the text instead.', tone: 'info' });
              }}
            >
              <CopyIcon size={15} />
            </IconButton>
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>I have saved it</Button>
          </div>
        </div>
      ) : null}

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <input
          type="text"
          value={name}
          maxLength={80}
          aria-label="Token name"
          placeholder="Name, e.g. Shortcuts on iPhone"
          onChange={(event) => setName(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[14px] outline-none focus:border-accent"
        />
        <Button size="md" variant="primary" type="submit" disabled={busy}>Create token</Button>
      </form>

      {tokens === null ? (
        <p className="mt-2 text-[13px] text-faint" role="status">Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] text-faint">No tokens yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-line">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{token.name}</p>
                <p className="text-[12px] text-faint">
                  Created {new Date(token.created_at).toLocaleDateString()}
                  {token.last_used ? ` · last used ${new Date(token.last_used).toLocaleDateString()}` : ' · never used'}
                </p>
              </div>
              <IconButton label={`Revoke ${token.name}`} tone="danger" onClick={() => void revoke(token.id)}>
                <TrashIcon size={15} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The per-account capture address (R29): issue, pause, rotate or remove. */
function EmailSection() {
  const pushToast = useApp((s) => s.pushToast);
  const [state, setState] = useState<{ configured: boolean; inbox: Inbox | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/email-inbox', { cache: 'no-store' });
      if (!response.ok) {
        setState({ configured: false, inbox: null });
        return;
      }
      setState((await response.json()) as { configured: boolean; inbox: Inbox | null });
    } catch {
      setState({ configured: false, inbox: null });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/email-inbox', {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const error = ((await response.json()) as { error?: string }).error;
        pushToast({ message: error ?? 'The request failed.', tone: 'error' });
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const inbox = state?.inbox ?? null;

  return (
    <Section
      title="Email capture"
      hint="Forward a message to your private address and its subject becomes a task in Inbox, with the body as notes."
    >
      {state === null ? (
        <p className="text-[13px] text-faint" role="status">Loading…</p>
      ) : !state.configured && !inbox ? (
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-muted">
          Not enabled on this deployment. Set <code className="rounded bg-surface px-1">INBOUND_EMAIL_SECRET</code> and{' '}
          <code className="rounded bg-surface px-1">INBOUND_EMAIL_DOMAIN</code>, then point that domain’s inbound mail at{' '}
          <code className="rounded bg-surface px-1">/api/inbound-email</code>.
        </p>
      ) : inbox ? (
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[12.5px]">{inbox.address}</code>
            <IconButton
              label="Copy address"
              onClick={async () => {
                pushToast({ message: (await copyText(inbox.address)) ? 'Address copied.' : 'Copy failed — select the text instead.', tone: 'info' });
              }}
            >
              <CopyIcon size={15} />
            </IconButton>
          </div>
          <p className={`mt-1.5 text-[12.5px] ${inbox.enabled ? 'text-muted' : 'text-[var(--someday)]'}`}>
            {inbox.enabled ? 'Capturing. Anyone who knows this address can add tasks, so treat it like a password.' : 'Paused — messages to this address are ignored.'}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button size="sm" disabled={busy} onClick={() => void call('PATCH', { enabled: !inbox.enabled })}>
              {inbox.enabled ? 'Pause' : 'Resume'}
            </Button>
            {state.configured ? (
              <Button size="sm" disabled={busy} onClick={() => void call('POST')}>Rotate address</Button>
            ) : null}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void call('DELETE')}>Remove</Button>
          </div>
        </div>
      ) : (
        <Button size="md" variant="primary" disabled={busy} onClick={() => void call('POST')}>Issue a capture address</Button>
      )}
    </Section>
  );
}

/** Everything that lets other software talk to the account: tokens and the mail address. */
export function AutomationPanel() {
  const syncConfigured = useApp((s) => s.syncConfigured);
  const signedIn = useApp((s) => s.signedIn);

  if (!syncConfigured || !signedIn) {
    return (
      <div className="py-2">
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13.5px] text-muted">
          {syncConfigured
            ? 'Sign in under Account & sync to create automation tokens or an email capture address.'
            : 'Automation needs an account. This deployment has no database configured, so it stays local-only.'}
        </div>
      </div>
    );
  }

  return (
    <div className="py-2">
      <TokensSection />
      <EmailSection />
      <p className="mt-4 text-[12.5px] text-faint">
        Endpoints: <code>GET/POST /api/v1/tasks</code>, <code>GET/PATCH /api/v1/tasks/:id</code>, <code>POST /api/v1/projects</code>. Send{' '}
        <code>Authorization: Bearer &lt;token&gt;</code> and, on writes, an <code>Idempotency-Key</code> header.
      </p>
    </div>
  );
}
