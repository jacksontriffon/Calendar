-- Core tables (docs/expo-plan.md §4): profiles, categories, goals, series, hidden_items, ai_usage.
--
-- Conventions
--   * Times are floating local time: `day` is a date, `*_min` are minutes past midnight. The user's
--     IANA zone lives on profiles.tz; only the Google sync converts.
--   * Every table has `user_id uuid not null default auth.uid() references auth.users on delete cascade`
--     (profiles uses `id`, which IS the user id).
--   * Tables other tables reference also get `unique (id, user_id)` so children can use a composite
--     FK (id, user_id). That makes it impossible for a row to point at another user's row, even
--     for service-role writes.
--   * RLS, grants and policies are in the `..._rls.sql` migration.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id           uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text,
  avatar_url   text,
  tz           text not null default 'UTC' check (length(tz) between 1 and 64),
  -- view, font, zoom, region/sun, AI toggles: everything the prototype keeps in `aical.v1` except data.
  prefs        jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'One row per user (id = auth.users.id). Created by the on_auth_user_created trigger.';

-- -------------------------------------------------------------- categories
create table public.categories (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  name               text not null check (length(btrim(name)) between 1 and 80),
  -- 0..360 = a hue (snapped to the app's swatches client-side); 1000 = the neutral grey swatch.
  hue                smallint not null check (hue between 0 and 360 or hue = 1000),
  default_visibility text not null default 'private' check (default_visibility in ('private', 'public')),
  -- google_calendars.id values that new public events in this category are published to by default.
  -- (Phone-calendar targets are device-local and are not stored here.) Not FK-enforceable (array).
  default_targets    uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);
create index categories_user_updated_idx on public.categories (user_id, updated_at);

-- ------------------------------------------------------------------- goals
create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 200),
  outcome     text not null default '',
  deadline    date,
  hours       numeric(8, 2) not null default 0 check (hours >= 0),
  hue         smallint not null check (hue between 0 and 360 or hue = 1000),
  category_id uuid,
  start_date  date not null default current_date,
  -- Not in §4: the prototype's goal id (e.g. 'g1'), kept so legacy-import is idempotent.
  legacy_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, legacy_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id)
);
create index goals_user_updated_idx on public.goals (user_id, updated_at);
create index goals_category_idx on public.goals (category_id) where category_id is not null;

-- ------------------------------------------------------------------ series
create table public.series (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  freq       text not null default 'weekly' check (freq in ('weekly')),
  -- 0 = Sunday .. 6 = Saturday (JS Date.getDay()), as the prototype.
  weekdays   smallint[] not null check (
               cardinality(weekdays) between 1 and 7
               and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
             ),
  start_day  date not null,
  "until"    date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ("until" is null or "until" >= start_day),
  unique (id, user_id)
);
create index series_user_updated_idx on public.series (user_id, updated_at);

-- ------------------------------------------------------------ hidden_items
-- "Remove" on someone else's event = insert; "Unhide" = delete.
create table public.hidden_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  source       text not null check (source in ('google', 'device')),
  -- google: a key identifying the Google event; device: opaque to the server.
  external_key text not null check (length(external_key) > 0),
  hidden_at    timestamptz not null default now(),
  unique (user_id, source, external_key)
);

-- ---------------------------------------------------------------- ai_usage
-- One row per user per month; written by ai-schedule (service role), read by the client.
create table public.ai_usage (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  notes      integer not null default 0 check (notes >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
