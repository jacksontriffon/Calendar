-- Google tables: google_accounts, google_calendars.
-- (event_targets, which references google_calendars, is created with events.)

-- ----------------------------------------------------------- google_accounts
-- The refresh token lives in Supabase Vault (vault.secrets), never in this table. The edge
-- functions read/write it through set_google_refresh_token()/get_google_refresh_token()
-- (queues migration). Clients read the `google_accounts_public` view; see the rls migration for
-- the column-level grants that keep refresh_token_id away from them.
create table public.google_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  email            text not null check (length(email) > 0),
  status           text not null default 'ok' check (status in ('ok', 'needs_signin')),
  refresh_token_id uuid references vault.secrets (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, email),
  unique (id, user_id)
);
create index google_accounts_user_idx on public.google_accounts (user_id);

-- Client-facing view: everything except refresh_token_id. security_invoker => the caller's RLS and
-- column privileges on the base table apply.
create view public.google_accounts_public
  with (security_invoker = true)
as
  select id, user_id, email, status, created_at, updated_at
  from public.google_accounts;

-- ---------------------------------------------------------- google_calendars
create table public.google_calendars (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  account_id          uuid not null,
  google_id           text not null check (length(google_id) > 0),
  name                text not null default '',
  color               text,
  access_role         text not null default 'reader'
                        check (access_role in ('freeBusyReader', 'reader', 'writer', 'owner')),
  is_primary          boolean not null default false,
  shared              boolean not null default false,
  show_in_app         boolean not null default false,
  can_publish         boolean not null default false,
  sync_token          text,
  channel_id          text,
  -- Not in §4: Google's channel resourceId, needed to stop a watch channel when renewing it.
  channel_resource_id text,
  channel_expires_at  timestamptz,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Can only publish into calendars the user can write to.
  check (not can_publish or access_role in ('writer', 'owner')),
  unique (account_id, google_id),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.google_accounts (id, user_id) on delete cascade
);
create index google_calendars_user_idx on public.google_calendars (user_id);
create index google_calendars_updated_idx on public.google_calendars (user_id, updated_at);
create unique index google_calendars_channel_id_key on public.google_calendars (channel_id) where channel_id is not null;
-- Watch-channel renewal sweep.
create index google_calendars_channel_expiry_idx on public.google_calendars (channel_expires_at) where show_in_app;
