import { NextResponse } from 'next/server';
import { currentSession } from '@/server/auth';
import { configurationProblem, syncConfigured } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tells the client whether accounts exist on this deployment, and who is signed in. */
export async function GET() {
  if (!syncConfigured()) {
    return NextResponse.json({
      signedIn: false,
      syncConfigured: false,
      ownerId: null,
      email: null,
      problem: configurationProblem(),
    });
  }
  try {
    const session = await currentSession();
    return NextResponse.json({
      signedIn: session !== null,
      syncConfigured: true,
      ownerId: session?.ownerId ?? null,
      email: session?.email ?? null,
    });
  } catch {
    // A database that is configured but unreachable must not break the local app.
    return NextResponse.json({
      signedIn: false,
      syncConfigured: false,
      ownerId: null,
      email: null,
      problem: 'The database is configured but could not be reached.',
    });
  }
}
