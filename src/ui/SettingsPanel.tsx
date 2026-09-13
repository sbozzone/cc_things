'use client';

import { useRef, useState } from 'react';
import { TRASH_RETENTION_DAYS } from '@/core/commands';
import { databaseFromPackage, exportDatabase, exportText, importPackage, validatePackage, type ExportPackage } from '@/core/portability';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { Button, Modal } from './primitives';
import { AlertIcon, CloudIcon } from './icons';
import { AccountPanel } from './AccountPanel';
import { CalendarPanel } from './CalendarPanel';
import { KeyboardHelp } from './KeyboardHelp';

const TABS = ['General', 'Account & sync', 'Calendar', 'Data', 'Keyboard'] as const;
type Tab = (typeof TABS)[number];

const APPEARANCE_KEY = 'clearing.appearance';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px]">{label}</div>
        {hint ? <div className="text-[12.5px] text-muted">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const selectClass = 'h-9 rounded-md border border-line bg-surface px-2 text-[13.5px]';

function GeneralTab() {
  const settings = useApp((s) => s.db.settings);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [settings.planningTimeZone];

  /** Theme and motion are device preferences, mirrored to localStorage for first paint. */
  const persistAppearance = (patch: { theme?: string; reducedMotion?: boolean }) => {
    const next = { theme: patch.theme ?? settings.theme, reducedMotion: patch.reducedMotion ?? settings.reducedMotion };
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
    } catch {
      /* storage is optional */
    }
    const root = document.documentElement;
    if (next.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = next.theme;
    if (next.reducedMotion) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
  };

  return (
    <div>
      <Row label="Theme" hint="System follows the device setting.">
        <select
          value={settings.theme}
          aria-label="Theme"
          className={selectClass}
          onChange={(event) => {
            const theme = event.target.value as typeof settings.theme;
            actions.updateSettings({ theme });
            persistAppearance({ theme });
          }}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Row>
      <Row label="Reduce motion" hint="Also honoured automatically when the device asks for it.">
        <input
          type="checkbox"
          aria-label="Reduce motion"
          checked={settings.reducedMotion}
          className="h-5 w-5"
          onChange={(event) => {
            actions.updateSettings({ reducedMotion: event.target.checked });
            persistAppearance({ reducedMotion: event.target.checked });
          }}
        />
      </Row>
      <Row label="Today grouping" hint="A flat manual list, or grouped by area and project.">
        <select
          value={settings.todayGrouping}
          aria-label="Today grouping"
          className={selectClass}
          onChange={(event) => actions.updateSettings({ todayGrouping: event.target.value as 'flat' | 'byProject' })}
        >
          <option value="flat">Flat manual list</option>
          <option value="byProject">Grouped by project</option>
        </select>
      </Row>
      <Row
        label="Planning time zone"
        hint="One zone decides what Today means. Changing devices never moves your planning day."
      >
        <select
          value={settings.planningTimeZone}
          aria-label="Planning time zone"
          className={`${selectClass} max-w-[230px]`}
          onChange={(event) => actions.updateSettings({ planningTimeZone: event.target.value })}
        >
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
      </Row>
      <Row label="Locale" hint="Decides how a numeric date such as 03/04 is read.">
        <select
          value={settings.locale}
          aria-label="Locale"
          className={selectClass}
          onChange={(event) => actions.updateSettings({ locale: event.target.value })}
        >
          <option value="en-US">English (United States)</option>
          <option value="en-GB">English (United Kingdom)</option>
          <option value="en-AU">English (Australia)</option>
          <option value="en-CA">English (Canada)</option>
        </select>
      </Row>
      <Row label="Type to search" hint="Only when focus is outside a text field.">
        <input
          type="checkbox"
          aria-label="Type to search"
          checked={settings.typeToSearch}
          className="h-5 w-5"
          onChange={(event) => actions.updateSettings({ typeToSearch: event.target.checked })}
        />
      </Row>
    </div>
  );
}

function DataTab({ onClose }: { onClose: () => void }) {
  const db = useApp((s) => s.db);
  const ownerId = useApp((s) => s.ownerId);
  const dispatch = useApp((s) => s.dispatch);
  const replaceDatabase = useApp((s) => s.replaceDatabase);
  const pushToast = useApp((s) => s.pushToast);
  const setView = useApp((s) => s.setView);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<{ pkg: ExportPackage; counts: Record<string, number> } | null>(null);
  const [mode, setMode] = useState<'merge' | 'copy'>('merge');

  const download = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <Row label="Export a JSON package" hint="Tasks, hierarchy, notes, tags, schedules and history. No credentials, no cached calendar events.">
        <Button size="sm" onClick={() => download(`gettodo-${stamp}.json`, JSON.stringify(exportDatabase(db), null, 2), 'application/json')}>
          Export JSON
        </Button>
      </Row>
      <Row label="Export readable text" hint="A plain outline you can read anywhere.">
        <Button size="sm" onClick={() => download(`gettodo-${stamp}.txt`, exportText(db), 'text/plain')}>Export text</Button>
      </Row>
      <Row label="Import a package" hint="You will see a count preview and choose merge or copy before anything is written.">
        <Button size="sm" onClick={() => fileRef.current?.click()}>Choose file…</Button>
      </Row>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            const parsed = JSON.parse(await file.text()) as unknown;
            const validation = validatePackage(parsed);
            if (!validation.ok) {
              pushToast({ message: `Import rejected: ${validation.errors[0]}`, tone: 'error' });
              return;
            }
            setPreview({ pkg: parsed as ExportPackage, counts: validation.counts });
          } catch {
            pushToast({ message: 'That file is not valid JSON.', tone: 'error' });
          }
        }}
      />

      {preview ? (
        <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
          <h3 className="text-[14px] font-semibold">Ready to import</h3>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-4 text-[13px] text-muted">
            {Object.entries(preview.counts)
              .filter(([, count]) => count > 0)
              .map(([table, count]) => <li key={table}>{table}: {count}</li>)}
          </ul>
          <fieldset className="mt-3">
            <legend className="text-[13px] font-semibold">Mode</legend>
            <label className="mt-1 flex items-start gap-2 text-[13px]">
              <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-1" />
              <span>Merge — keep the package's ids. Importing the same package again adds no duplicates.</span>
            </label>
            <label className="mt-1 flex items-start gap-2 text-[13px]">
              <input type="radio" name="import-mode" checked={mode === 'copy'} onChange={() => setMode('copy')} className="mt-1" />
              <span>Copy — mint new ids, so the content lands alongside what you already have.</span>
            </label>
          </fieldset>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const result = importPackage(db, ownerId, preview.pkg, mode);
                if (result.errors.length > 0) {
                  pushToast({ message: `Import rejected: ${result.errors[0]}`, tone: 'error' });
                  return;
                }
                dispatch(result.patches, { undoLabel: 'import' });
                const added = result.summary.reduce((sum, row) => sum + row.added, 0);
                pushToast({ message: `Imported ${added} new record${added === 1 ? '' : 's'}.`, tone: 'info' });
                setPreview(null);
                onClose();
              }}
            >
              Import
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 border-t border-line pt-3">
        <Row label="Trash" hint={`Deleted items are recoverable for ${TRASH_RETENTION_DAYS} days, then purged.`}>
          <Button size="sm" onClick={() => { setView('trash'); onClose(); }}>Open Trash</Button>
        </Row>
        <Row label="Replace everything with a package" hint="Wipes this device's data, then loads the package. Use it to restore a backup.">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (!preview) {
                pushToast({ message: 'Choose a package file first.', tone: 'warning' });
                return;
              }
              void replaceDatabase(databaseFromPackage(ownerId, preview.pkg, new Date().toISOString()));
              setPreview(null);
              pushToast({ message: 'Replaced local data with the package.', tone: 'info' });
              onClose();
            }}
          >
            Replace
          </Button>
        </Row>
      </div>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('General');
  const conflictCount = useApp((s) => s.conflictCount);

  return (
    <Modal label="Settings" onClose={onClose} wide>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex-1 text-[15px] font-semibold">Settings</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>
      <div
        role="tablist"
        aria-label="Settings sections"
        className="scroll-area flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5"
      >
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`h-8 shrink-0 rounded-md px-3 text-[13.5px] ${
              tab === name ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="scroll-area max-h-[65vh] overflow-y-auto px-4 py-2">
        {conflictCount > 0 ? (
          <p className="my-2 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <AlertIcon size={15} className="mt-0.5 shrink-0" />
            {conflictCount} conflicting edit{conflictCount === 1 ? '' : 's'} were resolved by server order this session. The
            displaced values are retained for 30 days and can be recovered from the sync log.
          </p>
        ) : null}
        {tab === 'General' ? <GeneralTab /> : null}
        {tab === 'Account & sync' ? <AccountPanel /> : null}
        {tab === 'Calendar' ? <CalendarPanel /> : null}
        {tab === 'Data' ? <DataTab onClose={onClose} /> : null}
        {tab === 'Keyboard' ? <KeyboardHelp /> : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[12px] text-muted">
        <CloudIcon size={14} />
        Everything works offline. When an account is connected, changes sync as soon as you are back online.
      </div>
    </Modal>
  );
}
