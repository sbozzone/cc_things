'use client';

import { useState } from 'react';
import { DEFAULT_DUPLICATE, type DuplicateOptions } from '@/core/duplicate';
import { Button, Modal } from './primitives';

/**
 * The choices R10 asks to be presented before a copy is made: whether to keep dates and
 * whether to reset completion.
 */
export function DuplicateDialog({
  kind, title, onClose, onConfirm,
}: {
  kind: 'task' | 'heading' | 'project';
  title: string;
  onClose: () => void;
  onConfirm: (options: DuplicateOptions) => void;
}) {
  const [options, setOptions] = useState<DuplicateOptions>(DEFAULT_DUPLICATE);

  return (
    <Modal label={`Duplicate ${kind}`} onClose={onClose}>
      <div className="p-4">
        <h2 className="text-[16px] font-semibold">Duplicate “{title}”</h2>
        <p className="mt-1 text-[13.5px] text-muted">
          The copy gets new ids and sits directly after the original, which is left untouched.
        </p>

        <label className="mt-3 flex items-start gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={options.keepDates}
            onChange={(event) => setOptions({ ...options, keepDates: event.target.checked })}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Keep dates
            <span className="block text-[12.5px] text-muted">
              Start dates, evening designations and deadlines come across. Clear them to file the copy under Anytime.
            </span>
          </span>
        </label>

        <label className="mt-2 flex items-start gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={options.resetCompletion}
            onChange={(event) => setOptions({ ...options, resetCompletion: event.target.checked })}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Reset completion
            <span className="block text-[12.5px] text-muted">
              The copy starts open, with checklist rows unchecked.
            </span>
          </span>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => { onConfirm(options); onClose(); }}>Duplicate</Button>
        </div>
      </div>
    </Modal>
  );
}
