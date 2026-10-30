-- events and event_targets.

-- ------------------------------------------------------------------ events
-- Soft delete (deleted_at) so sync and undo can see deletions. Imported Google events are rows with
-- source = 'google'; is_mine = false marks someone else's event (read-only in the app).
create table public.events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  title            text not null default '',
  category_id      uuid,
  day              date not null,
  -- Minutes past midnight, as the prototype/AI ops: start 0..1439, end > start and at most
  -- start + 1440 (an event may run past midnight; all-day events are 0 .. 1440).
  start_min        integer not null check (start_min between 0 and 1439),
  end_min          integer not null,
  all_day          boolean not null default false,
  days             integer not null default 1 check (days between 1 and 366),
  done             boolean not null default false,
  pauses           jsonb not null default '[]'::jsonb check (jsonb_typeof(pauses) = 'array'),
  win              jsonb check (win is null or jsonb_typeof(win) = 'object'),
  series_id        uuid,
  visibility       text not null default 'private' check (visibility in ('private', 'public')),
  source           text not null default 'app' check (source in ('app', 'google')),
  google_calendar_id uuid,
  google_event_id  text,
  etag             text,
  organizer_email  text,
  is_mine          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  -- The old web app's event id ('e12'), kept so legacy-import is idempotent.
  legacy_id        text,
  check (end_min > start_min and end_min <= start_min + 1440),
  -- App events never carry Google identifiers (their Google copies live in event_targets);
  -- imported events always do.
  check (
    (source = 'app' and google_calendar_id is null and google_event_id is null)
    or (source = 'google' and google_calendar_id is not null and google_event_id is not null)
  ),
  unique (id, user_id),
  unique (google_calendar_id, google_event_id),
  unique (user_id, legacy_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (series_id, user_id) references public.series (id, user_id) on delete set null (series_id),
  -- Disconnecting / deleting a calendar removes the events imported from it.
  foreign key (google_calendar_id, user_id) references public.google_calendars (id, user_id) on delete cascade
);
-- Calendar views: a user's live events by day.
create index events_user_day_idx on public.events (user_id, day) where deleted_at is null;
-- Incremental sync: everything changed since a cursor, deletions included.
create index events_user_updated_idx on public.events (user_id, updated_at);
create index events_series_idx on public.events (series_id) where series_id is not null;
create index events_category_idx on public.events (category_id) where category_id is not null;
-- Fast "is anything public" lookups for publishing.
create index events_public_idx on public.events (user_id) where visibility = 'public' and deleted_at is null;

-- ------------------------------------------------------------ event_targets
-- One row per place a public event is published (a Google calendar, or a phone calendar on one
-- device). Device rows are written only by the device that owns them (client); Google rows only by
-- the service role (google-sync). See the rls migration.
create table public.event_targets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  event_id            uuid not null,
  kind                text not null check (kind in ('google', 'device')),
  google_calendar_id  uuid,
  device_id           text,
  device_calendar_key text,
  external_id         text,
  fingerprint         text,
  status              text not null default 'pending' check (status in ('pending', 'synced', 'failed', 'queued')),
  error               text,
  synced_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (
    (kind = 'google' and google_calendar_id is not null and device_id is null and device_calendar_key is null)
    or (kind = 'device' and device_id is not null and device_calendar_key is not null and google_calendar_id is null)
  ),
  unique (id, user_id),
  -- Full (not partial) unique constraints so `upsert(..., { onConflict })` works; the kind check
  -- above makes the nulls on the other kind's columns keep them from colliding.
  unique (event_id, google_calendar_id),
  unique (event_id, device_id, device_calendar_key),
  foreign key (event_id, user_id) references public.events (id, user_id) on delete cascade,
  foreign key (google_calendar_id, user_id) references public.google_calendars (id, user_id) on delete cascade
);
create index event_targets_event_idx on public.event_targets (event_id);
create index event_targets_calendar_idx on public.event_targets (google_calendar_id, external_id) where kind = 'google';
create index event_targets_user_updated_idx on public.event_targets (user_id, updated_at);
