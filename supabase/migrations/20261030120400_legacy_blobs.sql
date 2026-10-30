-- Legacy tables from the old single-file web app (index.html + the `gcal` edge function).
--
-- ASSUMPTIONS (supabase.sql is not in this repo; reconstructed from index.html, which upserts
-- `rest/v1/calendars?on_conflict=user_id` and selects `data,updated_at` by `user_id`):
--   calendars(user_id uuid primary key -> auth.users, data jsonb, updated_at timestamptz)
--       one JSON blob row per user holding the whole calendar.
--   gcal_links(user_id uuid primary key -> auth.users, map jsonb, updated_at timestamptz)
--       the old Google sync's { app event id -> google event id } map.
-- Both are created `if not exists`, so this migration works on a fresh database (where they are
-- empty) and on the live project (where they already exist and keep their data and any extra
-- columns, e.g. an `id`). Existing policies on the live tables are left alone; the policies added
-- here are idempotent.
--
-- `calendars` is then renamed to `legacy_calendar_blobs`. legacy-import reads it once per user;
-- it is dropped after the import window (Phase 8). gcal_links keeps its name; legacy-import maps
-- its entries to event_targets.

create table if not exists public.calendars (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.gcal_links (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  map        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.legacy_calendar_blobs') is null then
    alter table public.calendars rename to legacy_calendar_blobs;
  elsif to_regclass('public.calendars') is not null then
    raise notice 'both public.calendars and public.legacy_calendar_blobs exist; leaving both as they are';
  end if;
end
$$;

-- Compatibility shim: the live legacy web app (index.html) talks to `calendars` through PostgREST
-- until the Phase 8 cutover. This auto-updatable, security_invoker view keeps it working (select,
-- insert, `on_conflict=user_id` upsert, update, delete) against the renamed table. Drop it,
-- together with legacy_calendar_blobs, at cutover.
do $$
begin
  if to_regclass('public.calendars') is null then
    create view public.calendars with (security_invoker = true) as
      select * from public.legacy_calendar_blobs;
  end if;
end
$$;

comment on table public.legacy_calendar_blobs is 'The old web app''s one-JSON-row-per-user calendars table (renamed). Read once by legacy-import, dropped after the import window.';
comment on table public.gcal_links is 'The old web app''s Google sync map. Read by legacy-import; dropped with legacy_calendar_blobs.';
