/**
 * Target status mapping (EV 02): what `event_targets.status` and the client's own
 * in-flight work say, as the four states the picker shows, plus the summary line
 * under "Public on 3 calendars". Pure, so it is unit-tested.
 *
 *   Synced   green         the copy exists
 *   Pending  accent spinner  waiting for google-sync (or for the event to reach the server)
 *   Failed   coral + Retry   Retry = call set_event_google_targets again
 *   Queued   muted cloud-off  waiting for the connection; nothing is lost
 */

export type UiStatus = 'pending' | 'synced' | 'failed' | 'queued';

/** The part of an `event_targets` row the mapping reads. */
export interface TargetLike {
  status: string;
  error?: string | null;
  remove_requested?: boolean | null;
}

/** Work the client itself has in flight for an event's targets (the RPC call). */
export type LocalOp = 'pending' | 'queued' | 'failed' | null | undefined;

export function normalizeStatus(s: string | null | undefined): UiStatus {
  return s === 'synced' || s === 'failed' || s === 'queued' || s === 'pending' ? s : 'pending';
}

/**
 * The status to show for one ticked calendar, or `null` when the event hasn't
 * been saved to that calendar yet (nothing to report).
 *
 *  - the client's own failed / queued attempt beats a stale row;
 *  - a pending row while offline is "queued": google-sync can't run until we're back;
 *  - a row the user has unticked (`remove_requested`) is not a target at all.
 */
export function targetUiStatus(row: TargetLike | null | undefined, opts: { offline?: boolean; localOp?: LocalOp } = {}): UiStatus | null {
  const { offline = false, localOp = null } = opts;
  if (row?.remove_requested) return null;
  if (localOp === 'failed') return 'failed';
  if (localOp === 'queued') return 'queued';
  if (!row) return localOp === 'pending' ? (offline ? 'queued' : 'pending') : null;
  const s = normalizeStatus(row.status);
  if (s === 'pending' && offline) return 'queued';
  if (s === 'synced' && localOp === 'pending') return 'pending';
  return s;
}

/** The short reason after "Failed ·". Server errors are technical; say what the user can act on. */
export function failureReason(error: string | null | undefined): string {
  const e = (error ?? '').toLowerCase();
  if (!e) return 'Google didn’t respond';
  if (/403|forbidden|permission|not marked|can publish|write access|insufficient/.test(e)) return 'No permission to add events';
  if (/404|not found|gone|deleted/.test(e)) return 'Calendar not found';
  return 'Google didn’t respond';
}

export interface StatusCounts {
  total: number;
  synced: number;
  pending: number;
  queued: number;
  failed: number;
}

export function countStatuses(statuses: ReadonlyArray<UiStatus | null>): StatusCounts {
  const c: StatusCounts = { total: statuses.length, synced: 0, pending: 0, queued: 0, failed: 0 };
  statuses.forEach((s) => {
    if (s) c[s] += 1;
  });
  return c;
}

const plural = (n: number, one: string, many = one + 's') => (n === 1 ? one : many);

/** "Public on 3 calendars" (EV 2.3 footer, and the row's "Public · 3 calendars" without "on"). */
export function publicTitle(total: number): string {
  return total <= 0 ? 'Public' : 'Public on ' + total + ' ' + plural(total, 'calendar');
}

/**
 * The line under the footer title: "2 synced · 1 pending", "2 synced · 1 failed",
 * "All synced", "2 queued until you’re online". Empty while nothing has a status yet.
 */
export function summaryLine(c: StatusCounts): string {
  const known = c.synced + c.pending + c.queued + c.failed;
  if (!known) return '';
  if (c.queued) return c.queued + ' queued until you’re online';
  if (c.synced === c.total && c.total > 0) return 'All synced';
  const parts: string[] = [];
  if (c.synced) parts.push(c.synced + ' synced');
  if (c.pending) parts.push(c.pending + ' pending');
  if (c.failed) parts.push(c.failed + ' failed');
  return parts.join(' · ');
}

/** Worst state first, for the one word the collapsed row shows (EV 1.3 "Queued"). */
export function worstStatus(c: StatusCounts): UiStatus | null {
  if (c.failed) return 'failed';
  if (c.queued) return 'queued';
  if (c.pending) return 'pending';
  if (c.synced) return 'synced';
  return null;
}

export const STATUS_LABEL: Record<UiStatus, string> = {
  pending: 'Pending',
  synced: 'Synced',
  failed: 'Failed',
  queued: 'Queued',
};
