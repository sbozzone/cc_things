'use client';

import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react';
import { CloseIcon } from './icons';

/** Traps focus inside an overlay and restores it on close, so keyboard flow never escapes. */
function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // A child may already have placed focus (the task editor focuses its title); the
    // trap must not pull it back to the first control, which is the completion box.
    const preferred = node?.querySelector<HTMLElement>('[data-autofocus]');
    if (preferred) preferred.focus();
    else if (!node?.contains(document.activeElement)) (focusable()[0] ?? node)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const firstItem = items[0] as HTMLElement;
      const lastItem = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    node?.addEventListener('keydown', onKeyDown);
    return () => {
      node?.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [active]);
  return ref;
}

export interface PopoverProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
  /** Preferred width in pixels; the popover still shrinks to fit narrow screens. */
  width?: number;
}

/**
 * An anchored popover on wide screens that becomes a bottom sheet on a phone, which is
 * how the requirement asks optional fields to be revealed (§2, task row and editor).
 */
export function Popover({ anchor, onClose, label, children, width = 300 }: PopoverProps) {
  const ref = useFocusTrap(true, onClose);
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const [isSheet, setIsSheet] = useState(false);
  const [sheetStyle, setSheetStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    const place = () => {
      const sheet = window.innerWidth < 620;
      setIsSheet(sheet);
      if (sheet || !anchor) {
        // On iOS, fixed bottom sheets otherwise sit behind the software keyboard.
        // visualViewport tells us exactly how much of the layout viewport is obscured.
        const viewport = window.visualViewport;
        const visibleHeight = viewport?.height ?? window.innerHeight;
        const keyboardInset = Math.max(0, window.innerHeight - visibleHeight - (viewport?.offsetTop ?? 0));
        setSheetStyle({ bottom: keyboardInset, maxHeight: Math.max(240, visibleHeight - 12) });
        setStyle({});
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 24);
      const height = ref.current?.offsetHeight ?? 320;
      let left = Math.min(Math.max(12, rect.left), window.innerWidth - w - 12);
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 6);
      if (Number.isNaN(left)) left = 12;
      setStyle({ position: 'fixed', top, left, width: w, opacity: 1 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, width, ref]);

  useEffect(() => {
    if (!isSheet) return;
    // A task title is commonly still focused when its action bar is tapped. Hiding the
    // keyboard lets the destination list be visible immediately; search remains optional.
    const active = document.activeElement as HTMLElement | null;
    if (active?.matches('input, textarea')) active.blur();
  }, [isSheet]);

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={
          isSheet
            ? 'sheet-in fixed inset-x-0 z-50 overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-2 shadow-[var(--shadow-pop)] scroll-area'
            : 'pop-in z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-surface p-2 shadow-[var(--shadow-pop)] scroll-area'
        }
        style={isSheet ? sheetStyle : style}
      >
        {isSheet ? (
          <>
            <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-9 rounded-full bg-line-strong opacity-70" />
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold text-muted">{label}</span>
              <IconButton label="Close" onClick={onClose}><CloseIcon /></IconButton>
            </div>
          </>
        ) : null}
        {children}
      </div>
    </>
  );
}

export function Modal({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useFocusTrap(true, onClose);
  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:p-8">
      <div className="fixed inset-0" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`pop-in relative z-10 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]`}
      >
        {children}
      </div>
    </div>
  );
}

