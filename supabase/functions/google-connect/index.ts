// google-connect: Google OAuth connect / callback / list / disconnect / reconnect.
// Deploy with JWT verification OFF (`verify_jwt = false`): Google's redirect to the OAuth callback
// carries no JWT. Every other action checks the user's JWT itself, and the callback validates its
// own `state`. See supabase/functions/_shared/google/README.md.
import { connectDeps, userResolver } from '../_shared/google/config.ts';
import { handleConnect } from '../_shared/google/handlers.ts';
import { HttpError, json } from '../_shared/google/http.ts';

let ctx: ReturnType<typeof connectDeps> | undefined;

Deno.serve((req: Request): Promise<Response> | Response => {
  try {
    ctx ??= connectDeps();
  } catch (e) {
    console.error(e);
    return e instanceof HttpError ? json({ error: e.code, message: e.message }, e.status) : json({ error: 'server_error' }, 500);
  }
  return handleConnect(req, ctx.deps, userResolver(ctx.admin));
});
