import type { Database, Tag, TagTargetType } from './types';

/**
 * Tags and inheritance (R22).
 *
 * Direct assignments are stored; inherited ones are calculated. Moving a task to
 * another area therefore recalculates its inherited tags rather than copying them into
 * direct assignments.
 */

export interface TagIndex {
  /** Direct assignments, keyed by `${targetType}:${targetId}`. */
  direct: Map<string, Set<string>>;
  children: Map<string, string[]>;
  roots: string[];
}

const key = (type: TagTargetType, id: string) => `${type}:${id}`;

export function buildTagIndex(db: Database): TagIndex {
  const direct = new Map<string, Set<string>>();
  for (const a of Object.values(db.tagAssignments)) {
    if (a.deletedAt !== null) continue;
    const tag = db.tags[a.tagId];
    if (!tag || tag.deletedAt !== null) continue;
    const k = key(a.targetType, a.targetId);
    let set = direct.get(k);
    if (!set) {
      set = new Set();
      direct.set(k, set);
    }
    set.add(a.tagId);
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const live = Object.values(db.tags).filter((t) => t.deletedAt === null);
  for (const tag of live) {
    const parent = tag.parentTagId;
    if (parent && db.tags[parent] && db.tags[parent]?.deletedAt === null) {
      const list = children.get(parent) ?? [];
      list.push(tag.id);
      children.set(parent, list);
    } else {
      roots.push(tag.id);
    }
  }
  const sortByRank = (ids: string[]) =>
    ids.sort((x, y) => {
      const a = db.tags[x];
      const b = db.tags[y];
      if (!a || !b) return 0;
      return a.rank === b.rank ? a.name.localeCompare(b.name) : a.rank < b.rank ? -1 : 1;
    });
  sortByRank(roots);
  for (const list of children.values()) sortByRank(list);

  return { direct, children, roots };
}

export function directTags(index: TagIndex, type: TagTargetType, id: string): Set<string> {
  return index.direct.get(key(type, id)) ?? new Set();
}

/** A tag plus every tag beneath it, so filtering by a parent includes its descendants. */
export function tagWithDescendants(index: TagIndex, tagId: string): Set<string> {
  const out = new Set<string>([tagId]);
  const queue = [tagId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const child of index.children.get(current) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

export interface EffectiveTags {
  direct: Set<string>;
  /** Inherited tag id -> the entity it came from, so the origin stays inspectable. */
  inherited: Map<string, { type: TagTargetType; id: string }>;
  all: Set<string>;
}

/** Combines a task's own tags with those inherited from its project and area. */
export function effectiveTaskTags(db: Database, index: TagIndex, taskId: string): EffectiveTags {
  const task = db.tasks[taskId];
  const direct = new Set(task ? directTags(index, 'task', taskId) : []);
  const inherited = new Map<string, { type: TagTargetType; id: string }>();
  if (!task) return { direct, inherited, all: direct };

  const addFrom = (type: TagTargetType, id: string) => {
    for (const tagId of directTags(index, type, id)) {
      if (!direct.has(tagId) && !inherited.has(tagId)) inherited.set(tagId, { type, id });
    }
  };

  if (task.parentType === 'project' && task.parentId) {
    const project = db.projects[task.parentId];
    if (project && project.deletedAt === null) {
      addFrom('project', project.id);
      if (project.areaId) addFrom('area', project.areaId);
    }
  } else if (task.parentType === 'area' && task.parentId) {
    addFrom('area', task.parentId);
  }

  const all = new Set([...direct, ...inherited.keys()]);
  return { direct, inherited, all };
}

export function effectiveProjectTags(db: Database, index: TagIndex, projectId: string): EffectiveTags {
  const project = db.projects[projectId];
  const direct = new Set(project ? directTags(index, 'project', projectId) : []);
  const inherited = new Map<string, { type: TagTargetType; id: string }>();
  if (project?.areaId) {
    for (const tagId of directTags(index, 'area', project.areaId)) {
      if (!direct.has(tagId)) inherited.set(tagId, { type: 'area', id: project.areaId });
    }
  }
  return { direct, inherited, all: new Set([...direct, ...inherited.keys()]) };
}

/**
 * Filtering by several tags accepts any selected tag; selecting a parent tag also
 * accepts any of its descendants.
 */
export function matchesTagFilter(effective: Set<string>, index: TagIndex, filter: string[]): boolean {
  if (filter.length === 0) return true;
  return filter.some((tagId) => {
    const accepted = tagWithDescendants(index, tagId);
    for (const t of effective) if (accepted.has(t)) return true;
    return false;
  });
}

/** Rejects a reparenting that would introduce a cycle (R22, "nest tags without cycles"). */
export function wouldCycle(db: Database, tagId: string, newParentId: string | null): boolean {
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === tagId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const parent: Tag | undefined = db.tags[cursor];
    cursor = parent ? parent.parentTagId : null;
  }
  return false;
}

export function tagPath(db: Database, tagId: string): string {
  const parts: string[] = [];
  let cursor: string | null = tagId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const tag: Tag | undefined = db.tags[cursor];
    if (!tag) break;
    parts.unshift(tag.name);
    cursor = tag.parentTagId;
  }
  return parts.join(' / ');
}
