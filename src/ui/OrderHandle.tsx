'use client';

import { useRef, useState } from 'react';
import * as actions from '@/state/actions';

/** Pointer capture supports touch, pen and mouse without disabling list scrolling. */
export function OrderHandle({ id, ids, group, scope }: { id: string; ids: string[]; group: string; scope: 'structural' | 'today' }) {
  const drag = useRef<{ y: number; target: string; below: boolean; moved: boolean } | null>(null);
  const [hint, setHint] = useState('');
  const finish = (cancel: boolean) => {
    const current = drag.current;
    drag.current = null;
    setHint('');
    if (cancel || !current?.moved || current.target === id) return;
    const next = ids.filter((other) => other !== id);
    const index = next.indexOf(current.target);
    if (index < 0) return;
    next.splice(index + (current.below ? 1 : 0), 0, id);
    actions.orderItems(next, scope);
  };
  return <span className="relative shrink-0">
    <button type="button" aria-label="Drag to reorder; use up and down arrow keys to move" title="Drag to reorder"
      className="flex h-11 w-11 touch-none items-center justify-center rounded-lg text-faint hover:bg-surface-2"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, target: id, below: false, moved: false };
      }}
      onPointerMove={(e) => {
        const current = drag.current;
        if (!current) return;
        current.moved ||= Math.abs(e.clientY - current.y) > 6;
        if (!current.moved) return;
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-order-group]')).filter((row) => row.dataset.orderGroup === group);
        const target = rows.find((row) => { const r = row.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
        if (!target) return;
        const rect = target.getBoundingClientRect();
        current.target = target.dataset.id!;
        current.below = e.clientY > rect.top + rect.height / 2;
        setHint(`${current.below ? 'After' : 'Before'} ${target.dataset.orderTitle || 'item'}`);
        if (e.clientY < 90 || e.clientY > window.innerHeight - 100) target.scrollIntoView({ block: 'center', behavior: 'auto' });
      }}
      onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { finish(true); return; }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const from = ids.indexOf(id), to = from + (e.key === 'ArrowUp' ? -1 : 1);
        if (from < 0 || to < 0 || to >= ids.length) return;
        const next = [...ids];
        next.splice(from, 1); next.splice(to, 0, id);
        actions.orderItems(next, scope);
      }}><span aria-hidden="true">⠿</span></button>
    {hint ? <span role="status" className="pointer-events-none absolute right-0 z-20 w-44 rounded-md border border-line bg-surface p-2 text-xs shadow-lg">{hint}</span> : null}
  </span>;
}
