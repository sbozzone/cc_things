import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { normalizeEmail, setSessionCookie, validatePassword, verifyPassword } from '@/server/auth';
import { query } from '@/server/db';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!syncConfigured()) {
    return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  }
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  if (!email || !password) {
    return NextResponse.json({ error: 'That email and password do not match.' }, { status: 401 });
  }

  const rows = await query<{ id: string; password_hash: string }>(
    'select id, password_hash from accounts where email = $1 and deleted_at is null',
    [email],
  );
  const account = rows[0];
  // The same message either way, so this cannot be used to enumerate accounts.
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return NextResponse.json({ error: 'That email and password do not match.' }, { status: 401 });
  }

  const sessionId = randomUUID();
  await query('insert into sessions (id, owner_id, user_agent) values ($1, $2, $3)', [
    sessionId, account.id, request.headers.get('user-agent')?.slice(0, 200) ?? null,
  ]);
  await setSessionCookie(sessionId);

  return NextResponse.json({ ownerId: account.id, email });
}
