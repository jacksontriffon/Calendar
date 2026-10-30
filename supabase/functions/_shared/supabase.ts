/**
 * Supabase clients and caller authentication.
 *
 * Every function in this repo runs with `verify_jwt = true` (the platform rejects requests without a
 * valid Supabase JWT), but a valid JWT can still belong to a user that has since been deleted, so
 * `requireUser` asks Auth (`auth.getUser(jwt)`) who the caller is and uses that id for everything.
 * Never trust a user id from the request body.
 *
 * `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform
 * (and by `supabase functions serve`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type Env } from './env.ts';
import { HttpError } from './http.ts';

export type { SupabaseClient };

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Service-role client: bypasses RLS. Only for server-side work on behalf of an already-authenticated user. */
export const adminClient = (env: Env): SupabaseClient =>
  createClient(env.req('SUPABASE_URL'), env.req('SUPABASE_SERVICE_ROLE_KEY'), NO_SESSION);

/** A client that acts as the caller: their JWT is sent to PostgREST, so RLS applies. */
export const userClient = (env: Env, req: Request): SupabaseClient =>
  createClient(env.req('SUPABASE_URL'), env.req('SUPABASE_ANON_KEY'), {
    ...NO_SESSION,
    global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
  });

/** The bearer token of a request, or null. */
export const bearerToken = (req: Request): string | null => {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  return m ? m[1].trim() : null;
};

export interface AuthedUser {
  id: string;
  email: string | null;
}

/** Verify the caller's JWT with Supabase Auth and return their id. 401 `unauthorized` otherwise. */
export const requireUser = async (req: Request, env: Env): Promise<AuthedUser> => {
  const jwt = bearerToken(req);
  if (!jwt) throw new HttpError(401, 'unauthorized', 'Missing bearer token');
  const client = createClient(env.req('SUPABASE_URL'), env.req('SUPABASE_ANON_KEY'), NO_SESSION);
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data?.user) throw new HttpError(401, 'unauthorized', 'Invalid or expired token');
  return { id: data.user.id, email: data.user.email ?? null };
};

/** What every function's `handle(req, deps)` receives; tests replace the pieces. */
export interface BaseDeps {
  env: Env;
  fetch: typeof fetch;
  /** Authenticate the request. */
  auth: (req: Request) => Promise<AuthedUser>;
  /** A service-role client. */
  admin: () => SupabaseClient;
  now: () => Date;
}

/** Production wiring. */
export const defaultDeps = (env: Env): BaseDeps => ({
  env,
  fetch: (input, init) => globalThis.fetch(input, init),
  auth: (req) => requireUser(req, env),
  admin: () => adminClient(env),
  now: () => new Date(),
});
