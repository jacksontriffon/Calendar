-- Support for the Google edge functions (google-connect, google-sync, google-webhook).
--
--   * google_oauth_states      server-side nonce for the OAuth `state` parameter (bound to the user and
--                              the requested return URL, short TTL, single use), plus the two functions
--                              the google-connect function uses to create and consume it.
--   * google_calendars.full_synced_at   when the current sync_token was obtained by a full sync; the
--                              token keeps the time window of that first request, so google-sync does a
--                              fresh full sync every couple of weeks to move the window forward.
--   * event_targets.remove_requested    the client cannot write `google` targets (RLS), so unticking a
--                              calendar in the visibility picker is recorded as a removal request that
--                              google-sync honours (deletes the Google copy, then the row).
--   * set_event_google_targets()        the client-callable way to tick/untick Google calendars for an
--                              event (or "this and all future events" of a series) and to retry failed
--                              targets. It is the only client path that creates `google` targets.
--   * enqueue_publish()                  queue a publish job (service role).
--   * enqueue_import_sweep() (replaced)  also visits calendars that were turned off but still hold
--                              imported events, a sync token or a watch channel, so google-sync can purge
--                              them. (No trigger on google_calendars.show_in_app: the clients call
--                              google-sync "sync_now" after toggling, and the sweep is the fallback.)
--   * a trigger on google_calendars     deleting a calendar drops it from categories.default_targets.

-- ------------------------------------------------------------ oauth state
create table public.google_oauth_states (
  state_hash text primary key check (length(state_hash) = 64),   -- sha256 hex of the random `state`
  user_id    uuid not null references auth.users on delete cascade,
  account_id uuid,                                                -- set for "reconnect"
  return_url text not null check (length(return_url) between 1 and 2000),
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.google_accounts (id, user_id) on delete cascade
);
create index google_oauth_states_expires_idx on public.google_oauth_states (expires_at);
alter table public.google_oauth_states enable row level security;   -- no policies: service role only
revoke all on public.google_oauth_states from anon, authenticated;

