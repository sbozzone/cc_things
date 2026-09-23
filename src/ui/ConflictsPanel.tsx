'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConflictRecord } from '@/core/types';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { Button } from './primitives';
import { AlertIcon } from './icons';

type Conflict = Omit<ConflictRecord, 'ownerId'>;

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', notes: 'Notes', deadline: 'Deadline', startDate: 'Start date', status: 'Status',
  planning: 'When', text: 'Checklist text', checked: 'Checked', name: 'Name', parentId: 'Location',
  headingId: 'Heading', deletedAt: 'Deleted',
};

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '— empty —';
  if (typeof value === 'string') return value.trim() === '' ? '— empty —' : value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/**
 * The displaced side of every same-field clash the server resolved (R34). Each row
 * can be read, restored as an ordinary edit, or dismissed.
 */
export function ConflictsPanel() {
  const db = useApp((s) => s.db);
  const signedIn = useApp((s) => s.signedIn);
  const pushToast = useApp((s) => s.pushToast);
  const setConflictCount = useApp((s) => s.setConflictCount);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/sync/conflicts', { cache: 'no-store' });
      if (!response.ok) {
        setConflicts([]);
        return;
      }
      const body = (await response.json()) as { conflicts: Conflict[] };
      setConflicts(body.conflicts);
      setConflictCount(body.conflicts.length);
    } catch {
      setConflicts([]);
    }
  }, [setConflictCount]);

  useEffect(() => {
    if (signedIn) void load();
    else setConflicts([]);
  }, [signedIn, load]);

  const dismiss = async (id: string | null) => {
    setBusy(id ?? 'all');
    try {
      await fetch(`/api/sync/conflicts?${id ? `id=${encodeURIComponent(id)}` : 'all=1'}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const restore = async (conflict: Conflict) => {
    const ok = actions.restoreDisplacedValue(conflict.table, conflict.entityId, conflict.field, conflict.displacedValue);
    if (!ok) {
      pushToast({ message: 'That item is no longer on this device, so the value cannot be restored here.', tone: 'warning' });
      return;
    }
    await dismiss(conflict.id);
  };

  const nameOf = (conflict: Conflict): string => {
    const table = db[conflict.table as keyof typeof db] as Record<string, { title?: string; text?: string; name?: string }> | undefined;
    const record = table?.[conflict.entityId];
    const label = record?.title ?? record?.text ?? record?.name;
    const noun = conflict.table === 'checklistItems' ? 'checklist row' : conflict.table.replace(/s$/, '');
    return label ? `${noun} “${label}”` : `a ${noun} not on this device`;
  };

  if (!signedIn) return null;

  return (
    <section aria-labelledby="conflicts-heading" className="mt-4">
      <div className="flex items-center gap-2">
        <h3 id="conflicts-heading" className="text-[14px] font-semibold">Conflicting edits</h3>
        <span className="flex-1" />
        {conflicts && conflicts.length > 1 ? (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void dismiss(null)}>Dismiss all</Button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted">
        When two devices changed the same field, the later arrival won. The other value is kept here for 30 days.
      </p>

      {conflicts === null ? (
        <p className="mt-2 text-[13px] text-faint" role="status">Checking…</p>
      ) : conflicts.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] text-faint">No conflicting edits.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {conflicts.map((conflict) => (
            <li key={conflict.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-start gap-2">
                <AlertIcon size={15} className="mt-0.5 shrink-0 text-[var(--someday)]" />
                <div className="min-w-0 flex-1 text-[13px]">
                  <p>
                    <span className="font-medium">{FIELD_LABELS[conflict.field] ?? conflict.field}</span> on {nameOf(conflict)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-faint">
                    {new Date(conflict.detectedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
              </div>
              <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
                <div className="rounded-md bg-surface-2 px-2.5 py-1.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">Kept</dt>
                  <dd className="mt-0.5 break-words">{describeValue(conflict.winningValue)}</dd>
                </div>
                <div className="rounded-md bg-accent-soft px-2.5 py-1.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-accent">Displaced</dt>
                  <dd className="mt-0.5 break-words">{describeValue(conflict.displacedValue)}</dd>
                </div>
              </dl>
              <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void dismiss(conflict.id)}>Dismiss</Button>
                <Button size="sm" disabled={busy !== null} onClick={() => void restore(conflict)}>Restore displaced value</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
