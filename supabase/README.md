# Supabase backend

Database layer for the Expo + Supabase rebuild (see `docs/expo-plan.md` §2, §4, §5 and Phase 1): schema, Row Level Security, Vault, pgmq queues, pg_cron jobs, seed data and tests. Edge functions live in `supabase/functions/` (see [Edge functions](#edge-functions)).

## Layout

```
supabase/
  config.toml            project_id "calendar"; Apple + Google auth, aicalendar:// and localhost:8081 redirects
  .env.example           the env vars config.toml reads for the auth providers
  migrations/            timestamped SQL, applied in order (see below)
  seed.sql               test user + sample calendar (prototype data)
  functions/             edge functions (Deno): ai-schedule, account-delete, legacy-import, _shared/; deno.json import map, sync-core.sh
  tests/
    database/            pgTAP tests (`supabase test db`); also run by the no-Docker runner
    local/               no-Docker test runner: shim.sql (stubs + mini pgTAP), run.sh, stub-only tests
packages/db/             @calendar/db: generated TypeScript types + shared aliases
```

| Migration | Contents |
|---|---|
| `20261030120000_extensions` | `supabase_vault`, `pg_net`, `pgmq`, `pg_cron` |
| `20261030120100_core_tables` | `profiles`, `categories`, `goals`, `series`, `hidden_items`, `ai_usage` |
| `20261030120200_google_tables` | `google_accounts` (+ `google_accounts_public` view), `google_calendars` |
| `20261030120300_events` | `events`, `event_targets` |
| `20261030120400_legacy_blobs` | legacy `calendars` -> `legacy_calendar_blobs`, `gcal_links`, `calendars` compatibility view |
| `20261030120500_triggers` | `updated_at` bump, publish-queue trigger, new-user trigger |
| `20261030120600_queues` | pgmq queues, `sync_locks` + `try_sync_lock`, Vault token helpers, cron job functions |
| `20261030120700_cron` | the three pg_cron jobs |
| `20261030120800_rls` | RLS, grants, policies, Realtime publication |
| `20261031100000_ai_limits_and_import` | `ai_calls` + `ai_claim()`/`ai_refund()` (ai-schedule allowance and rate limit), `series.legacy_id` |

### Data model notes

- Every table has `user_id uuid not null default auth.uid() references auth.users on delete cascade` (`profiles` uses `id`, which is the user id). Tables that others reference have `unique (id, user_id)` and the children use composite foreign keys `(x_id, user_id)`, so a row can never point at another user's row, whoever writes it.
- Times are floating local time: `day` + `start_min` / `end_min` (minutes past midnight; `start_min` 0..1439, `end_min` in `start_min+1 .. start_min+1440`, so events may run past midnight and all-day events are `0..1440`).
- `events` are soft-deleted (`deleted_at`). The publish trigger runs on insert/update, so an unpublish job is queued when a public event is soft-deleted. Hard deletes cascade to `event_targets` and are not queued.
- Extras beyond the plan's §4 column lists: `goals.legacy_id` (idempotent legacy import), `google_calendars.channel_resource_id` (needed to stop a Google watch channel), `created_at`/`updated_at` columns, and the internal `sync_locks` table.

### Who can do what (summary)

| Table | `authenticated` (client) | service role |
|---|---|---|
| `profiles` | select, insert, update own | all |
| `categories`, `goals`, `series`, `hidden_items` | full CRUD on own rows | all |
| `events` | select, update, delete own; insert own with `source = 'app'` | all (imported events: `source = 'google'`) |
| `google_accounts` | select own, every column except `refresh_token_id`; use the `google_accounts_public` view | all |
| `google_calendars` | select own; update only `show_in_app`, `can_publish` | all (insert/delete/other columns) |
| `event_targets` | select own; insert/update/delete own `kind = 'device'` rows | all (`kind = 'google'` rows) |
| `ai_usage` | select own | all |
| `legacy_calendar_blobs` | full CRUD on own row (the old web app still writes through the `calendars` view) | all |
| `gcal_links` | select own | all |

`anon` has no access to any table. The queue/cron/Vault helper functions are not callable by clients; edge functions (service role) may call `try_sync_lock`, `release_sync_lock`, `queue_ack`, `enqueue_import`, `set_google_refresh_token`, `get_google_refresh_token`.

## Run it locally (with Docker)

```sh
supabase start                 # local stack; reads supabase/.env.local for the auth provider secrets
supabase db reset              # applies migrations/ then seed.sql
supabase test db               # runs tests/database/*.sql with pgTAP
```

`config.toml` enables Apple and Google sign-in with `env(...)` secrets. Copy `supabase/.env.example` to `supabase/.env.local` (git-ignored) and fill in values (dummy values are fine for local DB work; real ones are only needed to actually sign in with the providers). If your CLI version does not load that file, export the variables in your shell instead.

Seed user: `test@example.com` / `password123` (id `00000000-0000-4000-8000-0000000000a1`), with the prototype's goals, series and sample events (dates are relative to the day you reset the database).

`supabase test db` recurses through `supabase/tests`. The files under `tests/local/` detect that they are running on a real stack and report themselves as skipped.

## Run the tests without Docker

No Docker, CLI or extensions needed, only a local PostgreSQL 15+ (the stubs are in `tests/local/shim.sql`):

```sh
supabase/tests/local/run.sh
```

It creates a scratch database (`calendar_test`, recreated every run), applies `shim.sql` (roles `anon`/`authenticated`/`service_role`, a stub `auth` schema with `auth.uid()` reading `request.jwt.claims`, stub `pgmq`, `cron`, `vault` and `net` schemas, and a small pgTAP-compatible assertion library), then every migration except `*_extensions.sql` (the shim stands in for those extensions), `seed.sql`, and finally every test file. As root it talks to the cluster as the `postgres` OS user and starts/stops the first cluster from `pg_lsclusters` if none is running; otherwise it uses the usual `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`. Set `DB_NAME` to change the scratch database name.

The same `tests/database/*.sql` files run in both modes: in the shim they use its `plan/ok/is/throws_ok/lives_ok/finish`; on a real stack they use pgTAP. Keep to those functions (and to `throws_ok(sql, sqlstate, errmsg-or-null, description)`) when adding tests. What the stubs do **not** cover, and so is only exercised on a real stack: the real extensions (`create extension` in the first migration), real Vault encryption and its privileges, real `pg_net`/`pg_cron` scheduling, and the Docker-only parts of `supabase start`.

## Vault secrets

Create these once per project (SQL editor or `psql`), as the `postgres` role. The pg_cron jobs read them with `vault.decrypted_secrets`; **until both exist the jobs do nothing and jobs stay queued**.

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service role key>',                 'service_role_key');
-- local stack: project_url = http://host.docker.internal:54321, key from `supabase status`
```

To rotate one: `select vault.update_secret(id, '<new value>') from vault.secrets where name = 'service_role_key';`

The Google refresh tokens are Vault secrets named `google_refresh_token:<google_accounts.id>`; edge functions store and read them with `rpc('set_google_refresh_token', { p_account_id, p_token })` and `rpc('get_google_refresh_token', { p_account_id })`. Deleting a `google_accounts` row (disconnect, account deletion) deletes its secret.

The service-role key is sent as `Authorization: Bearer <key>`. If you move to Supabase's new `sb_secret_...` keys, those are not JWTs: deploy `google-sync` with JWT verification off and have it check the key itself.

## Queue and cron contract (for `google-sync`)

Queues (pgmq): `publish` `{"event_id","user_id"}` (written by a trigger on `events`) and `import` `{"calendar_id","user_id"}` (`rpc('enqueue_import', { p_calendar_id })`, used by `google-webhook`, the sweep and "Sync now").

| Job | Schedule | Does |
|---|---|---|
| `calendar-queue-consumer` | every minute | `run_queue_consumer()`: claims up to 50 messages per queue (visibility timeout 120 s), archives messages read more than 5 times, and POSTs the rest to `<project_url>/functions/v1/google-sync` |
| `calendar-import-sweep` | every 15 min | `enqueue_import_sweep()`: queues an import for every calendar with `show_in_app` on an account with `status = 'ok'` (skips ones already waiting) |
| `calendar-watch-renewal` | daily 03:17 UTC | `renew_watch_channels()`: POSTs the calendars with `show_in_app` and no channel, or one expiring within 2 days |

Request bodies sent to `google-sync`:

```jsonc
{ "action": "drain", "queue": "publish" | "import",
  "jobs": [ { "msg_id": 12, "attempt": 1, "payload": { /* the message */ } } ] }
{ "action": "renew_watch", "calendars": [ { "id": "<google_calendars.id>", "user_id": "<uuid>" } ] }
```

For each job `google-sync` should: `rpc('try_sync_lock', { p_user_id })` (a 120 s lease row in `sync_locks`, because session-level advisory locks don't survive PostgREST/pooled connections); skip the job if it returns `false` (it reappears after the visibility timeout); do the work; `rpc('release_sync_lock', { p_user_id })`; then `rpc('queue_ack', { p_queue, p_msg_ids: [msg_id, ...] })`. Un-acked jobs are retried; after 5 reads they go to `pgmq.a_<queue>`. `pg_net` is fire-and-forget, so the consumer never learns the HTTP result; acknowledgement is the function's job.

## Edge functions

`supabase/functions/` (Deno). Each function has an `index.ts` (`Deno.serve`) and a `handler.ts` (`handle(req, deps)`, where the tests inject a fake Anthropic, Google and database).

| Function | What it does |
|---|---|
| `ai-schedule` | `POST { mode: 'note'\|'adjust'\|'checkin', note?, goalId?, adjustMode?, noAsk?, lastSeen?, today, nowMin, tz, data: { events, cats, goals } }`. Builds the prompt with core's `prompts.ts`, runs the skill (`calendar-scheduler` / `calendar-goal-adjust` / `calendar-checkin`), the core code validator (`checkOps` / `checkCi`) and one `calendar-verifier` fix round, and returns `{ ok, ops, verified, issues, model, transport, usage: { used, limit, resetsOn } }`. The client applies the ops. Errors: 400-class codes for bad input (`bad_mode`, `bad_today`, `bad_now`, `bad_tz`, `bad_note`, `bad_data`, `bad_goal`, `bad_adjust_mode`, `too_large`), `429 { error: 'limit', used, limit, resetsOn }` at the monthly allowance, `429 { error: 'rate_limit', retryAfter }`, `502/503/504` for provider failures and unusable replies (the note is refunded). |
| `account-delete` | Revokes each Google refresh token (`oauth2.googleapis.com/revoke`), deletes the `google_accounts` rows (the trigger deletes their Vault secrets), then `auth.admin.deleteUser`; everything else cascades. Returns `{ ok: true }`. |
| `legacy-import` | One-time, idempotent copy of `legacy_calendar_blobs.data` into `categories` (reused by name), `goals`, `series`, `events` and the old Google links as `event_targets` (onto the primary Google calendar, if connected). Returns `{ status: 'none' }` or `{ status: 'done', events, goals, categories, series, targets, skipped, ... }`; on a failure `{ error: 'import_failed', stage }`, and a retry finishes the job. Never overwrites rows, so edits made in the app survive a re-run. |

`ai-schedule` deviates from the plan's "context from the user's rows": the client sends its own `CalendarData` snapshot, so the prompt matches the local-first data the ops will be applied to. The snapshot is capped (1 MB body, 5000 events, 200 goals, 200 categories, 4000-character note), validated and whitelisted field by field.

### Using `packages/core` from the functions

The functions import `@calendar/core` through the import map in `supabase/functions/deno.json`, which points at `_shared/core/`, **a git-ignored copy of `packages/core/src`** made by:

```sh
supabase/functions/sync-core.sh        # copies packages/core/src -> _shared/core, generates _shared/skills.generated.ts from skills/
```

Run it before `supabase functions serve`, `supabase functions deploy` and the Deno tests, and again when `packages/core` or `skills/` change. Why a copy and not `../../packages/core/src` in the import map: the Supabase CLI documents import maps and shared code only inside `supabase/functions` (per-function `deno.json`, `_shared/`), and nothing in its documentation says that `functions deploy` (Docker bundling or `--use-api`) bundles files from outside that directory. That can only be confirmed by deploying, so we don't depend on it. The same script generates the skill files the inline transport sends in its prompt, since the bundle can't read `../../skills` at runtime. The `[functions.*]` entries in `config.toml` set `verify_jwt = true` and `import_map = "./functions/deno.json"` for these three functions.

### Edge function secrets

Set with `supabase secrets set NAME=value` (locally: `supabase functions serve --env-file supabase/functions/.env`, see `supabase/functions/.env.example`). `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform. A missing required secret gives a `500 { error: 'server_config', message }` that names it; `ai-schedule` checks before counting anything.

| Secret | Function | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ai-schedule | required | Anthropic key (never in the app) |
| `AI_MODEL` | ai-schedule | `claude-haiku-4-5` (the prototype's default) | model for both passes |
| `AI_MONTHLY_LIMIT` | ai-schedule | `200` | notes per user per UTC month (open question 1); at the limit the function answers 429 and the app falls back to the offline parser |
| `AI_PER_MINUTE` | ai-schedule | `6` | calls per user per minute |
| `SKILL_ID_CALENDAR_SCHEDULER`, `SKILL_ID_CALENDAR_GOAL_ADJUST`, `SKILL_ID_CALENDAR_CHECKIN`, `SKILL_ID_CALENDAR_VERIFIER` | ai-schedule | unset | uploaded skill ids; with all four set the function uses the Skills API + code execution (`skills` transport), otherwise it puts the skill files in the system prompt (`inline`) |
| `AI_TRANSPORT` | ai-schedule | auto | force `inline` or `skills` |
| `AI_TIMEOUT_MS`, `AI_MAX_BODY_BYTES`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_BETA` | ai-schedule | 60000, 1000000, api.anthropic.com, code-execution + skills betas | tuning |

Upload the skills once per deploy (and after editing `skills/`); no Supabase access needed:

```sh
ANTHROPIC_API_KEY=sk-ant-... deno run --allow-read --allow-net --allow-env supabase/functions/ai-schedule/upload-skills.ts
# prints:  supabase secrets set SKILL_ID_CALENDAR_SCHEDULER=skill_... SKILL_ID_CALENDAR_GOAL_ADJUST=... (run it)
```

The allowance and rate limit are decided in Postgres by `ai_claim(user, limit, per_minute)`: one atomic call that takes a per-user lock, checks the month's `ai_usage.notes` and a sliding one-minute window (`ai_calls`), and records the call. `ai_refund(user)` gives a note back when the provider failed. Every accepted call counts, including check-ins. The month is the UTC month, and `resetsOn` is the 1st of the next one.

### Testing the functions

```sh
pnpm test:functions        # sync-core.sh, then deno check on every entrypoint, then deno test (needs network once for npm/jsr deps)
# or by hand:
supabase/functions/sync-core.sh && cd supabase/functions && deno check */index.ts && deno test --allow-read
```

The tests mock `fetch` (Anthropic, Google) and use an in-memory stand-in for the Supabase admin client (`_shared/testing/`), so they need no network, Docker or project. `ai_claim` itself is tested in SQL (`tests/database/05_ai_limits.test.sql`), and the row shapes `legacy-import` writes are checked against the real tables in `06_legacy_import_rows.test.sql`.

## Regenerating the TypeScript types

`packages/db/src/database.types.ts` is generated by the Supabase CLI from the migrated database and formatted with `oxfmt`. With the local stack running:

```sh
pnpm --filter @calendar/db gen          # supabase gen types typescript --local ... > src/database.types.ts
pnpm --filter @calendar/db typecheck
```

Without Docker, point it at any Postgres that has the migrations applied (for example the scratch database from the no-Docker runner, after `run.sh`, with the cluster running):

```sh
npx -y supabase@latest gen types typescript --db-url postgresql://postgres:postgres@127.0.0.1:5432/calendar_test --schema public > packages/db/src/database.types.ts
npx -y oxfmt packages/db/src/database.types.ts
```

The generator lists every table and function in `public`, including service-role-only ones (`google_accounts` with `refresh_token_id`, `sync_locks`, the queue helpers). Client code should use `google_accounts_public` and ignore the rest; `@calendar/db` re-exports ready-made aliases.

## Legacy tables

`supabase.sql` isn't in this repo, so `20261030120400_legacy_blobs` reconstructs the old schema from what `index.html` calls (`rest/v1/calendars?on_conflict=user_id`, `select=data,updated_at`):

- `calendars(user_id uuid primary key, data jsonb, updated_at timestamptz)`, one JSON blob per user; the migration does `create table if not exists`, then renames it to `legacy_calendar_blobs`. On the live project the existing table (and any extra columns, such as an `id`) is renamed in place.
- `gcal_links(user_id uuid primary key, map jsonb, updated_at timestamptz)`, `create table if not exists`, keeps its name.
- Because the live legacy web app keeps calling `rest/v1/calendars` until the Phase 8 cutover, the migration adds an auto-updatable `security_invoker` view `public.calendars` over `legacy_calendar_blobs` (select/insert/upsert/update/delete work through it). Drop it with `legacy_calendar_blobs` after the import window.

## Linking the live project

Nothing here is linked to a remote project; the CLI is only ever pointed at the local stack. Whether to reuse the live project `rsojhermvtxxizwxaina` or start a fresh one is open question 9 in the plan. Once decided:

```sh
supabase login
supabase link --project-ref <project-ref>     # rsojhermvtxxizwxaina if reusing the live project
supabase db push --dry-run                    # review first
supabase db push
```

If reusing the live project: check `supabase migration list` first, because that project's migration history may not match this directory (the legacy tables were probably created by hand from `supabase.sql`). The legacy-blobs migration is written to run against it (verified against a simulated live database: existing rows, extra columns and policies on `calendars` are kept). Back up `calendars` and `gcal_links` before pushing, since `20261030120400_legacy_blobs` renames `calendars`. Then create the Vault secrets above, enable the Apple and Google providers (and add `aicalendar://**` and the web origin to the redirect URLs) in the dashboard, since `config.toml` only configures the local stack unless you run `supabase config push`.
