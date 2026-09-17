/**
 * Logical data model (spec §12).
 *
 * Every entity is owner-scoped, carries a stable client-generated id, and keeps an
 * explicit `deletedAt` tombstone rather than being removed in place, so that Trash
 * recovery (R06) and sync convergence (R34) both have something to work with.
 *
 * Date-only fields are `YYYY-MM-DD` strings and are never converted to an instant.
 * A September 10 deadline stays September 10 on every device (spec §6, boundary policies).
 */

/** `YYYY-MM-DD`. A calendar date with no time and no zone. */
export type DateOnly = string;
/** ISO-8601 instant, e.g. `2026-09-08T17:03:00.000Z`. */
export type Instant = string;

export const SCHEMA_VERSION = 1;

export type EntityKind =
  | 'area'
  | 'project'
  | 'heading'
  | 'task'
  | 'checklistItem'
  | 'tag'
  | 'tagAssignment'
  | 'repeatTemplate'
  | 'occurrenceLink'
  | 'reminder'
  | 'settings';

/** Open / completed / canceled (R05). Canceled is distinct from completed everywhere. */
export type LifecycleStatus = 'open' | 'completed' | 'canceled';

/**
 * The "When" dimension (R15), stored independently of `deadline`.
 * - `anytime`   — available now, no scheduled day.
 * - `someday`   — explicitly held.
 * - `scheduled` — has a `startDate`; Today is simply `startDate <= today`.
 */
export type PlanningState = 'anytime' | 'someday' | 'scheduled';

/** Where a task hangs in the structure. A task has exactly one structural parent (R07). */
export type TaskParentType = 'inbox' | 'area' | 'project';

export interface BaseEntity {
  id: string;
  ownerId: string;
  createdAt: Instant;
  updatedAt: Instant;
  deletedAt: Instant | null;
}

export interface Area extends BaseEntity {
  title: string;
  /** Fractional index; see core/rank.ts. */
  rank: string;
}

export interface Project extends BaseEntity {
  areaId: string | null;
  title: string;
  notes: string;
  status: LifecycleStatus;
  planning: PlanningState;
  startDate: DateOnly | null;
  eveningDate: DateOnly | null;
  deadline: DateOnly | null;
  rank: string;
  completedAt: Instant | null;
  canceledAt: Instant | null;
}

export interface Heading extends BaseEntity {
  projectId: string;
  title: string;
  rank: string;
  /** Archived headings stay in project history and still count toward progress (R08, R09). */
  archivedAt: Instant | null;
}

export interface Task extends BaseEntity {
  /** An explicit My Day selection. Open tasks roll forward until removed or completed. */
  isInToday?: boolean;
  priority?: 'urgent' | 'timeSensitive' | 'high' | 'low' | null;
  title: string;
  notes: string;
  status: LifecycleStatus;
  /**
   * Inbox membership is `parentType === 'inbox' && !processed` (R11).
   * Filing or assigning a planning state processes a task; a note or tag alone does not.
   */
  processed: boolean;
  parentType: TaskParentType;
  parentId: string | null;
  headingId: string | null;
  planning: PlanningState;
  startDate: DateOnly | null;
  /** Set when a scheduled or My Day selection carries an evening designation. */
  eveningDate: DateOnly | null;
  deadline: DateOnly | null;
  /** Structural order within the parent. */
  rank: string;
  /** Today's manual order, persisted separately from structural order (R25). */
  todayRank: string;
  completedAt: Instant | null;
  canceledAt: Instant | null;
}

export interface ChecklistItem extends BaseEntity {
  taskId: string;
  text: string;
  checked: boolean;
  rank: string;
}

export interface Tag extends BaseEntity {
  color?: string | null;
  name: string;
  parentTagId: string | null;
  rank: string;
}

export type TagTargetType = 'task' | 'project' | 'area';

export interface TagAssignment extends BaseEntity {
  tagId: string;
  targetType: TagTargetType;
  targetId: string;
}

/** Fixed schedules run off the calendar; completion-relative schedules run off the finish date (R17). */
export type RepeatRuleType =
  | 'everyNDays'
  | 'everyNWeeks'
  | 'everyNMonths'
  | 'everyNYears'
  | 'weekdays'
  | 'dayOfMonth'
  | 'ordinalWeekday'
  | 'afterCompletion';

export interface RepeatRule {
  type: RepeatRuleType;
  /** N for every-N rules, and the day count for `afterCompletion`. */
  interval: number;
  /** 0=Sunday … 6=Saturday. Used by `weekdays` and `ordinalWeekday`. */
  weekdays?: number[];
  /** 1–31 for `dayOfMonth`. 31 falls back to the month's final day (§7). */
  dayOfMonth?: number;
  /** 1–4, or -1 for "last", used by `ordinalWeekday`. */
  ordinal?: number;
  /** Month 1–12, used by `everyNYears` alongside `dayOfMonth`. */
  month?: number;
}

export type RepeatEntityKind = 'task' | 'project';

export interface RepeatTemplate extends BaseEntity {
  entityKind: RepeatEntityKind;
  /** Content copied into each occurrence. Edits here affect future copies only (R18). */
  snapshot: RepeatSnapshot;
  rule: RepeatRule;
  /** First date the rule is anchored to. */
  anchorDate: DateOnly;
  endDate: DateOnly | null;
  /** When true the occurrence date is the deadline and the start is `date - leadDays` (§7). */
  useDeadline: boolean;
  leadDays: number;
  /** Planning zone the rule was authored in. */
  timeZone: string;
  pausedAt: Instant | null;
  stoppedAt: Instant | null;
  /** Bumped on every rule edit so occurrence links record which version produced them. */
  ruleVersion: number;
  /** Highest occurrence date already materialized, so missed dates are generated once (§7). */
  lastGeneratedKey: string | null;
}

