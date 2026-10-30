/**
 * Environment and wiring for the Google functions. Secrets are documented in README.md next to
 * this file. Nothing here runs at import time, so tests can import the rest of the module freely.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GoogleApi } from './api.ts';
import type { ConnectDeps } from './connect.ts';
import { supabaseDb } from './db.ts';
import type { GoogleDb } from './db.ts';
import type { SyncDeps } from './deps.ts';
import { HttpError } from './http.ts';
import { parseReturnUrls } from './state.ts';
import { AccessTokens } from './tokens.ts';

type Getenv = (name: string) => string | undefined;
const denoEnv: Getenv = (n) => Deno.env.get(n);

export class MissingEnvError extends HttpError {
  constructor(name: string) {
    super(500, `server is not configured: ${name} is not set`, 'missing_env');
  }
}

const need = (get: Getenv, name: string): string => {
  const v = get(name);
  if (!v) throw new MissingEnvError(name);
  return v;
};

export const supabaseUrl = (get: Getenv = denoEnv): string => need(get, 'SUPABASE_URL');
export const serviceRoleKey = (get: Getenv = denoEnv): string => need(get, 'SUPABASE_SERVICE_ROLE_KEY');
export const webhookSecret = (get: Getenv = denoEnv): string => need(get, 'GOOGLE_WEBHOOK_SECRET');

/** The public URL Google calls with push notifications. */
export const webhookUrl = (get: Getenv = denoEnv): string =>
  get('GOOGLE_WEBHOOK_URL') || `${supabaseUrl(get).replace(/\/$/, '')}/functions/v1/google-webhook`;

export const adminClient = (get: Getenv = denoEnv): SupabaseClient =>
  createClient(supabaseUrl(get), serviceRoleKey(get), { auth: { persistSession: false, autoRefreshToken: false } });

export const googleApi = (get: Getenv = denoEnv): GoogleApi =>
  new GoogleApi({
    clientId: need(get, 'GOOGLE_CLIENT_ID'),
    clientSecret: need(get, 'GOOGLE_CLIENT_SECRET'),
    redirectUri: need(get, 'GOOGLE_REDIRECT_URI'),
  });

const log = (msg: string, extra?: unknown) => console.log(extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`);

/** Resolves a user JWT to the user id (null if invalid). */
export const userResolver = (admin: SupabaseClient) => async (jwt: string): Promise<string | null> => {
  const { data, error } = await admin.auth.getUser(jwt);
  return error || !data.user ? null : data.user.id;
};

export const connectDeps = (get: Getenv = denoEnv): { deps: ConnectDeps; admin: SupabaseClient } => {
  const admin = adminClient(get);
  const db = supabaseDb(admin);
  const api = googleApi(get);
  return {
    admin,
    deps: {
      db, api, tokens: new AccessTokens(db, api), log,
      returnUrls: parseReturnUrls(need(get, 'GOOGLE_RETURN_URLS')),
    },
  };
};

export const syncDeps = (get: Getenv = denoEnv): { deps: SyncDeps; admin: SupabaseClient; db: GoogleDb } => {
  const admin = adminClient(get);
  const db = supabaseDb(admin);
  const api = googleApi(get);
  return {
    admin, db,
    deps: {
      db, api, tokens: new AccessTokens(db, api), now: Date.now, log,
      webhookUrl: webhookUrl(get), webhookSecret: webhookSecret(get),
    },
  };
};
