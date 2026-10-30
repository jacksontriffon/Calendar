/**
 * HTTP handlers for the three Google functions. The entrypoints (each function's `index.ts`) only build
 * the dependencies from the environment and call these, so the request handling is testable with
 * plain `Request` objects.
 */
import {
  disconnectAccount, handleCallback, listAccounts, startConnect,
} from './connect.ts';
import type { ConnectDeps } from './connect.ts';
import type { SyncDeps } from './deps.ts';
import { bearerToken, HttpError, isServiceRole, json, preflight, readJson, str } from './http.ts';
import { drain, renewWatchBatch, syncNow } from './sync.ts';
import type { Job, QueueName } from './sync.ts';

type Authenticate = (jwt: string) => Promise<string | null>;

const fail = (e: unknown): Response => {
  if (e instanceof HttpError) return json({ error: e.code ?? 'error', message: e.message }, e.status);
  console.error(e);
  return json({ error: 'server_error' }, 500);
};

/* ------------------------------------------------------------------ google-connect */

/**
 * GET  ...?code=&state=   OAuth callback (no JWT; validates its own `state`)
 * POST {action: 'start' | 'reconnect' | 'list' | 'disconnect', ...}   requires a user JWT
 */
export async function handleConnect(req: Request, deps: ConnectDeps, authenticate: Authenticate): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  try {
    if (req.method === 'GET') return await handleCallback(deps, new URL(req.url).searchParams);
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const jwt = bearerToken(req);
    const userId = jwt ? await authenticate(jwt) : null;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const body = await readJson(req);
    switch (body.action) {
      case 'start':
        return json(await startConnect(deps, userId, { returnUrl: str(body.return_url), loginHint: str(body.login_hint) }));
      case 'reconnect': {
        const accountId = str(body.account_id);
        if (!accountId) throw new HttpError(400, 'account_id is required', 'bad_request');
        return json(await startConnect(deps, userId, { returnUrl: str(body.return_url), accountId }));
      }
      case 'list':
        return json({ accounts: await listAccounts(deps, userId) });
      case 'disconnect': {
        const accountId = str(body.account_id);
        if (!accountId) throw new HttpError(400, 'account_id is required', 'bad_request');
        await disconnectAccount(deps, userId, accountId);
        return json({ ok: true });
      }
      default:
        throw new HttpError(400, 'unknown action', 'bad_request');
    }
  } catch (e) {
    return fail(e);
  }
}

/* -------------------------------------------------------------------- google-sync */

/**
 * Service role (the queue consumer / cron):
 *   {action: 'drain', queue: 'publish' | 'import', jobs: [{msg_id, attempt, payload}]}
 *   {action: 'renew_watch', calendars: [{id, user_id}]}
 * A user JWT may only call {action: 'sync_now', calendar_id?} and syncs that user's calendars.
 */
export async function handleSync(
  req: Request, deps: SyncDeps, auth: { serviceRoleKey: string; authenticate: Authenticate },
): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  try {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const service = isServiceRole(req, auth.serviceRoleKey);
    let userId: string | null = null;
    if (!service) {
      const jwt = bearerToken(req);
      userId = jwt ? await auth.authenticate(jwt) : null;
      if (!userId) return json({ error: 'unauthorized' }, 401);
    }

    const body = await readJson(req);
    if (body.action === 'sync_now') {
      // Service role may name the user; a user JWT is always that user.
      const target = service ? str(body.user_id) : userId;
      if (!target) throw new HttpError(400, 'user_id is required', 'bad_request');
      return json(await syncNow(deps, target, str(body.calendar_id)));
    }
    if (!service) return json({ error: 'forbidden' }, 403);

    if (body.action === 'drain') {
      const queue = body.queue;
      if ((queue !== 'publish' && queue !== 'import') || !Array.isArray(body.jobs)) throw new HttpError(400, 'bad drain request', 'bad_request');
      const jobs = (body.jobs as unknown[]).filter((j): j is Job => !!j && typeof j === 'object' && typeof (j as Job).msg_id === 'number');
      return json(await drain(deps, { queue: queue as QueueName, jobs }));
    }
    if (body.action === 'renew_watch') {
      if (!Array.isArray(body.calendars)) throw new HttpError(400, 'bad renew_watch request', 'bad_request');
      const calendars = (body.calendars as Array<{ id?: unknown; user_id?: unknown }>)
        .filter((c) => typeof c?.id === 'string' && typeof c?.user_id === 'string') as Array<{ id: string; user_id: string }>;
      return json(await renewWatchBatch(deps, calendars));
    }
    throw new HttpError(400, 'unknown action', 'bad_request');
  } catch (e) {
    return fail(e);
  }
}
