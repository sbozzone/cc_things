'use client';

import { useMemo, useRef, useState } from 'react';
import { byRank } from '@/core/rank';
import { tagPath } from '@/core/tags';
import type { Database } from '@/core/types';
import type { AddTarget } from '@/core/commands';
import { Popover } from './primitives';
import { FolderIcon, InboxIcon, LayersIcon, TagIcon } from './icons';

/**
 * The searchable destination picker (R24). Every area, project and heading is reachable
 * by typing, so moving work never requires a drag.
 */
export function MovePicker({
  anchor, onClose, db, onPick, title = 'Move to',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  db: Database;
  onPick: (target: AddTarget) => void;
  title?: string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const options = useMemo(() => {
    const out: { key: string; label: string; detail: string | null; icon: 'inbox' | 'area' | 'project' | 'heading'; target: AddTarget }[] = [
      { key: 'inbox', label: 'Inbox', detail: null, icon: 'inbox', target: { parentType: 'inbox', parentId: null, headingId: null } },
    ];
    const areas = Object.values(db.areas).filter((a) => a.deletedAt === null).sort(byRank);
    const projectsOf = (areaId: string | null) =>
      Object.values(db.projects)
        .filter((p) => p.deletedAt === null && p.status === 'open' && (p.areaId ?? null) === areaId)
        .sort(byRank);
    const headingsOf = (projectId: string) =>
      Object.values(db.headings)
        .filter((h) => h.projectId === projectId && h.deletedAt === null && h.archivedAt === null)
        .sort(byRank);

    const pushProject = (project: { id: string; title: string }, areaTitle: string | null) => {
      out.push({
        key: `project:${project.id}`, label: project.title, detail: areaTitle, icon: 'project',
        target: { parentType: 'project', parentId: project.id, headingId: null },
      });
      for (const heading of headingsOf(project.id)) {
        out.push({
          key: `heading:${heading.id}`, label: heading.title, detail: `${project.title}`, icon: 'heading',
          target: { parentType: 'project', parentId: project.id, headingId: heading.id },
        });
      }
    };

    for (const area of areas) {
      out.push({
        key: `area:${area.id}`, label: area.title, detail: null, icon: 'area',
        target: { parentType: 'area', parentId: area.id, headingId: null },
      });
      for (const project of projectsOf(area.id)) pushProject(project, area.title);
    }
    for (const project of projectsOf(null)) pushProject(project, null);

    const needle = query.trim().toLowerCase();
    if (!needle) return out;
    return out.filter((o) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(needle));
  }, [db, query]);

  const icons = {
    inbox: <InboxIcon size={15} />,
    area: <LayersIcon size={15} />,
    project: <FolderIcon size={15} />,
    heading: <span aria-hidden="true" className="pl-1 text-[13px]">—</span>,
  } as const;

  const clamped = Math.min(active, Math.max(0, options.length - 1));

  return (
    <Popover anchor={anchor} onClose={onClose} label={title} width={330}>
      <div className="px-1 pb-1">
        <input
          type="text"
          // A phone sheet intentionally opens without raising the keyboard; all choices
          // are visible immediately, while tapping here still enables search.
          autoFocus={typeof window !== 'undefined' && window.innerWidth >= 620}
          value={query}
          aria-label={`${title} — search destinations`}
          placeholder="Search areas, projects, headings…"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const option = options[clamped];
              if (option) {
                onPick(option.target);
                onClose();
              }
            }
          }}
          className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
        />
      </div>
      <ul role="listbox" aria-label={title} className="space-y-0.5">
        {options.length === 0 ? (
          <li className="px-2 py-3 text-[13px] text-muted">No destination matches.</li>
        ) : null}
        {options.map((option, index) => (
          <li key={option.key}>
            <button
              type="button"
              role="option"
              aria-selected={index === clamped}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                onPick(option.target);
                onClose();
              }}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[14px] ${
                index === clamped ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'
              } ${option.icon === 'heading' ? 'pl-6' : ''}`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">{icons[option.icon]}</span>
              <span className="flex-1 truncate">{option.label}</span>
              {option.detail ? <span className="shrink-0 text-[12px] text-faint">{option.detail}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

/**
 * Tag assignment (R22). Direct assignments are toggled here; inherited tags are shown
 * separately with the entity they came from, and cannot be removed on the child.
 */
export function TagPicker({
  anchor, onClose, db, directTagIds, inherited, onToggle, onCreate,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  db: Database;
  directTagIds: string[];
  inherited: { tagId: string; from: string }[];
  onToggle: (tagId: string, next: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tags = Object.values(db.tags).filter((t) => t.deletedAt === null).sort(byRank);
  const needle = query.trim().toLowerCase();
  const filtered = needle ? tags.filter((t) => t.name.toLowerCase().includes(needle)) : tags;
  const exact = tags.some((t) => t.name.toLowerCase() === needle);

  return (
    <Popover anchor={anchor} onClose={onClose} label="Tags" width={280}>
      <div className="px-1 pb-1">
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={query}
          aria-label="Search or create a tag"
          placeholder="Search or create a tag…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && needle && !exact) {
              event.preventDefault();
              onCreate(query.trim());
              setQuery('');
            }
          }}
          className="h-10 w-full rounded-md border border-line px-2.5 text-[14px] outline-none focus:border-accent"
        />
      </div>
      <ul className="space-y-0.5">
        {needle && !exact ? (
          <li>
            <button
              type="button"
              onClick={() => {
                onCreate(query.trim());
                setQuery('');
                inputRef.current?.focus();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[14px] text-accent hover:bg-accent-soft"
            >
              <TagIcon size={15} /> Create “{query.trim()}”
            </button>
          </li>
        ) : null}
        {filtered.map((tag) => {
          const isDirect = directTagIds.includes(tag.id);
          const inheritedFrom = inherited.find((i) => i.tagId === tag.id);
          return (
            <li key={tag.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isDirect}
                disabled={Boolean(inheritedFrom) && !isDirect}
                onClick={() => onToggle(tag.id, !isDirect)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[14px] hover:bg-surface-2 disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] ${
                    isDirect ? 'border-accent bg-accent text-accent-contrast' : 'border-control'
                  }`}
                >
                  {isDirect ? '✓' : ''}
                </span>
                <span className="flex-1 truncate">{tagPath(db, tag.id)}</span>
                {inheritedFrom && !isDirect ? (
                  <span className="shrink-0 text-[11px] text-faint">from {inheritedFrom.from}</span>
                ) : null}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && !needle ? (
          <li className="px-2 py-3 text-[13px] text-muted">No tags yet. Type a name to create one.</li>
        ) : null}
      </ul>
    </Popover>
  );
}
