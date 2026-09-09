import { describe, expect, it } from 'vitest';
import { Harness } from '../testing';
import { createArea, createHeading, createProject, createTask, createTag, assignTag, setDeadline, setWhen } from '../commands';
import { applyPatches } from '../patches';
import { databaseFromPackage, exportDatabase, exportText, importPackage, validatePackage } from '../portability';
import { emptyDatabase } from '../db';

function seeded(): Harness {
  const h = new Harness();
  const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
  const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Cabinets', areaId, notes: 'Measure **twice**' })).id;
  const headingId = h.run(createHeading(h.db, h.ctx(), projectId, 'Prep')).id;
  const tagId = h.run(createTag(h.db, h.ctx(), 'errand')).id;
  const { id: taskId } = h.run(createTask(h.db, h.ctx(), {
    title: 'Order drawer slides',
    notes: 'Line one\nLine two — ünïcode ✓ https://example.com',
    target: { parentType: 'project', parentId: projectId, headingId },
    checklist: ['Measure', 'Compare prices'],
  }));
  h.apply(assignTag(h.db, h.ctx(), tagId, 'task', taskId));
  h.apply(setWhen(h.db, h.ctx(), taskId, { planning: 'scheduled', startDate: '2026-09-10' }));
  h.apply(setDeadline(h.db, h.ctx(), taskId, '2026-09-15'));
  return h;
}

describe('export and import (R35, scenario A11)', () => {
  it('round-trips into a fresh account with equivalent content', () => {
    const source = seeded();
    const pkg = exportDatabase(source.db);

    const target = databaseFromPackage('owner-2', pkg, '2026-09-08T12:00:00Z');
    const reExported = exportDatabase(target);

    expect(reExported.counts).toEqual(pkg.counts);
    const original = (pkg.records.tasks ?? [])[0] as Record<string, unknown>;
    const copied = (reExported.records.tasks ?? [])[0] as Record<string, unknown>;
    expect(copied.title).toBe(original.title);
    expect(copied.notes).toBe(original.notes);
    expect(copied.startDate).toBe('2026-09-10');
    expect(copied.deadline).toBe('2026-09-15');
    // Every record is re-owned by the importing account.
    expect(Object.values(target.tasks).every((t) => t.ownerId === 'owner-2')).toBe(true);
  });

  it('adds no duplicates when the same merge import is repeated', () => {
    const source = seeded();
    const pkg = exportDatabase(source.db);
    let db = emptyDatabase('owner-2', '2026-09-08T12:00:00Z');

    for (let round = 0; round < 3; round++) {
      const result = importPackage(db, 'owner-2', pkg, 'merge');
      expect(result.errors).toEqual([]);
      db = applyPatches(db, result.patches);
    }
    expect(Object.keys(db.tasks)).toHaveLength(Object.keys(source.db.tasks).length);
    expect(Object.keys(db.checklistItems)).toHaveLength(Object.keys(source.db.checklistItems).length);
  });

  it('remints ids in copy mode and keeps relationships intact', () => {
    const source = seeded();
    const pkg = exportDatabase(source.db);
    const result = importPackage(source.db, source.ownerId, pkg, 'copy');
    const db = applyPatches(source.db, result.patches);

    expect(Object.keys(db.tasks)).toHaveLength(2);
    const copies = Object.values(db.tasks).filter((t) => !source.db.tasks[t.id]);
    const copy = copies[0]!;
    const copiedProject = db.projects[copy.parentId as string];
    expect(copiedProject).toBeDefined();
    expect(copiedProject?.id).not.toBe(Object.values(source.db.projects)[0]?.id);
    expect(db.headings[copy.headingId as string]?.projectId).toBe(copy.parentId);
  });

  it('rejects an invalid package without changing anything', () => {
    const db = emptyDatabase('owner-2', '2026-09-08T12:00:00Z');
    expect(validatePackage({ format: 'something-else' }).ok).toBe(false);
    expect(validatePackage(null).ok).toBe(false);

    const broken = exportDatabase(seeded().db);
    (broken.records.tasks as Record<string, unknown>[])[0]!.parentId = 'missing-project';
    const result = importPackage(db, 'owner-2', broken, 'merge');
    expect(result.patches).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(applyPatches(db, result.patches)).toBe(db);
  });

  it('never exports credentials or cached provider events', () => {
    const pkg = exportDatabase(seeded().db);
    expect(Object.keys(pkg.records)).not.toContain('calendarEvents');
    expect(Object.keys(pkg.records)).not.toContain('calendarSubscriptions');
    expect(JSON.stringify(pkg)).not.toContain('ownerId');
  });

  it('writes a readable text export', () => {
    const text = exportText(seeded().db);
    expect(text).toContain('## Home');
    expect(text).toContain('### Cabinets');
    expect(text).toContain('Prep');
    expect(text).toContain('[ ] Order drawer slides');
    expect(text).toContain('[ ] Measure');
  });
});
