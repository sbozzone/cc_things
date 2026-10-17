import { describe, expect, it } from 'vitest';
import { appendChecklist, createTask, reorderChecklistItem } from '../commands';
import { byRank } from '../rank';
import { Harness } from '../testing';

function rows(h: Harness, taskId: string) {
  return Object.values(h.db.checklistItems)
    .filter((item) => item.taskId === taskId && item.deletedAt === null)
    .sort(byRank);
}

describe('checklist ordering', () => {
  it('moves a row between persisted neighbours', () => {
    const h = new Harness();
    const taskId = h.run(createTask(h.db, h.ctx(), {
      title: 'Paint the room',
      target: { parentType: 'inbox', parentId: null, headingId: null },
    })).id;
    h.apply(appendChecklist(h.db, h.ctx(), taskId, ['Prep', 'Prime', 'Paint']));

    const initial = rows(h, taskId);
    h.apply(reorderChecklistItem(h.db, h.ctx(), initial[2]!.id, {
      beforeId: initial[0]!.id,
      afterId: initial[1]!.id,
    }));

    expect(rows(h, taskId).map((item) => item.text)).toEqual(['Prep', 'Paint', 'Prime']);
  });

  it('moves a row to the beginning or end', () => {
    const h = new Harness();
    const taskId = h.run(createTask(h.db, h.ctx(), {
      title: 'Paint the room',
      target: { parentType: 'inbox', parentId: null, headingId: null },
    })).id;
    h.apply(appendChecklist(h.db, h.ctx(), taskId, ['Prep', 'Prime', 'Paint']));

    let ordered = rows(h, taskId);
    h.apply(reorderChecklistItem(h.db, h.ctx(), ordered[2]!.id, {
      beforeId: null,
      afterId: ordered[0]!.id,
    }));
    expect(rows(h, taskId).map((item) => item.text)).toEqual(['Paint', 'Prep', 'Prime']);

    ordered = rows(h, taskId);
    h.apply(reorderChecklistItem(h.db, h.ctx(), ordered[0]!.id, {
      beforeId: ordered[2]!.id,
      afterId: null,
    }));
    expect(rows(h, taskId).map((item) => item.text)).toEqual(['Prep', 'Prime', 'Paint']);
  });
});
