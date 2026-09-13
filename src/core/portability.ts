import { emptyDatabase } from './db';
import { newId } from './ids';
import { toPlainText } from './markdown';
import { byRank } from './rank';
import { SCHEMA_VERSION, type Database, type EntityTable } from './types';
import type { EntityPatch } from './patches';

/**
 * Export, import and portability (R35).
 *
 * The package carries user-owned records only. Credentials and cached provider events
 * are never included, so an export is safe to hand to another system.
 */

export const EXPORT_FORMAT = 'clearing.export';

export interface ExportPackage {
  format: typeof EXPORT_FORMAT;
  formatVersion: 1;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
  settings: Omit<Database['settings'], 'ownerId' | 'id'>;
  records: Record<string, unknown[]>;
}

const EXPORTED_TABLES: EntityTable[] = [
  'areas', 'projects', 'headings', 'tasks', 'checklistItems',
  'tags', 'tagAssignments', 'repeatTemplates', 'occurrenceLinks', 'reminders',
];

export function exportDatabase(db: Database, exportedAt = new Date().toISOString()): ExportPackage {
  const records: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of EXPORTED_TABLES) {
    const rows = Object.values(db[table]).map((row) => {
      const { ownerId: _owner, ...rest } = row as Record<string, unknown> & { ownerId: string };
      return rest;
    });
    records[table] = rows;
    counts[table] = rows.length;
  }
  const { ownerId: _o, id: _i, ...settings } = db.settings;
  return {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    counts,
    settings,
    records,
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  counts: Record<string, number>;
}

/** An invalid package is rejected whole; nothing is applied partially (R35). */
export function validatePackage(value: unknown): ValidationResult {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const pkg = value as Partial<ExportPackage> | null;

  if (!pkg || typeof pkg !== 'object') return { ok: false, errors: ['The file is not a JSON object.'], counts };
  if (pkg.format !== EXPORT_FORMAT) errors.push('This file is not a getToDo export package.');
  if (pkg.formatVersion !== 1) errors.push(`Unsupported package version: ${String(pkg.formatVersion)}.`);
  if (typeof pkg.schemaVersion !== 'number' || pkg.schemaVersion > SCHEMA_VERSION) {
    errors.push('The package was written by a newer version of the app.');
  }
  const records = pkg.records;
  if (!records || typeof records !== 'object') {
    errors.push('The package has no records.');
    return { ok: false, errors, counts };
  }

  for (const table of EXPORTED_TABLES) {
    const rows = records[table];
    if (rows === undefined) {
      counts[table] = 0;
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`"${table}" is not a list.`);
      continue;
    }
    counts[table] = rows.length;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') {
        errors.push(`A record in "${table}" has no id.`);
        break;
      }
    }
  }

  // Referential integrity: a task may not claim a heading from a different project.
  const projects = new Set((records.projects ?? []).map((p) => (p as { id: string }).id));
  const headings = new Map(
    (records.headings ?? []).map((h) => [(h as { id: string }).id, (h as { projectId: string }).projectId]),
  );
  for (const task of records.tasks ?? []) {
    const t = task as { id: string; parentType?: string; parentId?: string | null; headingId?: string | null };
    if (t.parentType === 'project' && t.parentId && !projects.has(t.parentId)) {
      errors.push(`Task ${t.id} refers to a missing project.`);
      break;
    }
    if (t.headingId && headings.get(t.headingId) !== t.parentId) {
      errors.push(`Task ${t.id} refers to a heading in another project.`);
      break;
    }
  }

  return { ok: errors.length === 0, errors, counts };
}

export type ImportMode = 'merge' | 'copy';

export interface ImportResult {
  patches: EntityPatch[];
  /** Shown before anything is written, so the effect is previewable. */
  summary: { table: string; added: number; updated: number }[];
  errors: string[];
}

/**
 * `merge` keeps package ids, so re-importing the same package updates the same records
 * and adds no duplicates. `copy` remints every id and rewrites the references between
 * them, which is how a package lands in a second account without colliding.
 */
