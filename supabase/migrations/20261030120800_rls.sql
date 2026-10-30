-- Row Level Security, grants and policies.
--
-- Model: the client (role `authenticated`) reads and writes its own rows through supabase-js; every
-- policy is `user_id = (select auth.uid())` (profiles: `id`). `anon` gets nothing. The service role
-- bypasses RLS (edge functions, cron).
--
-- Supabase's default privileges grant ALL on new public tables to anon/authenticated/service_role, so
-- each table below first revokes everything from anon + authenticated and then grants back exactly
-- what the client may do. Where a table is service-role-write-only we also have no write policy.

-- Start from nothing for anon on every table/view in this migration set.
revoke all on
  public.profiles, public.categories, public.goals, public.series, public.events,
  public.hidden_items, public.google_accounts, public.google_accounts_public,
  public.google_calendars, public.event_targets, public.ai_usage,
  public.legacy_calendar_blobs, public.gcal_links, public.calendars
from anon;

revoke all on
  public.profiles, public.categories, public.goals, public.series, public.events,
  public.hidden_items, public.google_accounts, public.google_accounts_public,
  public.google_calendars, public.event_targets, public.ai_usage,
  public.legacy_calendar_blobs, public.gcal_links, public.calendars
from authenticated;

alter table public.profiles              enable row level security;
alter table public.categories            enable row level security;
alter table public.goals                 enable row level security;
alter table public.series                enable row level security;
alter table public.events                enable row level security;
alter table public.hidden_items          enable row level security;
alter table public.google_accounts       enable row level security;
alter table public.google_calendars      enable row level security;
alter table public.event_targets         enable row level security;
alter table public.ai_usage              enable row level security;
alter table public.legacy_calendar_blobs enable row level security;
alter table public.gcal_links            enable row level security;

-- ---------------------------------------------------------------- profiles
-- Created by the new-user trigger. The client may read and edit its profile (and re-create it if
-- ever missing) but not delete it: it goes away with the account (account-delete).
grant select, insert, update on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ------------------------------------------- categories, goals, series, hidden_items
grant select, insert, update, delete on public.categories, public.goals, public.series, public.hidden_items to authenticated;

create policy categories_select_own on public.categories for select to authenticated using (user_id = (select auth.uid()));
create policy categories_insert_own on public.categories for insert to authenticated with check (user_id = (select auth.uid()));
create policy categories_update_own on public.categories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy categories_delete_own on public.categories for delete to authenticated using (user_id = (select auth.uid()));

create policy goals_select_own on public.goals for select to authenticated using (user_id = (select auth.uid()));
create policy goals_insert_own on public.goals for insert to authenticated with check (user_id = (select auth.uid()));
create policy goals_update_own on public.goals for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goals_delete_own on public.goals for delete to authenticated using (user_id = (select auth.uid()));

create policy series_select_own on public.series for select to authenticated using (user_id = (select auth.uid()));
create policy series_insert_own on public.series for insert to authenticated with check (user_id = (select auth.uid()));
create policy series_update_own on public.series for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy series_delete_own on public.series for delete to authenticated using (user_id = (select auth.uid()));

create policy hidden_items_select_own on public.hidden_items for select to authenticated using (user_id = (select auth.uid()));
create policy hidden_items_insert_own on public.hidden_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy hidden_items_update_own on public.hidden_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy hidden_items_delete_own on public.hidden_items for delete to authenticated using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ events
-- Clients create app events only; imported Google events (source = 'google') are written by
-- google-sync. Updates/deletes apply to any of the user's own rows (soft delete = update).
grant select, insert, update, delete on public.events to authenticated;
create policy events_select_own on public.events for select to authenticated using (user_id = (select auth.uid()));
create policy events_insert_own on public.events for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'app');
create policy events_update_own on public.events for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy events_delete_own on public.events for delete to authenticated using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ google
-- google_accounts: the refresh token pointer is never visible to clients. Column-level SELECT grant
-- (everything except refresh_token_id), so `select refresh_token_id` and `select *` on the base table
-- fail with "permission denied"; clients read the security_invoker view google_accounts_public.
-- No client writes: connect/disconnect/reconnect go through the google-connect edge function.
grant select (id, user_id, email, status, created_at, updated_at) on public.google_accounts to authenticated;
grant select on public.google_accounts_public to authenticated;
create policy google_accounts_select_own on public.google_accounts for select to authenticated
  using (user_id = (select auth.uid()));

-- google_calendars: the client may read its rows and flip the two toggles, nothing else.
-- Inserts/deletes (listing calendars on connect, disconnect) and every other column are service role only.
grant select on public.google_calendars to authenticated;
grant update (show_in_app, can_publish) on public.google_calendars to authenticated;
create policy google_calendars_select_own on public.google_calendars for select to authenticated
  using (user_id = (select auth.uid()));
create policy google_calendars_update_own on public.google_calendars for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- event_targets: the client reads all its targets, and writes only `device` rows (phone-calendar
-- publishing happens on the device). `google` rows are service role only. The composite FKs
-- guarantee the event belongs to the same user_id, so user_id = auth.uid() covers the parent event's owner.
grant select, insert, update, delete on public.event_targets to authenticated;
create policy event_targets_select_own on public.event_targets for select to authenticated
  using (user_id = (select auth.uid()));
create policy event_targets_insert_own_device on public.event_targets for insert to authenticated
  with check (user_id = (select auth.uid()) and kind = 'device');
create policy event_targets_update_own_device on public.event_targets for update to authenticated
  using (user_id = (select auth.uid()) and kind = 'device')
  with check (user_id = (select auth.uid()) and kind = 'device');
create policy event_targets_delete_own_device on public.event_targets for delete to authenticated
  using (user_id = (select auth.uid()) and kind = 'device');

-- ---------------------------------------------------------------- ai_usage
-- Feeds the usage indicator; written only by ai-schedule (service role).
grant select on public.ai_usage to authenticated;
create policy ai_usage_select_own on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ legacy
-- legacy_calendar_blobs: own rows, full CRUD (the live legacy web app writes through the
-- public.calendars compatibility view until cutover). gcal_links: read-only for clients (the old
-- gcal edge function wrote it with the service role).
grant select, insert, update, delete on public.legacy_calendar_blobs to authenticated;
grant select, insert, update, delete on public.calendars to authenticated;
grant select on public.gcal_links to authenticated;

drop policy if exists legacy_calendar_blobs_select_own on public.legacy_calendar_blobs;
drop policy if exists legacy_calendar_blobs_insert_own on public.legacy_calendar_blobs;
drop policy if exists legacy_calendar_blobs_update_own on public.legacy_calendar_blobs;
drop policy if exists legacy_calendar_blobs_delete_own on public.legacy_calendar_blobs;
create policy legacy_calendar_blobs_select_own on public.legacy_calendar_blobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy legacy_calendar_blobs_insert_own on public.legacy_calendar_blobs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy legacy_calendar_blobs_update_own on public.legacy_calendar_blobs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy legacy_calendar_blobs_delete_own on public.legacy_calendar_blobs for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists gcal_links_select_own on public.gcal_links;
create policy gcal_links_select_own on public.gcal_links for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- realtime
-- Cross-device sync (Legend-State uses Supabase Realtime). google_accounts is deliberately absent.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.profiles, public.categories, public.goals, public.series, public.events,
      public.hidden_items, public.google_calendars, public.event_targets, public.ai_usage;
  end if;
end
$$;
