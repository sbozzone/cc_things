import type { Database, Tag, Task } from './types';

/** A computed tag: never stored, manually assigned, synced, or exported. */
export const ERRANDS_TAG_ID = 'smart:errands';

/** @ at a word boundary is an errand marker; the @ inside an email is not. */
export function isErrandTitle(title: string): boolean {
  return /(?:^|[\s([{])@/u.test(title);
}

export function isErrandTask(task: Pick<Task, 'title'>): boolean {
  return isErrandTitle(task.title);
}

/** Same interface as ordinary tags so filters and labels can include smart tags. */
export function getErrandsTag(db: Database): Tag {
  return {
    id: ERRANDS_TAG_ID,
    ownerId: db.settings.ownerId,
    name: 'Errands',
    color: 'blue',
    parentTagId: null,
    rank: '',
    createdAt: db.settings.createdAt,
    updatedAt: db.settings.updatedAt,
    deletedAt: null,
  };
}
