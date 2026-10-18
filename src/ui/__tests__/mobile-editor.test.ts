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
  title: 'Review the task before editing', notes: '', status: 'open', processed: false,
  parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime',
  startDate: null, eveningDate: null, deadline: null, rank: 'a', todayRank: 'a',
  completedAt: null, canceledAt: null,
};

beforeEach(() => {
  const db = emptyDatabase('owner', now, 'America/Indianapolis');
  db.tasks[task.id] = task;
  db.checklistItems.row = {
    id: 'row', ownerId: 'owner', createdAt: now, updatedAt: now, deletedAt: null,
    taskId: task.id, text: 'Get tools and materials before preparing the wall', checked: false, rank: 'a',
  };
  mocks.getState.mockReturnValue({ db, today: '2026-10-17', setView: vi.fn() });
});

describe('mobile task inspection', () => {
  it('opens with a Done control as the focus destination instead of focusing a text field', () => {
    const markup = renderToStaticMarkup(createElement(TaskEditor, { task, embedded: true, onClose: () => undefined }));
    const title = markup.match(/<textarea\b[^>]*aria-label="Task title"[^>]*>/)?.[0];
    const done = markup.match(/<button\b[^>]*aria-label="Close editor"[^>]*>Done<\/button>/)?.[0];

    expect(title).toBeDefined();
    expect(title).not.toMatch(/autofocus/i);
    expect(done).toContain('data-autofocus');
    expect(markup.match(/aria-label="Close editor"/g)).toHaveLength(1);
  });

  it('keeps immediate title editing for the inline desktop editor', () => {
    const markup = renderToStaticMarkup(createElement(TaskEditor, { task, onClose: () => undefined }));
    const title = markup.match(/<textarea\b[^>]*aria-label="Task title"[^>]*>/)?.[0];

    expect(title).toMatch(/autofocus/i);
    expect(markup).not.toContain('>Done</button>');
  });

  it('lets phone checklist text wrap while keeping desktop rows as inputs', () => {
    const phone = renderToStaticMarkup(createElement(TaskEditor, { task, embedded: true, onClose: () => undefined }));
    const desktop = renderToStaticMarkup(createElement(TaskEditor, { task, onClose: () => undefined }));

    expect(phone).toMatch(/<textarea\b[^>]*spellcheck="true"[^>]*aria-label="Checklist row 1"/i);
    expect(phone).toContain('Get tools and materials before preparing the wall</textarea>');
    expect(desktop).toMatch(/<input\b[^>]*aria-label="Checklist row 1"/);
  });
});
