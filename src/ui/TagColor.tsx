'use client';

import * as actions from '@/state/actions';
import type { Tag } from '@/core/types';

export const tagColors = { red: '#dc2626', orange: '#ea580c', yellow: '#ca8a04', green: '#16a34a', blue: '#2563eb', purple: '#9333ea', pink: '#db2777' };
export function TagDot({ color }: { color?: string | null }) {
  if (!color || !(color in tagColors)) return null;
  return <span aria-label={`${color} tag`} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tagColors[color as keyof typeof tagColors] }} />;
}
export function TagColorSelect({ tag }: { tag: Tag }) {
  return <select aria-label={`Color for ${tag.name}`} value={tag.color ?? ''}
    onClick={(e) => e.stopPropagation()}
    onChange={(e) => actions.setTagColor(tag.id, e.target.value || null)}
    className="min-h-11 max-w-24 rounded-md border border-line bg-surface px-1 text-[13px]">
    <option value="">No color</option>
    {Object.keys(tagColors).map((color) => <option key={color} value={color}>{color[0]!.toUpperCase() + color.slice(1)}</option>)}
  </select>;
}
