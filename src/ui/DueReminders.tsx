'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/state/store';
import * as actions from '@/state/actions';
import { Button } from './primitives';
import { ClockIcon } from './icons';

/**
 * In-app due list (R19).
 *
 * Where the browser cannot deliver a system notification, a due reminder still has to
 * surface somewhere. Completing or snoozing here cancels the pending delivery; snoozing
 * never changes the task's start date or deadline.
 */
export function DueReminders() {
  const db = useApp((s) => s.db);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const due = Object.values(db.reminders).filter((reminder) => {
    if (reminder.deletedAt !== null || reminder.canceledAt !== null) return false;
    if (dismissed.includes(`${reminder.id}:${reminder.generation}`)) return false;
    const at = reminder.snoozedUntil ?? reminder.fireInstant;
    if (Date.parse(at) > now) return false;
    const task = db.tasks[reminder.taskId];
    return Boolean(task) && task?.status === 'open' && task?.deletedAt === null;
  });

  if (due.length === 0) return null;

  return (
    <div className="fixed right-3 top-3 z-[55] w-[min(340px,calc(100vw-24px))] space-y-2" aria-live="polite">
      {due.map((reminder) => {
        const task = db.tasks[reminder.taskId];
        return (
          <div key={reminder.id} role="alert" className="pop-in rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-pop)]">
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <ClockIcon size={13} />Reminder · {reminder.wallTime}
            </div>
            <p className="mt-1 text-[14.5px] font-medium">{task?.title}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="primary" onClick={() => actions.setStatus([reminder.taskId], 'completed')}>Complete</Button>
              {([10, 30, 60] as const).map((minutes) => (
                <Button key={minutes} size="sm" variant="ghost" onClick={() => actions.snoozeReminder(reminder.id, minutes)}>
                  {minutes}m
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed((list) => [...list, `${reminder.id}:${reminder.generation}`])}
              >
                Dismiss
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
