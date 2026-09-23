'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { search, type SearchResult } from '@/core/search';
import { useApp } from '@/state/store';
import { Modal } from './primitives';
import { BookIcon, FolderIcon, LayersIcon, NoteIcon, SearchIcon, TagIcon } from './icons';

const KIND_ICONS = {
  task: <NoteIcon size={15} />,
  project: <FolderIcon size={15} />,
  heading: <span aria-hidden="true">—</span>,
  area: <LayersIcon size={15} />,
  tag: <TagIcon size={15} />,
  view: <BookIcon size={15} />,
} as const;

/**
 * Incremental search (R23). The quick pass matches titles and names; "Search All"
 * widens the same query to notes, checklist rows and the Logbook. Trash stays out
 * unless it is explicitly included.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const db = useApp((s) => s.db);
  const setView = useApp((s) => s.setView);
  const openItem = useApp((s) => s.openItem);
  const [query, setQuery] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const [includeTrash, setIncludeTrash] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const results = useMemo(
    () => search(db, query, { searchAll, includeTrash }),
    [db, query, searchAll, includeTrash],
  );
  const clamped = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => setActive(0), [query, searchAll, includeTrash]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [clamped]);

  const choose = (result: SearchResult) => {
    setView(result.target.view);
    if (result.target.openId && db.tasks[result.target.openId]) openItem(result.target.openId);
    onClose();
  };

  return (
    <Modal label="Search" onClose={onClose} wide>
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <SearchIcon size={18} className="text-faint" />
        <input
          type="text"
          autoFocus
          value={query}
          aria-label="Search"
          aria-controls="search-results"
          placeholder="Search tasks, projects, areas, tags and lists…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const result = results[clamped];
              if (result) choose(result);
            }
          }}
          className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-[12.5px]">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={searchAll} onChange={(event) => setSearchAll(event.target.checked)} className="h-4 w-4" />
          Search All — notes, checklists and the Logbook
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={includeTrash} onChange={(event) => setIncludeTrash(event.target.checked)} className="h-4 w-4" />
          Include Trash
        </label>
        <span className="ml-auto text-faint" aria-live="polite">
          {query.trim() ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <ul id="search-results" ref={listRef} role="listbox" aria-label="Search results" className="scroll-area max-h-[55vh] overflow-y-auto p-1.5">
        {query.trim() === '' ? (
          <li className="px-2 py-6 text-center text-[13px] text-muted">
            Type to search. Tomorrow, Deadlines, Repeating, All Projects and Logged Projects are reachable by name.
          </li>
        ) : results.length === 0 ? (
          <li className="px-2 py-6 text-center text-[13px] text-muted">
            No match{searchAll ? '' : ' — try Search All for notes and checklists'}.
          </li>
        ) : null}
        {results.map((result, index) => (
          <li key={`${result.kind}:${result.id}`}>
            <button
              type="button"
              role="option"
              aria-selected={index === clamped}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(result)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left ${
                index === clamped ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">{KIND_ICONS[result.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{result.title}</span>
              {result.logged ? <span className="shrink-0 text-[11px] text-faint">Logged</span> : null}
              {result.detail ? <span className="shrink-0 truncate text-[12px] text-faint">{result.detail}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
