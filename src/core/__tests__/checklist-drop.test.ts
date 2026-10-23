import { describe, expect, it } from 'vitest';
import { checklistDropTarget } from '../checklist-drop';

const rows = [
  { id: 'a', top: 100, height: 52 },
  { id: 'b', top: 152, height: 120 },
  { id: 'c', top: 272, height: 52 },
];
describe('checklist insertion target', () => {
  it('moves past a wrapped row only after its midpoint', () => {
    expect(checklistDropTarget(rows, 'a', 205)).toEqual({ targetId: 'b', side: 'before' });
    expect(checklistDropTarget(rows, 'a', 220)).toEqual({ targetId: 'c', side: 'before' });
  });
  it('never targets itself and supports both list boundaries', () => {
    expect(checklistDropTarget(rows, 'b', 90)).toEqual({ targetId: 'a', side: 'before' });
    expect(checklistDropTarget(rows, 'b', 350)).toEqual({ targetId: 'c', side: 'after' });
    expect(checklistDropTarget([rows[0]!], 'a', 200)).toBeNull();
  });
});