export function IconButton({
  label, onClick, children, active, disabled, tone = 'default', className = '', keepFocus,
}: {
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  className?: string;
  /**
   * For a toolbar sitting beside a focused field: pressing the button must not blur
   * that field first, or the collapse shifts the layout and the click lands elsewhere.
   * Keyboard focus is unaffected.
   */
  keepFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`press inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 transition-colors disabled:opacity-40 ${
        active ? 'bg-accent-soft text-accent' : tone === 'danger' ? 'text-danger hover:bg-danger-soft' : 'text-muted hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Button({
  children, onClick, variant = 'secondary', type = 'button', disabled, full, size = 'md', keepFocus,
}: {
  children: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  full?: boolean;
  size?: 'sm' | 'md';
  /** See IconButton: keeps an adjacent field focused so the click is not lost. */
  keepFocus?: boolean;
}) {
  const base =
    'press inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 disabled:opacity-45 disabled:pointer-events-none';
  const sizes = size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3.5 text-[14px]';
  const variants = {
    primary: 'bg-accent-fill text-accent-fill-contrast shadow-[var(--shadow-sm),inset_0_1px_0_rgb(255_255_255_/_18%)] hover:brightness-[1.04] active:brightness-[0.97]',
    secondary: 'border border-line bg-surface shadow-[var(--shadow-card)] hover:border-line-strong hover:bg-surface-2',
    ghost: 'text-muted hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-ink',
    danger: 'border border-line text-danger hover:border-[color-mix(in_srgb,var(--danger)_40%,transparent)] hover:bg-danger-soft',
  } as const;
  return (
    <button
      type={type}
      onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes} ${variants[variant]} ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * The completion control. A plain click completes; the menu offers Cancel and Delete so
 * that no state transition requires a gesture (§2, design acceptance).
 */
export function StatusControl({
  status, onComplete, onCancel, onReopen, label, tone = 'default',
}: {
  status: 'open' | 'completed' | 'canceled';
  onComplete: () => void;
  onCancel: () => void;
  onReopen: () => void;
  label: string;
  tone?: 'default' | 'project';
}) {
  const isOpen = status === 'open';
  const describe = status === 'completed' ? 'Completed' : status === 'canceled' ? 'Canceled' : 'Open';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={status === 'completed' ? true : status === 'canceled' ? 'mixed' : false}
      aria-label={`${label} — ${describe}. ${isOpen ? 'Complete' : 'Reopen'}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!isOpen) onReopen();
        else if (event.altKey) onCancel();
        else onComplete();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isOpen) onCancel();
      }}
      className="group/check mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center"
    >
      <span
        data-status={status}
        className="check-box flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-[1.5px] group-hover/check:border-accent"
        style={{
          borderColor: status === 'open' ? 'var(--control-border)' : 'transparent',
          background: status === 'completed' ? 'var(--accent-fill)' : status === 'canceled' ? 'var(--control-border)' : 'transparent',
          borderRadius: tone === 'project' ? '50%' : undefined,
        }}
      >
        {status === 'completed' ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-fill-contrast)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m4 12.5 5.2 5.2L20 6.6" />
          </svg>
        ) : status === 'canceled' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--surface)" strokeWidth="3.6" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

/** Circular progress with the percentage available to assistive technology (R09). */
export function ProgressRing({ percent, size = 16 }: { percent: number | null; size?: number }) {
  const radius = (size - 3) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = percent ?? 0;
  return (
    <span
      role="img"
      aria-label={percent === null ? 'No tasks yet' : `${percent} percent complete`}
      className="inline-flex shrink-0"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-strong)" strokeWidth="1.8" />
        {percent !== null && percent > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
    </span>
  );
}

/** A text field that grows with its content, used for titles and notes. */
export function AutoTextarea({
  value, onChange, placeholder, ariaLabel, onKeyDown, autoFocus, className = '', rows = 1, onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Also marks the field as the preferred initial focus for an enclosing dialog. */
  autoFocus?: boolean;
  className?: string;
  rows?: number;
  onBlur?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, []);
  useLayoutEffect(resize, [value, resize]);
  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      data-autofocus={autoFocus ? '' : undefined}
      onBlur={onBlur}
      onChange={(event) => {
        onChange(event.target.value);
        resize();
      }}
      onKeyDown={onKeyDown}
      className={`w-full resize-none bg-transparent outline-none placeholder:text-faint ${className}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <span id={id} className="block">{children}</span>
      {hint ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

export function Chip({
  children, onClick, tone = 'default', label, removable, onRemove,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
  label?: string;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const tones = {
    default: 'border-line bg-surface text-muted',
    accent: 'border-transparent bg-accent-soft text-accent',
    warning: 'border-transparent bg-[var(--danger-soft)] text-[var(--upcoming)]',
    danger: 'border-transparent bg-danger-soft text-danger',
  } as const;
  const content = (
    <span className={`inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[12px] leading-none ${tones[tone]}`}>
      {children}
      {removable ? (
        <button type="button" aria-label={`Remove ${label ?? 'item'}`} onClick={onRemove} className="ml-0.5 opacity-70 hover:opacity-100">
          <CloseIcon size={11} />
        </button>
      ) : null}
    </span>
  );
  if (!onClick) return content;
  return (
    <button type="button" onClick={onClick} aria-label={label} className="rounded-full focus-visible:outline-2">
      {content}
    </button>
  );
}
