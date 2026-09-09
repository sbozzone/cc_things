'use client';

import { useEffect, useRef, useState } from 'react';
import type { AddTarget } from '@/core/commands';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { Button, Modal } from './primitives';
import { InboxIcon } from './icons';

const DRAFT_KEY = 'clearing.captureDraft';

/**
 * Quick capture (R01). It defaults to the Inbox, accepts a title on its own, and keeps
 * unsaved text if the capture is interrupted — closing it empty creates nothing.
 */
export function QuickCapture({ target, onClose }: { target?: AddTarget; onClose: () => void }) {
  const destination: AddTarget = target ?? { parentType: 'inbox', parentId: null, headingId: null };
  const db = useApp((s) => s.db);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Restore an interrupted draft, and keep the current one as it is typed.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { title?: string; notes?: string };
        if (draft.title) setTitle(draft.title);
        if (draft.notes) {
          setNotes(draft.notes);
          setShowNotes(true);
        }
      }
    } catch {
      /* session storage is optional */
    }
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      if (title || notes) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, notes }));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* session storage is optional */
    }
  }, [title, notes]);

  const save = () => {
    if (!title.trim()) {
      onClose();
      return;
    }
    actions.addTask(destination, title, { notes: notes.trim() || undefined });
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setTitle('');
    setNotes('');
    onClose();
  };

  const destinationLabel =
    destination.parentType === 'project' && destination.parentId
      ? db.projects[destination.parentId]?.title ?? 'Inbox'
      : destination.parentType === 'area' && destination.parentId
        ? db.areas[destination.parentId]?.title ?? 'Inbox'
        : 'Inbox';

  return (
    <Modal label="Quick capture" onClose={onClose}>
      <div className="p-3">
        <input
          ref={inputRef}
          type="text"
          value={title}
          aria-label="What is on your mind?"
          placeholder="What is on your mind?"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              save();
            }
          }}
          className="h-11 w-full bg-transparent text-[16px] outline-none placeholder:text-faint"
        />
        {showNotes ? (
          <textarea
            value={notes}
            rows={3}
            aria-label="Notes"
            placeholder="Notes"
            onChange={(event) => setNotes(event.target.value)}
            className="mt-1 w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
        ) : null}
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
            <InboxIcon size={14} />{destinationLabel}
          </span>
          {!showNotes ? (
            <Button size="sm" variant="ghost" onClick={() => setShowNotes(true)}>Add notes</Button>
          ) : null}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={save} disabled={!title.trim()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
