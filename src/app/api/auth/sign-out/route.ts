import { NextResponse } from 'next/server';
import { clearSessionCookie, currentSession } from '@/server/auth';
import { query } from '@/server/db';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoking the session ends its remote access immediately, not just on this device (R32). */
export async function POST() {
  if (syncConfigured()) {
    try {
      const session = await currentSession();
      if (session) {
        await query('update sessions set revoked_at = now() where id = $1', [session.sessionId]);
      }
    } catch {
      /* clearing the cookie still matters even if the database is unreachable */
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
