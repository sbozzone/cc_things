import type { EntityPatch } from '@/core/patches';
import type { ConflictRecord, SyncOperation } from '@/core/types';

/**
 * Client half of the sync protocol (R34). Operations are incremental and idempotent:
 * the server keys on `opId`, so replaying a queue after a reconnect never duplicates an
 * item, a completion, or a recurring occurrence.
 */

export interface SyncRequest {
  deviceId: string;
  cursor: number;
  ops: SyncOperation[];
}

export interface SyncResponse {
  cursor: number;
  /** Op ids the server durably accepted; the client clears these from its queue. */
  applied: string[];
  changes: EntityPatch[];
  conflicts: ConflictRecord[];
  serverTime: string;
}

export class SyncUnavailableError extends Error {}
export class SyncAuthError extends Error {}

export async function pushAndPull(request: SyncRequest, signal?: AbortSignal): Promise<SyncResponse> {
  let response: Response;
  try {
    response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    throw new SyncUnavailableError(error instanceof Error ? error.message : 'network error');
  }
  if (response.status === 401 || response.status === 403) throw new SyncAuthError('Sign in again to sync.');
  if (response.status === 501 || response.status === 503) throw new SyncUnavailableError('Sync is not configured.');
  if (!response.ok) throw new Error(`Sync failed with status ${response.status}`);
  return (await response.json()) as SyncResponse;
}

export interface SessionInfo {
  signedIn: boolean;
  /** False when the deployment has no database configured; the app stays local-only. */
  syncConfigured: boolean;
  ownerId: string | null;
  email: string | null;
}

export async function fetchSession(): Promise<SessionInfo> {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) return { signedIn: false, syncConfigured: false, ownerId: null, email: null };
    return (await response.json()) as SessionInfo;
  } catch {
    return { signedIn: false, syncConfigured: false, ownerId: null, email: null };
  }
}
