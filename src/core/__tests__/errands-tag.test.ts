import { describe, expect, it } from 'vitest';
import { assignTag, createArea, createProject, createTag, createTask, updateTask } from '../commands';
import { ERRANDS_TAG_ID, getErrandsTag, isErrandTask, isErrandTitle } from '../errands';
import { exportDatabase } from '../portability';
import { createTemplate, materialize, updateTemplate } from '../recurrence';
import { search } from '../search';
import { buildIndexes, runView } from '../selectors';
import { buildTagIndex, effectiveTaskTags, getSelectableTags, getTag, matchesTagFilter, tagPath } from '../tags';
import { Harness } from '../testing';
import type { RepeatSnapshot } from '../types';

const target = { parentType: 'inbox', parentId: null, headingId: null } as const;

describe('automatic Errands tag', () => {
  it.each(['@', '@ Walmart', '@Walmart return', 'Goodwill @', 'Return clamps (@ Lowes)', 'Buy food\n@ store'])('recognizes a title marker: %s', (title) => {
    expect(isErrandTitle(title)).toBe(true);
    expect(isErrandTask({ title })).toBe(true);
  });

  it.each(['', 'Clean workshop', 'Email person@example.com', 'Email first.last+work@example.com', 'https://example.com/@user'])('does not classify ordinary titles or email addresses: %s', (title) => {
    expect(isErrandTitle(title)).toBe(false);
  });

  it('follows existing titles and edits without persisting tag or assignment records', () => {
    const h = new Harness();
    const taskId = h.run(createTask(h.db, h.ctx(), { title: 'Donate @ Goodwill', target })).id;
    const index = buildTagIndex(h.db);
    const first = effectiveTaskTags(h.db, index, taskId);
    expect(first.all.has(ERRANDS_TAG_ID)).toBe(true);
    expect(first.direct.size).toBe(0);
    expect(first.inherited.size).toBe(0);
    expect(Object.keys(h.db.tags)).toEqual([]);
    expect(Object.keys(h.db.tagAssignments)).toEqual([]);

    h.apply(updateTask(h.db, h.ctx(), taskId, { title: 'Donate later' }));
    expect(effectiveTaskTags(h.db, index, taskId).all.has(ERRANDS_TAG_ID)).toBe(false);
    h.apply(updateTask(h.db, h.ctx(), taskId, { title: '@ Donate later' }));
    expect(effectiveTaskTags(h.db, index, taskId).all.has(ERRANDS_TAG_ID)).toBe(true);
    expect(exportDatabase(h.db).records.tags).toEqual([]);
    expect(exportDatabase(h.db).records.tagAssignments).toEqual([]);
  });

  it('combines Errands with direct and inherited manual tags without making it inherited', () => {
    const h = new Harness();
    const areaId = h.run(createArea(h.db, h.ctx(), 'Home')).id;
    const projectId = h.run(createProject(h.db, h.ctx(), { title: 'Repairs', areaId })).id;
    const directId = h.run(createTag(h.db, h.ctx(), 'Important')).id;
    const inheritedId = h.run(createTag(h.db, h.ctx(), 'Home jobs')).id;
    const taskId = h.run(createTask(h.db, h.ctx(), { title: '@ Hardware store', target: { parentType: 'project', parentId: projectId, headingId: null } })).id;
    h.apply(assignTag(h.db, h.ctx(), directId, 'task', taskId));
    h.apply(assignTag(h.db, h.ctx(), inheritedId, 'area', areaId));
    const effective = effectiveTaskTags(h.db, buildTagIndex(h.db), taskId);
    expect(effective.direct).toEqual(new Set([directId]));
    expect([...effective.inherited.keys()]).toEqual([inheritedId]);
    expect(effective.all).toEqual(new Set([directId, inheritedId, ERRANDS_TAG_ID]));
  });

  it('supports include OR, exclude, and untagged filters consistently', () => {
    const h = new Harness();
    const errand = h.run(createTask(h.db, h.ctx(), { title: '@ Academy', target })).id;
    const ordinary = h.run(createTask(h.db, h.ctx(), { title: 'Clean pool', target })).id;
    const manualTag = h.run(createTag(h.db, h.ctx(), 'Home')).id;
    const manuallyTagged = h.run(createTask(h.db, h.ctx(), { title: 'Garden beds', target })).id;
    h.apply(assignTag(h.db, h.ctx(), manualTag, 'task', manuallyTagged));
    const ix = buildIndexes(h.db, h.today);
    const errandTags = effectiveTaskTags(h.db, ix.tagIndex, errand).all;
    const ordinaryTags = effectiveTaskTags(h.db, ix.tagIndex, ordinary).all;
    expect(matchesTagFilter(errandTags, ix.tagIndex, { mode: 'include', tagIds: [ERRANDS_TAG_ID], untagged: false })).toBe(true);
    expect(matchesTagFilter(ordinaryTags, ix.tagIndex, { mode: 'include', tagIds: [ERRANDS_TAG_ID], untagged: false })).toBe(false);
    expect(matchesTagFilter(errandTags, ix.tagIndex, { mode: 'exclude', tagIds: [ERRANDS_TAG_ID], untagged: false })).toBe(false);
    expect(matchesTagFilter(ordinaryTags, ix.tagIndex, { mode: 'exclude', tagIds: [ERRANDS_TAG_ID], untagged: false })).toBe(true);
    expect(matchesTagFilter(errandTags, ix.tagIndex, { mode: 'include', tagIds: [], untagged: true })).toBe(false);
    expect(matchesTagFilter(ordinaryTags, ix.tagIndex, { mode: 'include', tagIds: [], untagged: true })).toBe(true);
    expect(matchesTagFilter(ordinaryTags, ix.tagIndex, { mode: 'include', tagIds: [ERRANDS_TAG_ID], untagged: true })).toBe(true);
    expect(matchesTagFilter(effectiveTaskTags(h.db, ix.tagIndex, manuallyTagged).all, ix.tagIndex, { mode: 'include', tagIds: [ERRANDS_TAG_ID, manualTag], untagged: false })).toBe(true);
    expect(matchesTagFilter(errandTags, ix.tagIndex, { mode: 'include', tagIds: [ERRANDS_TAG_ID, manualTag], untagged: false })).toBe(true);

    const tagView = runView(h.db, ix, `tag:${ERRANDS_TAG_ID}`);
    expect(tagView.title).toBe('Errands');
    expect(tagView.sections.flatMap((section) => section.items.map((item) => item.id))).toEqual([errand]);
  });

  it('exposes the virtual label to filters and search while leaving manual Errands tags untouched', () => {
    const h = new Harness();
    const manualId = h.run(createTag(h.db, h.ctx(), 'Errands')).id;
    expect(getTag(h.db, ERRANDS_TAG_ID)).toEqual(getErrandsTag(h.db));
    expect(tagPath(h.db, ERRANDS_TAG_ID)).toBe('Errands');
    expect(getSelectableTags(h.db).map((tag) => tag.id)).toEqual([ERRANDS_TAG_ID, manualId]);
    expect(search(h.db, 'Errands').filter((result) => result.kind === 'tag').map((result) => result.id)).toEqual([ERRANDS_TAG_ID, manualId]);
    expect(h.db.tags[manualId]?.name).toBe('Errands');
    expect(h.db.tags[ERRANDS_TAG_ID]).toBeUndefined();
  });

  it('strips automatic tag ids from stored recurrence snapshots while retaining manual Errands tags', () => {
    const h = new Harness();
    const manualId = h.run(createTag(h.db, h.ctx(), 'Errands')).id;
    const snapshot: RepeatSnapshot = {
      title: '@ Walmart', notes: '', parentType: 'inbox', parentId: null,
      headingId: null, areaId: null, tagIds: [ERRANDS_TAG_ID, manualId], checklist: [],
    };
    const templateId = h.run(createTemplate(h.ctx(), {
      entityKind: 'task', snapshot, rule: { type: 'everyNDays', interval: 1 }, anchorDate: h.today,
    })).id;
    expect(h.db.repeatTemplates[templateId]?.snapshot.tagIds).toEqual([manualId]);
    expect(snapshot.tagIds).toEqual([ERRANDS_TAG_ID, manualId]); // caller input is untouched
    const firstId = h.run(materialize(h.db, h.ctx(), h.db.repeatTemplates[templateId]!, h.today)).materializedId!;
    const first = effectiveTaskTags(h.db, buildTagIndex(h.db), firstId);
    expect(first.direct).toEqual(new Set([manualId]));
    expect(first.all).toEqual(new Set([manualId, ERRANDS_TAG_ID]));

    h.apply(updateTemplate(h.db, h.ctx(), templateId, { snapshot: { ...snapshot, title: 'Walmart later' } }));
    expect(h.db.repeatTemplates[templateId]?.snapshot.tagIds).toEqual([manualId]);
    const secondId = h.run(materialize(h.db, h.ctx(), h.db.repeatTemplates[templateId]!, '2026-09-09')).materializedId!;
    expect(effectiveTaskTags(h.db, buildTagIndex(h.db), secondId).all).toEqual(new Set([manualId]));
    expect(Object.values(h.db.tagAssignments).some((assignment) => assignment.tagId === ERRANDS_TAG_ID)).toBe(false);
    expect(JSON.stringify(exportDatabase(h.db))).not.toContain(ERRANDS_TAG_ID);
  });

  it('never persists an automatic tag from an incoming legacy recurrence snapshot', () => {
    const h = new Harness();
    const snapshot: RepeatSnapshot = {
      title: '@ Goodwill', notes: '', parentType: 'inbox', parentId: null,
      headingId: null, areaId: null, tagIds: [], checklist: [],
    };
    const templateId = h.run(createTemplate(h.ctx(), {
      entityKind: 'task', snapshot, rule: { type: 'everyNDays', interval: 1 }, anchorDate: h.today,
    })).id;
    const incoming = { ...h.db.repeatTemplates[templateId]!, snapshot: { ...snapshot, tagIds: [ERRANDS_TAG_ID] } };
    const result = h.run(materialize(h.db, h.ctx(), incoming, h.today));
    expect(Object.values(h.db.tagAssignments)).toEqual([]);
    expect(effectiveTaskTags(h.db, buildTagIndex(h.db), result.materializedId!).all).toEqual(new Set([ERRANDS_TAG_ID]));
  });
});
