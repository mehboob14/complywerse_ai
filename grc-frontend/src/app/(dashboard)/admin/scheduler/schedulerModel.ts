// The Scheduled jobs page's rules as pure functions apart from React, so `node --test` can pin them (schedulerModel.test.ts): how often a job runs, how long ago it was
// last queued, which of four states it is in, and the job's name. Server times are naive UTC (parseUtc), so "3 min ago" is right in every time zone. The jobs are
// the platform's (services/platform_clock.py): a tenant administrator sees and can run them all (recorded as a gap, nothing widened).
import { parseUtc } from '../../../../lib/serverTime.ts';

export interface Job {
  key: string;
  task: string;
  every_seconds: number;
  last_queued_at: string | null;
  next_due_at: string;
  overdue: boolean;
  last_failure: { at: string | null; attempts: number; detail: string } | null;
}
export interface Schedule { clock: { enabled: boolean; tick_seconds: number }; jobs: Job[] }

/** "feed-refresh" -> "Feed refresh": the job's key in words. (The task's own name is a code name and is never shown.) */
export function jobName(key: string): string {
  const words = String(key || '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Job';
}

/** "Hourly", "Daily", "Every 6 hours", "Every 2 days", "Every 15 min". */
export function every(seconds: number): string {
  const s = Math.max(1, Math.round(Number(seconds) || 0));
  if (s % 86400 === 0) return s === 86400 ? 'Daily' : `Every ${s / 86400} days`;
  if (s % 3600 === 0) return s === 3600 ? 'Hourly' : `Every ${s / 3600} hours`;
  return `Every ${Math.max(1, Math.round(s / 60))} min`;
}

/** "Never", "Just now", "12 min ago", "5 h ago", "3 days ago". */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  const at = parseUtc(iso);
  if (!at) return 'Never';
  const minutes = Math.round((now - at.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/** The state of a job, in the order the page has always read it: a failure first, then never run, then overdue, else on schedule. Registry: scheduledJob. */
export function stateOf(job: Pick<Job, 'last_failure' | 'last_queued_at' | 'overdue'>): 'failing' | 'never' | 'overdue' | 'on_schedule' {
  if (job.last_failure) return 'failing';
  if (!job.last_queued_at) return 'never';
  if (job.overdue) return 'overdue';
  return 'on_schedule';
}

/** How many jobs could not be queued: the figure of the warning above the table. */
export const failingCount = (jobs: readonly Pick<Job, 'last_failure'>[]): number => jobs.filter((j) => j.last_failure).length;

/** What the page says about a failed job: how many times it was tried, never the error text (it names the queue's address). */
export function failureWords(job: Pick<Job, 'last_failure'>): string {
  const f = job.last_failure;
  if (!f) return '';
  return f.attempts > 1 ? `Could not be queued · tried ${f.attempts} times` : 'Could not be queued';
}

/** The clock line: "Running · checks every 5 min", or the plain statement that this server does not run the schedule. */
export function clockWords(clock: Schedule['clock']): string {
  if (!clock.enabled) return 'Switched off on this server';
  const minutes = Math.max(1, Math.round((Number(clock.tick_seconds) || 60) / 60));
  return `Running · checks every ${minutes} min`;
}
