// account-delete edge function entrypoint (verify_jwt = true, see supabase/config.toml).
import { makeEnv } from '../_shared/env.ts';
import { defaultDeps } from '../_shared/supabase.ts';
import { handle } from './handler.ts';

const deps = defaultDeps(makeEnv());
Deno.serve((req) => handle(req, deps));
