import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createArea, createProject, createTask } from '@/core/commands';
import { buildIndexes, runView, type ViewKey } from '@/core/selectors';
import { Harness } from '@/core/testing';
import { ListView } from '../ListView';

const mocks = vi.hoisted(() => ({ getState: vi.fn(), phone: true, selection: [] as string[], mode: 'browse' as 'browse' | 'arrange' }));
// Exercise each local presentation mode without a browser DOM dependency. All
// ordinary hooks still use React; only the list mode's initial value is varied.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const state = actual.useState(initial);
      return initial === 'browse' ? [mocks.mode, state[1]] : state;
    },
  };
});
vi.mock('@/state/store', () => ({
  useApp: (selector: (state: ReturnType<typeof mocks.getState>) => unknown) => selector(mocks.getState()),
  useIndexes: () => buildIndexes(mocks.getState().db, mocks.getState().today),
}));
vi.mock('../useMediaQuery', () => ({ usePhone: () => mocks.phone }));

let h: Harness;
let taskId: string;
let errandId: string;
beforeEach(() => {
  h = new Harness('2026-10-17T12:00:00Z');
  const target = { parentType: 'inbox' as const, parentId: null, headingId: null, myDay: true };
  taskId = h.run(createTask(h.db, h.ctx(), { title: 'Finish the garden', target })).id;
  errandId = h.run(createTask(h.db, h.ctx(), { title: 'Collect supplies @ hardware store', target })).id;
  h.run(createTask(h.db, h.ctx(), { title: 'Return library books @ library', target }));
  mocks.phone = true;
  mocks.selection = [];
  mocks.mode = 'browse';
  mocks.getState.mockImplementation(() => ({
    db: h.db, today: h.today, selection: mocks.selection, openItemId: null,
    tagFilter: { mode: 'include', tagIds: [], untagged: false },
    openItem: vi.fn(), clearSelection: vi.fn(),
  }));
});

function render(view: ViewKey = 'today') {
  const doc = runView(h.db, buildIndexes(h.db, h.today), view, { todayGrouping: h.db.settings.todayGrouping });
  return renderToStaticMarkup(createElement(ListView, { doc }));
}

describe('phone list reading and selection modes', () => {
  it('shows one completion control per task without extra selection circles or handles', () => {
    const markup = render();
    expect(markup.match(/role="checkbox"/g)).toHaveLength(3);
    expect(markup).not.toContain('to selection');
    expect(markup).not.toContain('aria-label="Drag to reorder');
    expect(markup).toContain('data-mobile-mode="browse"');
    expect(markup).toContain('>Select</button>');
  });

  it('keeps tags and View options visible without desktop sort and print clutter', () => {
    const markup = render();
    expect(markup).toContain('class="task-tag-filter');
    expect(markup).toContain('aria-label="View options"');
    expect(markup).not.toContain('aria-label="Sort items"');
    expect(markup).not.toContain('Expand checklists');
    expect(markup).toContain('data-print-my-day');
  });

  it('replaces completion controls with explicit selection targets while selecting', () => {
    mocks.selection = [taskId];
    const markup = render();
    expect(markup).toContain('data-mobile-mode="select"');
    expect(markup).toContain('Remove Finish the garden from selection');
    expect(markup).toContain('Add Collect supplies @ hardware store to selection');
    expect(markup).not.toContain('role="checkbox"');
    expect(markup).toContain('aria-label="1 selected"');
    expect(markup).toContain('aria-label="More selection actions"');
    expect(markup).toContain('>Done</button>');
  });

  it('does not repeat My Day membership in its own list but shows it in other views', () => {
    expect(render()).not.toContain('</svg>My Day</span>');
    expect(render('allTasks')).toContain('</svg>My Day</span>');
  });

  it('preserves the errands route and ordering scope while its handles are hidden', () => {
    h.db.settings.listSorts = { allTasks: 'alphabetical' };
    const markup = render('allTasks');
    expect(markup.indexOf(`data-id="${errandId}"`)).toBeLessThan(markup.indexOf(`data-id="${taskId}"`));
    expect(markup).toContain('data-order-group=');
    expect(markup).toContain(':errands"');
    expect(markup).toContain('Errands first');
  });

  it('leaves desktop sorting, printing, and direct reorder controls available', () => {
    mocks.phone = false;
    const markup = render();
    expect(markup).toContain('aria-label="Sort items"');
    expect(markup).toContain('Expand checklists');
    expect(markup).toContain('aria-label="Drag to reorder; use up and down arrow keys to move"');
    expect(markup).not.toContain('aria-label="View options"');
  });

  it('reveals only errand handles in Arrange mode under automatic sorting', () => {
    mocks.mode = 'arrange';
    h.db.settings.listSorts = { allTasks: 'alphabetical' };
    const markup = render('allTasks');
    expect(markup).toContain('data-mobile-mode="arrange"');
    expect(markup.match(/aria-label="Drag to reorder; use up and down arrow keys to move"/g)).toHaveLength(2);
    expect(markup).toContain('Drag the handles to arrange your errand stops.');
    expect(markup).not.toContain('to selection');
  });

  it('keeps contextual add available in empty Inbox, My Day, project, and area lists', () => {
    h = new Harness('2026-10-17T12:00:00Z');
    const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Garden' })).id;
    for (const view of ['inbox', 'today', `project:${projectId}`, `area:${areaId}`] as ViewKey[]) {
      expect(render(view)).toContain('class="inline-add-task');
    }
    h.db.settings.todayGrouping = 'byProject';
    expect(render('today')).toContain('Add a task</button>');
  });

  it('does not offer contextual task creation in Trash, Logbook, or saved views', () => {
    for (const view of ['trash', 'logbook', 'saved:missing'] as ViewKey[]) {
      expect(render(view)).not.toContain('class="inline-add-task');
    }
  });
});
