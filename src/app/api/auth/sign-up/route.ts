import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { hashPassword, normalizeEmail, setSessionCookie, validatePassword } from '@/server/auth';
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
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (!password) return NextResponse.json({ error: 'Use a password of at least 10 characters.' }, { status: 400 });

  const existing = await query<{ id: string }>('select id from accounts where email = $1', [email]);
  if (existing.length > 0) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
  }

  const ownerId = randomUUID();
  await query('insert into accounts (id, email, password_hash) values ($1, $2, $3)', [
    ownerId, email, await hashPassword(password),
  ]);

  const sessionId = randomUUID();
  await query('insert into sessions (id, owner_id, user_agent) values ($1, $2, $3)', [
    sessionId, ownerId, request.headers.get('user-agent')?.slice(0, 200) ?? null,
  ]);
  await setSessionCookie(sessionId);

  return NextResponse.json({ ownerId, email });
}
