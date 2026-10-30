/**
 * Watch channels (`events.watch`) for calendars shown in the app.
 *
 * A channel's token is HMAC-SHA256(GOOGLE_WEBHOOK_SECRET, channelId); google-webhook checks it.
 * Renewal creates the new channel first, stores it, then stops the old one (using the stored
 * `channel_resource_id`), so there is no gap in notifications. Failures to stop an old channel are
 * ignored: it expires on its own.
 */
import { GoogleApiError } from './api.ts';
import type { SyncDeps } from './deps.ts';
import { channelToken } from './webhook.ts';
import type { CalendarRow } from './types.ts';

/** Renew channels that are missing or expire within this many ms (the cron uses 2 days). */
export const RENEW_WITHIN_MS = 2 * 86400000;
/** Used when Google does not report an expiration. */
const DEFAULT_TTL_MS = 6 * 86400000;

export const channelNeedsRenewal = (cal: Pick<CalendarRow, 'channel_id' | 'channel_expires_at'>, now: number): boolean =>
  !cal.channel_id || !cal.channel_expires_at || Date.parse(cal.channel_expires_at) < now + RENEW_WITHIN_MS;

export type WatchResult = 'created' | 'renewed' | 'unchanged' | 'skipped';

export async function renewWatch(deps: SyncDeps, cal: CalendarRow, o: { force?: boolean } = {}): Promise<WatchResult> {
  const { db, api, tokens, now } = deps;
  if (!cal.show_in_app) return 'skipped';
  if (!o.force && !channelNeedsRenewal(cal, now())) return 'unchanged';
  const account = await db.getAccount(cal.account_id);
  if (!account || account.status !== 'ok') return 'skipped';
  const token = await tokens.get(account.id);

  const id = crypto.randomUUID();
  const ch = await api.watchEvents(token, cal.google_id, {
    id, address: deps.webhookUrl, token: await channelToken(deps.webhookSecret, id),
  });
  const exp = Number(ch.expiration);
  await db.updateCalendar(cal.id, {
    channel_id: ch.id,
    channel_resource_id: ch.resourceId,
    channel_expires_at: new Date(Number.isFinite(exp) && exp > 0 ? exp : now() + DEFAULT_TTL_MS).toISOString(),
  });

  if (cal.channel_id && cal.channel_resource_id) {
    try {
      await api.stopChannel(token, { id: cal.channel_id, resourceId: cal.channel_resource_id });
    } catch (e) {
      deps.log('stop of the old watch channel failed (it will expire)', e instanceof GoogleApiError ? e.message : String(e));
    }
  }
  return cal.channel_id ? 'renewed' : 'created';
}

/** Stops and forgets a calendar's channel (best effort on Google's side). */
export async function stopWatch(deps: SyncDeps, cal: CalendarRow, accessToken: string | null): Promise<void> {
  if (accessToken && cal.channel_id && cal.channel_resource_id) {
    try {
      await deps.api.stopChannel(accessToken, { id: cal.channel_id, resourceId: cal.channel_resource_id });
    } catch (e) {
      deps.log('stopping the watch channel failed (it will expire)', e instanceof GoogleApiError ? e.message : String(e));
    }
  }
  if (cal.channel_id) {
    await deps.db.updateCalendar(cal.id, { channel_id: null, channel_resource_id: null, channel_expires_at: null });
  }
}
