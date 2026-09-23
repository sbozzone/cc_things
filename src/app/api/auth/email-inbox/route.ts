import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { currentSession } from '@/server/auth';
import { query, withTransaction } from '@/server/db';
import { emailCaptureDomain, syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InboxRow = {
  address: string;
  enabled: boolean;
  created_at: Date;
};

function present(row: InboxRow | undefined) {
  return row ? { address: row.address, enabled: row.enabled, createdAt: row.created_at.toISOString() } : null;
}

/** A fresh, unguessable local part; the address is the only credential a sender holds. */
function newAddress(domain: string): string {
  return `${randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x')}@${domain}`;
}

/** The account's capture address, if one has been issued (R29). */
export async function GET() {
  if (!syncConfigured()) return NextResponse.json({ configured: false, inbox: null });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const configured = emailCaptureDomain() !== null;
  const rows = await query<InboxRow>(
    'select address, enabled, created_at from email_inboxes where owner_id = $1 order by created_at desc limit 1',
    [session.ownerId],
  );
  return NextResponse.json({ configured, inbox: present(rows[0]) });
}

/** Issues an address, or rotates it: the previous address stops working at once. */
export async function POST() {
  if (!syncConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const domain = emailCaptureDomain();
  if (!domain) return NextResponse.json({ error: 'Email capture is not enabled on this deployment.' }, { status: 501 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const address = newAddress(domain);
  const row = await withTransaction(async (client) => {
    await client.query('delete from email_inboxes where owner_id = $1', [session.ownerId]);
    const inserted = await client.query<InboxRow>(
      'insert into email_inboxes (address, owner_id, enabled) values ($1, $2, true) returning address, enabled, created_at',
      [address, session.ownerId],
    );
    return inserted.rows[0];
  });
  return NextResponse.json({ configured: true, inbox: present(row) });
}

/** Pauses or resumes capture without changing the address. */
export async function PATCH(request: Request) {
  if (!syncConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let body: { enabled?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false.' }, { status: 400 });

  const rows = await query<InboxRow>(
    'update email_inboxes set enabled = $2 where owner_id = $1 returning address, enabled, created_at',
    [session.ownerId, body.enabled],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'No capture address has been issued.' }, { status: 404 });
  return NextResponse.json({ configured: emailCaptureDomain() !== null, inbox: present(rows[0]) });
}

/** Removes the address entirely. */
export async function DELETE() {
  if (!syncConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  await query('delete from email_inboxes where owner_id = $1', [session.ownerId]);
  return NextResponse.json({ ok: true });
}
