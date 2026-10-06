import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDatabase } from '@/core/db';
import type { Task } from '@/core/types';
import { AutoTextarea } from '../primitives';
import { QuickCapture } from '../QuickCapture';
import { TaskEditor } from '../TaskEditor';

const mocks = vi.hoisted(() => ({ getState: vi.fn() }));
vi.mock('@/state/store', () => ({
  useApp: (selector: (state: ReturnType<typeof mocks.getState>) => unknown) => selector(mocks.getState()),
}));
vi.mock('@/state/actions', () => ({ directTagsOf: () => [], inheritedTagsOf: () => [] }));

const now = '2026-10-06T12:00:00.000Z';
const task: Task = {
  id: 'task', ownerId: 'owner', createdAt: now, updatedAt: now, deletedAt: null,
  title: 'Check spelling', notes: '', status: 'open', processed: false,
  parentType: 'inbox', parentId: null, headingId: null, planning: 'anytime',
  startDate: null, eveningDate: null, deadline: null, rank: 'a', todayRank: 'a',
  completedAt: null, canceledAt: null,
};

beforeEach(() => {
  const db = emptyDatabase('owner', now, 'America/Indianapolis');
  db.tasks[task.id] = task;
  db.checklistItems.row = {
    id: 'row', ownerId: 'owner', createdAt: now, updatedAt: now, deletedAt: null,
    taskId: task.id, text: 'Review checklist', checked: false, rank: 'a',
  };
  mocks.getState.mockReturnValue({ db, today: '2026-10-06', setView: vi.fn() });
});

function expectSpellcheck(markup: string, label: string) {
  const field = markup.match(/<(?:input|textarea)\b[^>]*>/g)
    ?.find((element) => element.includes(`aria-label="${label}"`));
  expect(field, `${label} must be rendered with native spell checking enabled`).toMatch(/spellcheck="true"/i);
}

describe('native spell checking for task text', () => {
  it.each(['Task title', 'Notes'])('enables the shared %s text area', (ariaLabel) => {
    const markup = renderToStaticMarkup(createElement(AutoTextarea, {
      value: 'Text to review', ariaLabel, onChange: () => undefined,
    }));
    expectSpellcheck(markup, ariaLabel);
  });

  it('enables the quick-capture task title', () => {
    const markup = renderToStaticMarkup(createElement(QuickCapture, { onClose: () => undefined }));
    expectSpellcheck(markup, 'What is on your mind?');
  });

  it('enables edited task titles and both existing and new checklist entries', () => {
    const markup = renderToStaticMarkup(createElement(TaskEditor, { task, onClose: () => undefined }));
    expectSpellcheck(markup, 'Task title');
    expectSpellcheck(markup, 'Checklist row 1');
    expectSpellcheck(markup, 'Add a checklist row');
  });
});
