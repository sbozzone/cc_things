import { update, type EntityPatch, type WriteContext } from './patches';
import type { Database } from './types';

/**
 * Performs an idempotent My Day rollover for the planning day in `ctx`.
 * The caller invokes it on app start, foregrounding and periodic day checks so a
 * closed browser never causes stale selections to linger.
 */
export function dailyResetPatches(db: Database, ctx: WriteContext): EntityPatch[] {
  const last = db.settings.lastTodayResetDate;
  if (last === ctx.today) return [];

  const patches: EntityPatch[] = [];
  for (const task of Object.values(db.tasks)) {
    if (
      task.deletedAt === null &&
      task.status === 'open' &&
      task.isInToday === true &&
      task.deadline !== ctx.today
    ) {
      patches.push(update('tasks', task.id, { deadline: ctx.today }, ctx));
    }
  }

  patches.push(update('settings', 'settings', { lastTodayResetDate: ctx.today }, ctx));
  return patches;
}
