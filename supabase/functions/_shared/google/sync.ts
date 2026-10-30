/**
 * google-sync orchestration: queue jobs (`drain`), watch-channel renewal (`renew_watch`) and the
 * user-triggered "Sync now".
 *
 * Queue contract (see supabase/README.md): jobs are grouped by user; for each user the lease lock
 * (`try_sync_lock`) is taken, the jobs run one after another, and the lock is released in `finally`.
 * A job is acknowledged (`queue_ack`) as soon as it is done. Jobs that hit a transient failure, or
 * whose user is busy, are left un-acknowledged and reappear after the visibility timeout (the
 * consumer archives a message after 5 reads). Permanent failures are acknowledged (the failure is
 * recorded on the target, or logged) so they are not retried forever.
 */
import { GoogleApiError } from './api.ts';
import type { SyncDeps } from './deps.ts';
import { importCalendar } from './import.ts';
import type { ImportResult } from './import.ts';
import { publishEvent } from './publish.ts';
import { PrivateEventError } from './publish_map.ts';
import { NeedsSigninError } from './tokens.ts';
import { renewWatch } from './watch.ts';

export type QueueName = 'publish' | 'import';

export interface Job {
  msg_id: number;
  attempt?: number;
  payload: Record<string, unknown>;
}

export interface DrainResult {
  acked: number;
  retry: number;
  busy: number;
  invalid: number;
  deferred: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The work budget of one invocation; the lock lease is 120 s. */
export const DEFAULT_BUDGET_MS = 100_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Takes the user's lock, retrying briefly (the publish and import drains of one minute run side by side). */
export async function acquireLock(deps: SyncDeps, userId: string, o: { tries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  const tries = o.tries ?? 4;
  for (let i = 0; i < tries; i++) {
    if (await deps.db.tryLock(userId)) return true;
    if (i < tries - 1) await (o.sleep ?? sleep)(o.delayMs ?? 750);
  }
  return false;
}

type Outcome = 'done' | 'retry';

const classify = (deps: SyncDeps, e: unknown): Outcome => {
  if (e instanceof NeedsSigninError) return 'done'; // recorded on the account; reconnect re-queues
  if (e instanceof PrivateEventError) return 'done';
  if (e instanceof GoogleApiError && !e.transient) {
    deps.log('permanent Google error: ' + e.message, { status: e.status, reason: e.reason });
    return 'done';
  }
  deps.log('job failed, will retry', e instanceof Error ? e.message : String(e));
  return 'retry';
};

export async function drain(
  deps: SyncDeps,
  body: { queue: QueueName; jobs: Job[] },
  o: { budgetMs?: number; lockSleep?: (ms: number) => Promise<void> } = {},
): Promise<DrainResult> {
  const out: DrainResult = { acked: 0, retry: 0, busy: 0, invalid: 0, deferred: 0 };
  const start = deps.now();
  const budget = o.budgetMs ?? DEFAULT_BUDGET_MS;
  const { queue } = body;
  const idKey = queue === 'publish' ? 'event_id' : 'calendar_id';

  // Group by user, merging duplicate messages for the same event/calendar.
  const users = new Map<string, Map<string, number[]>>();
  const poison: number[] = [];
  for (const job of body.jobs) {
    const user = job.payload?.user_id;
    const key = job.payload?.[idKey];
    if (typeof user !== 'string' || typeof key !== 'string' || !UUID.test(user) || !UUID.test(key)) {
      poison.push(job.msg_id);
      continue;
    }
    const keys = users.get(user) ?? new Map<string, number[]>();
    keys.set(key, [...(keys.get(key) ?? []), job.msg_id]);
    users.set(user, keys);
  }
  if (poison.length) {
    await deps.db.ack(queue, poison);
    out.invalid = poison.length;
  }

  for (const [userId, keys] of users) {
    const jobCount = [...keys.values()].reduce((n, ids) => n + ids.length, 0);
    if (deps.now() - start > budget) {
      out.deferred += jobCount;
      continue;
    }
    if (!(await acquireLock(deps, userId, { sleep: o.lockSleep }))) {
      out.busy += jobCount;
      continue;
    }
    try {
      for (const [key, msgIds] of keys) {
        if (deps.now() - start > budget) {
          out.deferred += msgIds.length;
          continue;
        }
        let outcome: Outcome;
        try {
          if (queue === 'publish') {
            const r = await publishEvent(deps, userId, key);
            outcome = r.retry ? 'retry' : 'done';
          } else {
            await importCalendar(deps, key);
            outcome = 'done';
          }
        } catch (e) {
          outcome = classify(deps, e);
        }
        if (outcome === 'done') {
          await deps.db.ack(queue, msgIds);
          out.acked += msgIds.length;
        } else {
          out.retry += msgIds.length;
        }
      }
    } finally {
      await deps.db.releaseLock(userId);
    }
  }
  return out;
}

export interface RenewResult {
  created: number;
  renewed: number;
  skipped: number;
  failed: number;
}

/** `renew_watch`: (re)create channels for the calendars the cron listed. */
export async function renewWatchBatch(
  deps: SyncDeps, calendars: Array<{ id: string; user_id: string }>, o: { budgetMs?: number } = {},
): Promise<RenewResult> {
  const out: RenewResult = { created: 0, renewed: 0, skipped: 0, failed: 0 };
  const start = deps.now();
  for (const c of calendars) {
    if (deps.now() - start > (o.budgetMs ?? DEFAULT_BUDGET_MS)) {
      out.skipped++;
      continue;
    }
    try {
      const cal = await deps.db.getCalendar(c.id);
      if (!cal || cal.user_id !== c.user_id) {
        out.skipped++;
        continue;
      }
      const r = await renewWatch(deps, cal);
      if (r === 'created') out.created++;
      else if (r === 'renewed') out.renewed++;
      else out.skipped++;
    } catch (e) {
      if (!(e instanceof NeedsSigninError)) deps.log('watch renewal failed', e instanceof Error ? e.message : String(e));
      out.failed++;
    }
  }
  return out;
}

export interface SyncNowResult {
  busy?: boolean;
  published: number;
  calendars: Array<{ id: string; status: string; upserted?: number; deleted?: number; error?: string }>;
}

/**
 * "Sync now" for one user (and optionally one of their calendars): publish everything that is not
 * `synced`, then import every calendar. The caller has authenticated the user; `calendarId`, if given,
 * must belong to them (checked here).
 */
export async function syncNow(deps: SyncDeps, userId: string, calendarId?: string): Promise<SyncNowResult> {
  const out: SyncNowResult = { published: 0, calendars: [] };
  let cals = await deps.db.listUserCalendars(userId);
  if (calendarId) {
    cals = cals.filter((c) => c.id === calendarId);
    if (!cals.length) {
      out.calendars.push({ id: calendarId, status: 'not_found' });
      return out;
    }
  }
  if (!(await acquireLock(deps, userId))) return { ...out, busy: true };
  try {
    if (!calendarId) {
      for (const eventId of await deps.db.listUnsyncedTargetEventIds(userId)) {
        try {
          await publishEvent(deps, userId, eventId);
          out.published++;
        } catch (e) {
          classify(deps, e);
        }
      }
    }
    for (const cal of cals) {
      try {
        const r: ImportResult = await importCalendar(deps, cal.id);
        out.calendars.push({ id: cal.id, status: r.status === 'skipped' ? 'skipped:' + r.reason : r.status, upserted: r.upserted, deleted: r.deleted });
      } catch (e) {
        classify(deps, e);
        out.calendars.push({ id: cal.id, status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    await deps.db.releaseLock(userId);
  }
  return out;
}