export function importPackage(
  db: Database, ownerId: string, pkg: ExportPackage, mode: ImportMode,
): ImportResult {
  const validation = validatePackage(pkg);
  if (!validation.ok) return { patches: [], summary: [], errors: validation.errors };

  const idMap = new Map<string, string>();
  const mapId = (id: string): string => {
    if (mode === 'merge') return id;
    let mapped = idMap.get(id);
    if (!mapped) {
      mapped = newId();
      idMap.set(id, mapped);
    }
    return mapped;
  };

  // Pre-map every id so references resolve regardless of table order.
  if (mode === 'copy') {
    for (const table of EXPORTED_TABLES) {
      for (const row of pkg.records[table] ?? []) mapId((row as { id: string }).id);
    }
  }

  const REFERENCES: Record<string, string[]> = {
    projects: ['areaId'],
    headings: ['projectId'],
    tasks: ['parentId', 'headingId'],
    checklistItems: ['taskId'],
    tags: ['parentTagId'],
    tagAssignments: ['tagId', 'targetId'],
    occurrenceLinks: ['templateId', 'materializedId'],
    reminders: ['taskId'],
  };

  const patches: EntityPatch[] = [];
  const summary: { table: string; added: number; updated: number }[] = [];

  for (const table of EXPORTED_TABLES) {
    const rows = pkg.records[table] ?? [];
    let added = 0;
    let updated = 0;
    for (const raw of rows) {
      const row = { ...(raw as Record<string, unknown>) };
      const originalId = row.id as string;
      const id = mapId(originalId);
      row.id = id;
      row.ownerId = ownerId;
      for (const field of REFERENCES[table] ?? []) {
        const value = row[field];
        if (typeof value === 'string' && value.length > 0) row[field] = mapId(value);
      }
      if (table === 'repeatTemplates' && row.snapshot && typeof row.snapshot === 'object') {
        const snapshot = { ...(row.snapshot as Record<string, unknown>) };
        for (const field of ['parentId', 'headingId', 'areaId']) {
          const value = snapshot[field];
          if (typeof value === 'string' && value.length > 0) snapshot[field] = mapId(value);
        }
        if (Array.isArray(snapshot.tagIds)) snapshot.tagIds = (snapshot.tagIds as string[]).map(mapId);
        row.snapshot = snapshot;
      }
      const exists = Boolean((db[table] as Record<string, unknown>)[id]);
      if (exists) updated += 1;
      else added += 1;
      patches.push({ table, id, patch: row, create: !exists });
    }
    summary.push({ table, added, updated });
  }

  return { patches, summary, errors: [] };
}

/** A fresh database seeded from a package; used by the round-trip test and by import-to-new. */
export function databaseFromPackage(ownerId: string, pkg: ExportPackage, now: string): Database {
  const db = emptyDatabase(ownerId, now, pkg.settings.planningTimeZone);
  const result = importPackage(db, ownerId, pkg, 'merge');
  const next: Database = { ...db, settings: { ...db.settings, ...pkg.settings } };
  for (const patch of result.patches) {
    const table = patch.table as EntityTable;
    (next[table] as Record<string, unknown>) = {
      ...(next[table] as Record<string, unknown>),
      [patch.id]: patch.patch,
    };
  }
  return next;
}

/** Human-readable export (R35), so the content is legible without this app. */
export function exportText(db: Database): string {
  const lines: string[] = [];
  const write = (text = '') => lines.push(text);

  const renderTask = (taskId: string, indent: string) => {
    const task = db.tasks[taskId];
    if (!task || task.deletedAt !== null) return;
    const box = task.status === 'completed' ? '[x]' : task.status === 'canceled' ? '[-]' : '[ ]';
    const dates: string[] = [];
    if (task.startDate) dates.push(`start ${task.startDate}${task.eveningDate ? ' (evening)' : ''}`);
    if (task.deadline) dates.push(`due ${task.deadline}`);
    if (task.planning === 'someday') dates.push('someday');
    write(`${indent}${box} ${task.title}${dates.length ? `  — ${dates.join(', ')}` : ''}`);
    if (task.notes.trim()) {
      for (const line of toPlainText(task.notes).split('\n')) write(`${indent}    ${line}`);
    }
    for (const item of Object.values(db.checklistItems)
      .filter((c) => c.taskId === taskId && c.deletedAt === null)
      .sort(byRank)) {
      write(`${indent}    ${item.checked ? '[x]' : '[ ]'} ${item.text}`);
    }
  };

  write('getToDo export');
  write(`Generated ${new Date().toISOString()}`);
  write();

  const inbox = Object.values(db.tasks).filter((t) => t.deletedAt === null && t.parentType === 'inbox' && !t.processed).sort(byRank);
  if (inbox.length > 0) {
    write('## Inbox');
    for (const task of inbox) renderTask(task.id, '');
    write();
  }

  const renderProject = (projectId: string) => {
    const project = db.projects[projectId];
    if (!project || project.deletedAt !== null) return;
    write(`### ${project.title}${project.status !== 'open' ? ` (${project.status})` : ''}`);
    if (project.notes.trim()) write(`    ${toPlainText(project.notes)}`);
    const tasks = Object.values(db.tasks).filter((t) => t.deletedAt === null && t.parentId === projectId).sort(byRank);
    for (const task of tasks.filter((t) => !t.headingId)) renderTask(task.id, '  ');
    for (const heading of Object.values(db.headings).filter((h) => h.projectId === projectId && h.deletedAt === null).sort(byRank)) {
      write(`  — ${heading.title}${heading.archivedAt ? ' (archived)' : ''}`);
      for (const task of tasks.filter((t) => t.headingId === heading.id)) renderTask(task.id, '    ');
    }
    write();
  };

  for (const area of Object.values(db.areas).filter((a) => a.deletedAt === null).sort(byRank)) {
    write(`## ${area.title}`);
    for (const task of Object.values(db.tasks)
      .filter((t) => t.deletedAt === null && t.parentType === 'area' && t.parentId === area.id)
      .sort(byRank)) renderTask(task.id, '  ');
    write();
    for (const project of Object.values(db.projects).filter((p) => p.areaId === area.id && p.deletedAt === null).sort(byRank)) {
      renderProject(project.id);
    }
  }
  for (const project of Object.values(db.projects).filter((p) => p.areaId === null && p.deletedAt === null).sort(byRank)) {
    renderProject(project.id);
  }

  return lines.join('\n');
}