export interface RepeatSnapshot {
  priority?: Task['priority'];
  title: string;
  notes: string;
  parentType: TaskParentType;
  parentId: string | null;
  headingId: string | null;
  areaId: string | null;
  tagIds: string[];
  checklist: { text: string }[];
  /** For project templates: headings and child tasks, with dates as offsets from the occurrence. */
  headings?: { title: string; tasks: { title: string; notes: string; startOffsetDays: number | null }[] }[];
  tasks?: { title: string; notes: string; startOffsetDays: number | null }[];
}

/** Uniqueness on (templateId, occurrenceKey) is what stops duplicate generation (§7). */
export interface OccurrenceLink extends BaseEntity {
  templateId: string;
  occurrenceKey: string;
  materializedId: string;
  ruleVersion: number;
  /** True when the user pulled the copy forward, so the scheduled date must not regenerate. */
  createdEarly: boolean;
  skipped: boolean;
  /**
   * For completion-relative series: the occurrence whose completion produced this copy.
   * Replaying that completion finds this link and generates nothing further (spec §7).
   */
  generatedFrom: string | null;
  /** Set when an undone completion left an edited copy that a person should look at. */
  needsReview: boolean;
}

export interface Reminder extends BaseEntity {
  taskId: string;
  /** Local wall time `HH:mm` on the task's start date. */
  wallTime: string;
  timeZone: string;
  /** Resolved delivery instant, recomputed whenever the date, time or zone changes (R19). */
  fireInstant: Instant;
  snoozedUntil: Instant | null;
  /** Bumped on every reschedule; delivery is deduplicated by (reminderId, generation, device). */
  generation: number;
  canceledAt: Instant | null;
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type ColorTheme = 'orange' | 'sage' | 'bright' | 'white';
export type TodayGrouping = 'flat' | 'byProject';
export type ListSort =
  | 'manual'
  | 'alphabetical' | 'alphabeticalDesc'
  | 'due' | 'dueDesc'
  | 'created' | 'createdAsc'
  | 'priority' | 'priorityDesc'
  | 'tags' | 'tagsDesc';

export interface Settings extends BaseEntity {
  /** Planning day whose My Day rollover has already been processed. */
  lastTodayResetDate?: DateOnly;
  listSorts?: Record<string, ListSort>;
  locale: string;
  /** One account-wide IANA planning zone; changing devices must not move the planning day. */
  planningTimeZone: string;
  theme: ThemePreference;
  /** Colour palette, independent of the light/dark brightness preference. */
  colorTheme?: ColorTheme;
  todayGrouping: TodayGrouping;
  notificationsEnabled: boolean;
  typeToSearch: boolean;
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
}

/** Read-only provider events, cached separately from tasks and never synced as tasks (R20, R21). */
export interface CalendarEvent {
  id: string;
  ownerId: string;
  providerId: string;
  calendarId: string;
  eventId: string;
  /** Distinguishes instances of a recurring meeting that share a title (R21). */
  instanceId: string;
  title: string;
  allDay: boolean;
  startDate: DateOnly;
  endDate: DateOnly;
  startInstant: Instant | null;
  endInstant: Instant | null;
  timeZone: string | null;
  sourceUrl: string | null;
  revision: string | null;
  canceled: boolean;
  lastRefreshedAt: Instant;
}

export interface CalendarSubscription {
  id: string;
  ownerId: string;
  providerId: string;
  calendarId: string;
  title: string;
  url: string;
  enabled: boolean;
  lastRefreshedAt: Instant | null;
  lastError: string | null;
  /** Parser revision used for the current local event cache. */
  parserVersion?: number;
}

/** The full owner-scoped record set the client holds in memory and persists locally. */
export interface Database {
  schemaVersion: number;
  settings: Settings;
  areas: Record<string, Area>;
  projects: Record<string, Project>;
  headings: Record<string, Heading>;
  tasks: Record<string, Task>;
  checklistItems: Record<string, ChecklistItem>;
  tags: Record<string, Tag>;
  tagAssignments: Record<string, TagAssignment>;
  repeatTemplates: Record<string, RepeatTemplate>;
  occurrenceLinks: Record<string, OccurrenceLink>;
  reminders: Record<string, Reminder>;
  calendarSubscriptions: Record<string, CalendarSubscription>;
  calendarEvents: Record<string, CalendarEvent>;
}

export type EntityTable = Exclude<keyof Database, 'schemaVersion' | 'settings'>;

/** One durable local write plus its pending sync operation (R33, R34). */
export interface SyncOperation {
  opId: string;
  deviceId: string;
  ownerId: string;
  table: EntityTable | 'settings';
  entityId: string;
  /** Revision the client had when it produced the patch, used for conflict detection. */
  baseRevision: number;
  patch: Record<string, unknown>;
  createdAt: Instant;
  /** Server sequence, assigned on acknowledgement. */
  serverSeq: number | null;
}

/** A same-field loser retained for 30 days so the displaced value stays recoverable (R34). */
export interface ConflictRecord {
  id: string;
  ownerId: string;
  table: string;
  entityId: string;
  field: string;
  displacedValue: unknown;
  winningValue: unknown;
  detectedAt: Instant;
  expiresAt: Instant;
}
