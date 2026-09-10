import { NextResponse } from 'next/server';
import { currentSession } from '@/server/auth';
import { syncConfigured } from '@/server/env';
import { applySync, validateOps } from '@/server/sync';
import { query } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!syncConfigured()) {
    return NextResponse.json({ error: 'Sync is not configured on this deployment.' }, { status: 501 });
  }

  const session = await currentSession();
  // Owner authorization on every read and write; ids are never taken from the body (R32).
  if (!session) return NextResponse.json({ error: 'Sign in to sync.' }, { status: 401 });

  let body: { deviceId?: unknown; cursor?: unknown; ops?: unknown };
  try {
    body = (await request.json()) as { deviceId?: unknown; cursor?: unknown; ops?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 128) : 'unknown';
  const cursor = typeof body.cursor === 'number' && Number.isFinite(body.cursor) ? Math.max(0, body.cursor) : 0;
  const validated = validateOps(body.ops ?? []);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });

  try {
    const result = await applySync(session.ownerId, deviceId, cursor, validated.ops);
    await query('update sessions set last_seen = now(), device_id = $2 where id = $1', [session.sessionId, deviceId]);
    return NextResponse.json(result);
  } catch (error) {
    // Never leak the database error text to the client.
    console.error('sync failed', error);
    return NextResponse.json({ error: 'Sync could not complete. Your changes are still saved on this device.' }, { status: 503 });
  }
}
