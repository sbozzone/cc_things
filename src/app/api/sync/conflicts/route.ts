import { NextResponse } from 'next/server';
import { currentSession } from '@/server/auth';
import { query } from '@/server/db';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConflictRow = {
  id: string;
  table_name: string;
  entity_id: string;
  field: string;
  displaced_value: unknown;
  winning_value: unknown;
  detected_at: Date;
  expires_at: Date;
};

/**
 * Displaced values from same-field clashes (R34). They stay readable for 30 days so a
 * person can put one back; restoring is an ordinary client edit, so it syncs and undoes
 * like any other change.
 */
export async function GET() {
  if (!syncConfigured()) return NextResponse.json({ conflicts: [] });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const rows = await query<ConflictRow>(
    `select id, table_name, entity_id, field, displaced_value, winning_value, detected_at, expires_at
       from conflicts
      where owner_id = $1 and expires_at > now()
      order by detected_at desc
      limit 200`,
    [session.ownerId],
  );
  return NextResponse.json({
    conflicts: rows.map((row) => ({
      id: row.id,
      table: row.table_name,
      entityId: row.entity_id,
      field: row.field,
      displacedValue: row.displaced_value,
      winningValue: row.winning_value,
      detectedAt: row.detected_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    })),
  });
}

/** Dismisses one conflict, or every conflict for the account with `?all=1`. */
export async function DELETE(request: Request) {
  if (!syncConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  if (params.get('all') === '1') {
    await query('delete from conflicts where owner_id = $1', [session.ownerId]);
    return NextResponse.json({ ok: true });
  }
  const id = params.get('id');
  if (!id) return NextResponse.json({ error: 'A conflict id is required.' }, { status: 400 });
  await query('delete from conflicts where id = $1 and owner_id = $2', [id, session.ownerId]);
  return NextResponse.json({ ok: true });
}
