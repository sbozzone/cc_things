'use client';

import { useApp } from '@/state/store';
import { IconButton } from './primitives';
import { CloseIcon } from './icons';

/** Transient confirmations, including the Undo affordance for accepted transactions. */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-2 px-3"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pop-in pointer-events-auto flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-[13.5px] shadow-[var(--shadow-pop)] ${
            toast.tone === 'error'
              ? 'border-transparent bg-danger-soft text-danger'
              : toast.tone === 'warning'
                ? 'border-line bg-surface text-ink'
                : 'border-line bg-surface text-ink'
          }`}
        >
          <span>{toast.message}</span>
          {toast.action && toast.actionLabel ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.();
                dismiss(toast.id);
              }}
              className="rounded px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft"
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <IconButton label="Dismiss" onClick={() => dismiss(toast.id)}><CloseIcon size={13} /></IconButton>
        </div>
      ))}
    </div>
  );
}
