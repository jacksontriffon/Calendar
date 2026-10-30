-- Extensions used by the Calendar backend.
--
-- All of these ship with Supabase (local stack and hosted). The no-Docker local test runner
-- (tests/local/run.sh) skips this file and provides stub schemas instead (tests/local/shim.sql).

-- Vault: encrypted secrets (Google refresh tokens, and the project_url / service_role_key
-- secrets the pg_cron jobs read). Already installed on hosted projects; harmless if so.
create extension if not exists supabase_vault;

-- pg_net: async HTTP from SQL (net.http_post). Functions live in the `net` schema.
create extension if not exists pg_net with schema extensions;

-- pgmq: Postgres message queue (schema `pgmq`).
create extension if not exists pgmq;

-- pg_cron: scheduler (schema `cron`).
create extension if not exists pg_cron with schema pg_catalog;
