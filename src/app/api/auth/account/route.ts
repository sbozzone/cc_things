import { NextResponse } from 'next/server';
import { clearSessionCookie, currentSession, verifyPassword } from '@/server/auth';
import { query, withTransaction } from '@/server/db';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Account deletion (R35). The password is required again so a left-open session cannot
 * erase an account. Every row the account owns is removed in one transaction; the
 * account row itself goes last so the email can be registered again.
 */
export async function DELETE(request: Request) {
  if (!syncConfigured()) return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const password = typeof body.password === 'string' ? body.password : '';

  const rows = await query<{ password_hash: string }>(
    'select password_hash from accounts where id = $1 and deleted_at is null',
    [session.ownerId],
  );
  const account = rows[0];
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return NextResponse.json({ error: 'That password is not correct.' }, { status: 403 });
  }

  await withTransaction(async (client) => {
    const owner = [session.ownerId];
    await client.query('delete from entities where owner_id = $1', owner);
    await client.query('delete from applied_ops where owner_id = $1', owner);
    await client.query('delete from conflicts where owner_id = $1', owner);
    await client.query('delete from idempotency_keys where owner_id = $1', owner);
    await client.query('delete from email_ingested where owner_id = $1', owner);
    // sessions, automation_tokens and email_inboxes cascade from the account row.
    await client.query('delete from accounts where id = $1', owner);
  });

  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
