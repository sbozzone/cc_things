import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDatabase } from '@/core/db';
import type { Task } from '@/core/types';
import { TaskEditor } from '../TaskEditor';

const mocks = vi.hoisted(() => ({ getState: vi.fn() }));
vi.mock('@/state/store', () => ({
  useApp: (selector: (state: ReturnType<typeof mocks.getState>) => unknown) => selector(mocks.getState()),
}));
vi.mock('@/state/actions', () => ({ directTagsOf: () => [], inheritedTagsOf: () => [] }));

const now = '2026-10-17T16:00:00.000Z';
const task: Task = {
  id: 'task', ownerId: 'owner', createdAt: now, updatedAt: now, deletedAt: null,
  title: 'Spackle', notes: '', status: 'open', processed: false,
  parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime',
  startDate: null, eveningDate: null, deadline: null, rank: 'a', todayRank: 'a',
  completedAt: null, canceledAt: null,
};

beforeEach(() => {
  const db = emptyDatabase('owner', now, 'America/Indianapolis');
  db.tasks[task.id] = task;
  db.checklistItems.row = {
    id: 'row', ownerId: 'owner', createdAt: now, updatedAt: now, deletedAt: null,
    taskId: task.id, text: 'Prime', checked: false, rank: 'a',
  };
  mocks.getState.mockReturnValue({ db, today: '2026-10-17', setView: vi.fn() });
});

describe('checklist reorder affordance', () => {
  it('renders a touch drag handle with keyboard instructions for every row', () => {
    const markup = renderToStaticMarkup(createElement(TaskEditor, { task, onClose: () => undefined }));

    expect(markup).toContain('data-checklist-id="row"');
    expect(markup).toContain('aria-label="Reorder checklist row 1: Prime. Drag or use the up and down arrow keys."');
    expect(markup).toContain('touch-none');
  });
});
