// google-sync: Google import (events.list + syncToken), publish (events insert/patch/delete) and
// watch-channel renewal. Called by the pg_cron queue consumer with the service-role key
// ({action: 'drain' | 'renew_watch'}), and by signed-in users for {action: 'sync_now'}.
// Deploy with `verify_jwt = false`: the function checks the bearer token itself (service-role key,
// or a user JWT for sync_now), which also works with Supabase's non-JWT `sb_secret_...` keys.
// See supabase/functions/_shared/google/README.md.
import { serviceRoleKey, syncDeps, userResolver } from '../_shared/google/config.ts';
import { handleSync } from '../_shared/google/handlers.ts';
import { HttpError, json } from '../_shared/google/http.ts';

let ctx: ReturnType<typeof syncDeps> | undefined;

Deno.serve((req: Request): Promise<Response> | Response => {
  try {
    ctx ??= syncDeps();
    return handleSync(req, ctx.deps, { serviceRoleKey: serviceRoleKey(), authenticate: userResolver(ctx.admin) });
  } catch (e) {
    console.error(e);
    return e instanceof HttpError ? json({ error: e.code, message: e.message }, e.status) : json({ error: 'server_error' }, 500);
  }
});
