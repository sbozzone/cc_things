import { emptyDatabase } from './db';
import { applyPatches, type EntityPatch, type WriteContext } from './patches';
import { todayIn } from './dates';
import type { Database } from './types';

/** Test harness: a database plus a pinned clock, so rules can be exercised by date. */
export class Harness {
  db: Database;
  ownerId = 'owner-1';
  private instant: number;
  private zone: string;

  constructor(instant = '2026-09-08T12:00:00Z', timeZone = 'UTC') {
    this.instant = Date.parse(instant);
    this.zone = timeZone;
    this.db = emptyDatabase(this.ownerId, instant, timeZone);
  }

  get today(): string {
    return todayIn(this.zone, this.instant);
  }

  ctx(): WriteContext {
    return {
      ownerId: this.ownerId,
      now: new Date(this.instant).toISOString(),
      today: this.today,
      timeZone: this.zone,
    };
  }

  apply(patches: EntityPatch[]): void {
    this.db = applyPatches(this.db, patches);
  }

  run<T extends { patches: EntityPatch[] }>(result: T): T {
    this.apply(result.patches);
    return result;
  }

  advanceDays(days: number): void {
    this.instant += days * 86_400_000;
  }

  setInstant(value: string): void {
    this.instant = Date.parse(value);
  }

  setZone(zone: string): void {
    this.zone = zone;
  }
}
