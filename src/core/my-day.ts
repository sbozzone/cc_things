import type { EntityPatch, WriteContext } from './patches';
import type { Database } from './types';

/**
 * Performs an idempotent My Day rollover for the planning day in `ctx`.
 * The caller invokes it on app start, foregrounding and periodic day checks so a
 * closed browser never causes stale selections to linger.
 */
export function dailyResetPatches(db: Database, ctx: WriteContext): EntityPatch[] {
  const last = db.settings.lastTodayResetDate;
  if (last === ctx.today) return [];

  // Open selections intentionally remain selected. Completed, canceled and deleted
  // tasks are already excluded by My Day membership, so no task rows need mutation.
  return [{ table: 'settings', id: 'settings', patch: { lastTodayResetDate: ctx.today, updatedAt: ctx.now } }];
}
