/** Resolve an insertion gap using row midpoints, without targeting the dragged row. */
export function checklistDropTarget(
  rows: { id: string; top: number; height: number }[], sourceId: string, y: number,
): { targetId: string; side: 'before' | 'after' } | null {
  const others = rows.filter((row) => row.id !== sourceId);
  const next = others.find((row) => y < row.top + row.height / 2);
  if (next) return { targetId: next.id, side: 'before' };
  const last = others[others.length - 1];
  return last ? { targetId: last.id, side: 'after' } : null;
}
