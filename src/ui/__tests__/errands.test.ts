import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask } from '@/core/commands';
import { buildIndexes, runView, type ViewKey } from '@/core/selectors';
import { Harness } from '@/core/testing';
import { ListView } from '../ListView';

const mocks = vi.hoisted(() => ({ getState: vi.fn(), phone: false }));
vi.mock('@/state/store', () => ({
  useApp: (selector: (state: ReturnType<typeof mocks.getState>) => unknown) => selector(mocks.getState()),
}));
vi.mock('../useMediaQuery', () => ({ usePhone: () => mocks.phone }));

let h: Harness;
let ordinary: string;
let first: string;
let second: string;
beforeEach(() => {
  h = new Harness('2026-10-06T12:00:00Z');
  const target = { parentType: 'inbox' as const, parentId: null, headingId: null, myDay: true };
  ordinary = h.run(createTask(h.db, h.ctx(), { title: 'Clean pool', target })).id;
  first = h.run(createTask(h.db, h.ctx(), { title: 'Return clamps @ Lowe’s', target })).id;
  second = h.run(createTask(h.db, h.ctx(), { title: 'Buy fertilizer @ Walmart', target })).id;
  h.db.tasks[first]!.errandRank = 'a';
  h.db.tasks[second]!.errandRank = 'b';
  mocks.phone = false;
  mocks.getState.mockImplementation(() => ({
    db: h.db, today: h.today, selection: [], openItemId: null,
    tagFilter: { mode: 'include', tagIds: [], untagged: false },
  }));
});

function render(view: ViewKey) {
  const doc = runView(h.db, buildIndexes(h.db, h.today), view);
  return renderToStaticMarkup(createElement(ListView, { doc }));
}

describe('errands screen and paper integration', () => {
  it('shows the saved route first in My Day and its paper layout', () => {
    const markup = render('today');
    expect(markup.indexOf(`data-id="${first}"`)).toBeLessThan(markup.indexOf(`data-id="${second}"`));
    expect(markup.indexOf(`data-id="${second}"`)).toBeLessThan(markup.indexOf(`data-id="${ordinary}"`));
    const paper = markup.slice(markup.indexOf('<article data-print-my-day'));
    expect(paper).toContain('<h2>Errands</h2>');
    expect(paper.indexOf('Return clamps')).toBeLessThan(paper.indexOf('Buy fertilizer'));
    expect(paper.indexOf('Buy fertilizer')).toBeLessThan(paper.indexOf('Clean pool'));
    expect(markup).not.toContain('Add a task to Other tasks');
  });

  it('keeps route controls available under alphabetical sort on desktop and phone', () => {
    h.db.settings.listSorts = { allTasks: 'alphabetical' };
    for (const phone of [false, true]) {
      mocks.phone = phone;
      const markup = render('allTasks');
      expect(markup.indexOf(`data-id="${first}"`)).toBeLessThan(markup.indexOf(`data-id="${second}"`));
      expect(markup.match(/aria-label="Drag to reorder; use up and down arrow keys to move"/g)).toHaveLength(2);
      expect(markup).toContain('Sort applies to other tasks');
    }
  });

  it('isolates Upcoming drag groups by date and prints the matching route', () => {
    const friday = '2026-10-09';
    for (const id of [ordinary, first, second]) h.db.tasks[id]!.deadline = friday;
    h.db.settings.listSorts = { upcoming: 'alphabetical' };
    const markup = render('upcoming');
    expect(markup).toContain(`data-order-group="day:${friday}:${friday}:errands"`);
    const paper = markup.slice(markup.indexOf('<article'));
    expect(paper.indexOf('Return clamps')).toBeLessThan(paper.indexOf('Buy fertilizer'));
    expect(paper.indexOf('Buy fertilizer')).toBeLessThan(paper.indexOf('Clean pool'));
    expect(paper).toContain('#Errands');
  });

  it('does not show errands as a separate group in a structural Inbox view', () => {
    const markup = render('inbox');
    expect(markup).not.toContain('Errands first');
    expect(markup).not.toContain('data-order-group="errands:');
  });
});
