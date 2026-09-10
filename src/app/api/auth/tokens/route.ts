import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { currentSession, newToken } from '@/server/auth';
import { hashToken } from '@/server/automation';
import { query } from '@/server/db';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Scoped, revocable automation credentials (R30). The token itself is shown once. */
export async function GET() {
  if (!syncConfigured()) return NextResponse.json({ tokens: [] });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const tokens = await query<{ id: string; name: string; created_at: Date; last_used: Date | null }>(
    'select id, name, created_at, last_used from automation_tokens where owner_id = $1 and revoked_at is null order by created_at desc',
    [session.ownerId],
  );
  return NextResponse.json({ tokens });
}

export async function POST(request: Request) {
  if (!syncConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    body = {};
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Automation token';
  const token = newToken(32);
  const id = randomUUID();
  await query('insert into automation_tokens (id, owner_id, name, token_hash) values ($1, $2, $3, $4)', [
    id, session.ownerId, name, hashToken(token),
  ]);
  // Returned once and never stored in plain text.
  return NextResponse.json({ id, name, token });
}

export async function DELETE(request: Request) {
  if (!syncConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'A token id is required.' }, { status: 400 });
  await query('update automation_tokens set revoked_at = now() where id = $1 and owner_id = $2', [id, session.ownerId]);
  return NextResponse.json({ ok: true });
}
