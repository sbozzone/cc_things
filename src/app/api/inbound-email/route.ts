import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildFromMessage, MAX_MESSAGES_PER_DAY } from '@/server/email';
import { buildTask, writeEntities } from '@/server/automation';
import { query } from '@/server/db';
import { syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook for an inbound mail provider (R29).
 *
 * Guarded by a shared secret, addressed to an opt-in per-account address that can be
 * rotated or disabled, rate limited, and deduplicated by message id.
 */
export async function POST(request: Request) {
  if (!syncConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });

  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: 'Email capture is not enabled on this deployment.' }, { status: 501 });
  }
  const provided = request.headers.get('x-inbound-secret') ?? '';
  const a = Buffer.from(provided.padEnd(expected.length).slice(0, expected.length));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : null;
  const messageId = typeof body.messageId === 'string' ? body.messageId.slice(0, 400) : null;
  if (!to || !messageId) return NextResponse.json({ error: 'to and messageId are required.' }, { status: 400 });

  const inbox = (await query<{ owner_id: string; enabled: boolean }>(
    'select owner_id, enabled from email_inboxes where address = $1',
    [to],
  ))[0];
  // A rotated or disabled address stops capturing, quietly and immediately.
  if (!inbox || !inbox.enabled) return NextResponse.json({ ok: true, ignored: 'unknown address' });

  const claimed = await query<{ message_id: string }>(
    'insert into email_ingested (message_id, owner_id) values ($1, $2) on conflict do nothing returning message_id',
    [messageId, inbox.owner_id],
  );
  // Retrying the same message id produces one task, not two.
  if (claimed.length === 0) return NextResponse.json({ ok: true, deduplicated: true });

  const recent = await query<{ count: string }>(
    "select count(*)::text as count from email_ingested where owner_id = $1 and created_at > now() - interval '24 hours'",
    [inbox.owner_id],
  );
  if (Number(recent[0]?.count ?? 0) > MAX_MESSAGES_PER_DAY) {
    return NextResponse.json({ error: 'Daily capture limit reached.' }, { status: 429 });
  }

  const message = buildFromMessage(
    typeof body.subject === 'string' ? body.subject : null,
    typeof body.text === 'string' ? body.text : null,
    typeof body.html === 'string' ? body.html : null,
    Array.isArray(body.attachments) ? body.attachments.length : 0,
    new Date(),
  );

  const now = new Date().toISOString();
  const { writes, id } = buildTask(inbox.owner_id, { title: message.title, notes: message.notes }, now);
  await writeEntities(inbox.owner_id, writes, 'email');

  return NextResponse.json({ ok: true, taskId: id, truncated: message.truncated });
}