-- Store a new state (only its hash). Also sweeps expired rows, so no cron job is needed.
create function public.create_google_oauth_state(
  p_state_hash text,
  p_user_id uuid,
  p_return_url text,
  p_account_id uuid default null,
  p_ttl_seconds integer default 600
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.google_oauth_states where expires_at < now();
  insert into public.google_oauth_states (state_hash, user_id, account_id, return_url, expires_at)
  values (p_state_hash, p_user_id, p_account_id, p_return_url, now() + make_interval(secs => p_ttl_seconds));
end;
$$;

-- Single use: deletes and returns the state if it exists and has not expired.
create function public.consume_google_oauth_state(p_state_hash text)
returns table (user_id uuid, account_id uuid, return_url text)
language sql
security definer
set search_path = ''
as $$
  delete from public.google_oauth_states s
  where s.state_hash = p_state_hash and s.expires_at > now()
  returning s.user_id, s.account_id, s.return_url;
$$;

revoke all on function public.create_google_oauth_state(text, uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.consume_google_oauth_state(text)                           from public, anon, authenticated;
grant execute on function public.create_google_oauth_state(text, uuid, text, uuid, integer) to service_role;
grant execute on function public.consume_google_oauth_state(text)                           to service_role;

-- ------------------------------------------------------- new columns
alter table public.google_calendars add column full_synced_at timestamptz;
alter table public.event_targets add column remove_requested boolean not null default false;

-- Imported events of one calendar by day (full-resync clean-up, purge).
create index events_google_calendar_day_idx on public.events (google_calendar_id, day)
  where source = 'google' and deleted_at is null;

-- Queue a publish job for an event (google-connect after a reconnect; google-sync "Sync now").
create function public.enqueue_publish(p_event_id uuid, p_user_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select pgmq.send('publish', jsonb_build_object('event_id', p_event_id, 'user_id', p_user_id));
$$;
revoke all on function public.enqueue_publish(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_publish(uuid, uuid) to service_role;

-- ----------------------------------------------- import sweep (replaced)
-- Same as the sweep in the queues migration (an import for every calendar shown in the app, on an
-- account that is signed in), plus calendars that were turned off but still have something to clean
-- up: imported events, a sync token or a watch channel. google-sync's import job purges those, so
-- "Show in app" off takes effect within 15 minutes even if the client never calls "Sync now".
create or replace function public.enqueue_import_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  n   integer := 0;
begin
  for rec in
    select c.id
    from public.google_calendars c
    join public.google_accounts a on a.id = c.account_id
    where a.status = 'ok'
      and (
        c.show_in_app
        or c.channel_id is not null
        or c.sync_token is not null
        or exists (select 1 from public.events e where e.google_calendar_id = c.id and e.source = 'google')
      )
  loop
    if public.enqueue_import(rec.id) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- A calendar that goes away (disconnect, or Google no longer lists it) drops off the categories'
-- default publish targets.
create function public.drop_calendar_from_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.categories
     set default_targets = array_remove(default_targets, old.id)
   where user_id = old.user_id and old.id = any (default_targets);
  return null;
end;
$$;

create trigger google_calendars_drop_from_defaults
  after delete on public.google_calendars
  for each row execute function public.drop_calendar_from_defaults();

-- ---------------------------------------------- picking publish targets
-- set_event_google_targets(event, calendars, apply_to_series)
--   Makes `p_calendar_ids` the set of Google calendars the event is published to (when it is public).
--   * new calendars get a `pending` target; unticked ones are deleted if they were never published, or
--     marked remove_requested (google-sync deletes the Google copy, then the row);
--   * re-ticking a calendar that was marked for removal cancels the removal; ticking a `failed` target
--     again is "Retry" (it goes back to `pending`); synced targets are left alone;
--   * p_apply_to_series: the same for every later occurrence of the event's series (the picker's
--     "this and all future events in the series");
--   * every calendar must belong to the caller and be marked Can publish to;
--   * queues one publish job; google-sync decides what to do from the event's visibility, so a private
--     event ends up with nothing on Google.
-- Imported (source = 'google') events cannot be published. SECURITY DEFINER because `google` targets
-- are not client-writable; every row it touches is checked against auth.uid().
create function public.set_event_google_targets(
  p_event_id uuid,
  p_calendar_ids uuid[],
  p_apply_to_series boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ev  record;
  v_ids uuid[];
  e     record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select id, series_id, day, source into v_ev
  from public.events where id = p_event_id and user_id = v_uid;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if v_ev.source <> 'app' then
    raise exception 'only your own events can be published' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct c), '{}') into v_ids from unnest(coalesce(p_calendar_ids, '{}')) c;
  if exists (
    select 1 from unnest(v_ids) c(id)
    where not exists (
      select 1 from public.google_calendars g
      where g.id = c.id and g.user_id = v_uid and g.can_publish
    )
  ) then
    raise exception 'calendar not found or not marked Can publish to' using errcode = '22023';
  end if;

  for e in
    select id from public.events
    where user_id = v_uid and source = 'app' and deleted_at is null
      and (id = p_event_id
           or (p_apply_to_series and v_ev.series_id is not null and series_id = v_ev.series_id and day >= v_ev.day))
  loop
    insert into public.event_targets as t (user_id, event_id, kind, google_calendar_id)
    select v_uid, e.id, 'google', c from unnest(v_ids) c
    on conflict (event_id, google_calendar_id) do update
      set remove_requested = false,
          status = case when t.remove_requested or t.status = 'failed' then 'pending' else t.status end,
          error  = case when t.remove_requested or t.status = 'failed' then null else t.error end;

    delete from public.event_targets
    where event_id = e.id and kind = 'google' and external_id is null
      and not (google_calendar_id = any (v_ids));

    update public.event_targets
       set remove_requested = true, status = 'pending', error = null
     where event_id = e.id and kind = 'google' and external_id is not null
       and not (google_calendar_id = any (v_ids))
       and not remove_requested;
  end loop;

  perform pgmq.send('publish', jsonb_build_object('event_id', p_event_id, 'user_id', v_uid));
end;
$$;

revoke all on function public.set_event_google_targets(uuid, uuid[], boolean) from public, anon;
grant execute on function public.set_event_google_targets(uuid, uuid[], boolean) to authenticated, service_role;

revoke all on function public.drop_calendar_from_defaults() from public, anon, authenticated;
revoke all on function public.enqueue_import_sweep()        from public, anon, authenticated;
grant execute on function public.enqueue_import_sweep()     to service_role;
