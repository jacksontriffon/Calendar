/**
 * Google push-notification (watch channel) authentication and the webhook handler.
 *
 * When google-sync creates a channel it sets `token` to HMAC-SHA256(GOOGLE_WEBHOOK_SECRET, channelId)
 * (hex). Google echoes the token in `X-Goog-Channel-Token` on every notification, together with
 * `X-Goog-Channel-ID`. The handler accepts a notification only if the token matches the HMAC of the
 * channel id AND the channel id belongs to a calendar we know.
 */
import { json, timingSafeEqual } from './http.ts';

const toHex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export const channelToken = async (secret: string, channelId: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(channelId)));
};

export const verifyChannelToken = async (secret: string, channelId: string, token: string | null | undefined): Promise<boolean> => {
  if (!secret || !channelId || !token) return false;
  return timingSafeEqual(await channelToken(secret, channelId), token);
};

export interface WebhookDeps {
  secret: string;
  /** the calendar whose watch channel has this id */
  findCalendarByChannel(channelId: string): Promise<{ id: string; user_id: string; show_in_app: boolean } | null>;
  enqueueImport(calendarId: string): Promise<unknown>;
}

/**
 * Handles one notification. Always answers quickly: 200 for accepted notifications (including the
 * initial `sync` message and ignored ones for unknown/hidden calendars, so Google does not retry),
 * 401 for a bad token, 400 for a malformed request.
 */
export const handleWebhook = async (req: Request, deps: WebhookDeps): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const channelId = req.headers.get('X-Goog-Channel-ID');
  const token = req.headers.get('X-Goog-Channel-Token');
  const state = req.headers.get('X-Goog-Resource-State');
  if (!channelId || !state) return json({ error: 'bad_request' }, 400);
  if (!(await verifyChannelToken(deps.secret, channelId, token))) return json({ error: 'invalid_token' }, 401);

  // `sync` is the hello Google sends when a channel is created; the import that follows creation covers it.
  if (state === 'sync') return json({ ok: true, ignored: 'sync' });

  const cal = await deps.findCalendarByChannel(channelId);
  if (!cal) return json({ ok: true, ignored: 'unknown_channel' });
  if (!cal.show_in_app) return json({ ok: true, ignored: 'hidden' });

  await deps.enqueueImport(cal.id);
  return json({ ok: true, queued: true });
};
