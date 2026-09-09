import { NextResponse } from 'next/server';

/**
 * Server-side fetch for a read-only calendar feed (R20).
 *
 * The browser cannot fetch a provider feed directly because of CORS, so this route
 * proxies it. It only relays the text; parsing happens on the client, and nothing here
 * is written to any account's data.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 4 * 1024 * 1024;

const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']);

/** Rejects anything that is not a public https feed, so this cannot be used to probe internals. */
function validateUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.replace(/^webcal:/i, 'https:'));
  } catch {
    return { error: 'That is not a valid URL.' };
  }
  if (url.protocol !== 'https:') return { error: 'Calendar feeds must use https.' };
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return { error: 'That address is not reachable.' };
  if (/^(10|127)\./.test(host)) return { error: 'That address is not reachable.' };
  if (/^192\.168\./.test(host)) return { error: 'That address is not reachable.' };
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { error: 'That address is not reachable.' };
  if (/^169\.254\./.test(host)) return { error: 'That address is not reachable.' };
  if (host.endsWith('.local') || host.endsWith('.internal')) return { error: 'That address is not reachable.' };
  return { url };
}

export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (typeof body.url !== 'string') {
    return NextResponse.json({ error: 'A feed url is required.' }, { status: 400 });
  }

  const checked = validateUrl(body.url);
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  let response: Response;
  try {
    response = await fetch(checked.url, {
      redirect: 'follow',
      headers: { accept: 'text/calendar, text/plain;q=0.8' },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return NextResponse.json({ error: 'The calendar provider did not respond.' }, { status: 502 });
  }
  if (!response.ok) {
    return NextResponse.json(
      { error: `The provider returned ${response.status}. Check that the feed is still shared.` },
      { status: 502 },
    );
  }

  const text = await response.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: 'That feed is too large to cache.' }, { status: 413 });
  }
  if (!text.includes('BEGIN:VCALENDAR')) {
    return NextResponse.json({ error: 'That URL did not return an iCalendar feed.' }, { status: 422 });
  }

  return NextResponse.json({ text, fetchedAt: new Date().toISOString() });
}
