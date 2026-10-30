/**
 * account-delete: delete the caller's account (App Store requirement). POST, JWT required, no body.
 *
 *  1. For each of the user's Google accounts: read the refresh token from Vault
 *     (`get_google_refresh_token`) and revoke it at Google. A token Google no longer knows
 *     (already revoked) counts as done; a failed revoke is logged and does not block the deletion,
 *     because the token is destroyed on our side in the next step either way.
 *  2. Delete the `google_accounts` rows. The `google_accounts_delete_token` trigger deletes each
 *     row's Vault secret, so no token outlives the account.
 *  3. `auth.admin.deleteUser`: everything else cascades from auth.users (profile, categories, goals,
 *     events, targets, usage, legacy blob, ...).
 *
 * Returns `{ ok: true }` once the user is gone. Safe to retry: every step tolerates having run.
 * The caller id comes from the verified JWT only.
 */
import { errorResponse, HttpError, json, preflight } from '../_shared/http.ts';
import { MissingEnvError } from '../_shared/env.ts';
import type { BaseDeps } from '../_shared/supabase.ts';

export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export type AccountDeleteDeps = BaseDeps;

/** true when Google no longer honours the token afterwards (revoked now, or already invalid). */
const revoke = async (token: string, fetchFn: typeof fetch): Promise<boolean> => {
  try {
    const res = await fetchFn(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    // 400 invalid_token: expired, revoked by the user in their Google settings, or never valid.
    const detail = await res.text().catch(() => '');
    if (res.status === 400 && /invalid_token/.test(detail)) return true;
    console.warn('[account-delete] Google revoke failed: HTTP ' + res.status);
    return false;
  } catch (e) {
    console.warn('[account-delete] Google revoke failed:', String((e as Error)?.message ?? e));
    return false;
  }
};

export const handle = async (req: Request, deps: AccountDeleteDeps): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
    const user = await deps.auth(req);
    const admin = deps.admin();

    const accounts = await admin.from('google_accounts').select('id').eq('user_id', user.id);
    if (accounts.error) {
      console.error('[account-delete] listing google accounts failed', accounts.error);
      throw new HttpError(502, 'delete_failed', 'Could not read the connected Google accounts; nothing was deleted');
    }

    let failed = 0;
    for (const a of (accounts.data ?? []) as Array<{ id: string }>) {
      const tok = await admin.rpc('get_google_refresh_token', { p_account_id: a.id });
      if (tok.error) {
        console.error('[account-delete] reading a refresh token failed', tok.error);
        throw new HttpError(502, 'delete_failed', 'Could not read a Google token; nothing was deleted');
      }
      if (typeof tok.data === 'string' && tok.data) {
        if (!(await revoke(tok.data, deps.fetch))) failed++;
      }
    }
    if (failed) console.warn(`[account-delete] ${failed} Google token(s) could not be revoked; deleting the account anyway`);

    // The trigger removes each account's Vault secret with its row.
    const del = await admin.from('google_accounts').delete().eq('user_id', user.id);
    if (del.error) {
      console.error('[account-delete] deleting google accounts failed', del.error);
      throw new HttpError(502, 'delete_failed', 'Could not remove the Google connections; nothing else was deleted');
    }

    const gone = await admin.auth.admin.deleteUser(user.id);
    if (gone.error) {
      console.error('[account-delete] deleteUser failed', gone.error);
      throw new HttpError(502, 'delete_failed', 'Could not delete the account; try again');
    }
    return json({ ok: true });
  } catch (e) {
    if (e instanceof MissingEnvError) return errorResponse(new HttpError(500, 'server_config', e.message));
    return errorResponse(e);
  }
};
