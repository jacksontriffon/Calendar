-- Queues (pgmq), the per-user sync lock, Vault helpers for Google tokens, and the functions the
-- pg_cron jobs (next migration) run.
--
-- Queues
--   publish  {"event_id": uuid, "user_id": uuid}      written by the events trigger
--   import   {"calendar_id": uuid, "user_id": uuid}   written by google-webhook (enqueue_import) and the 15-min sweep
--
-- Delivery is at-least-once. The consumer (run_queue_consumer, every minute) reads a batch with a
-- visibility timeout and POSTs it to the google-sync edge function; google-sync takes the per-user
-- lock (try_sync_lock), does the work and then acknowledges with queue_ack(). Messages that are
-- not acknowledged reappear when the visibility timeout expires, and are archived after
-- max_attempts reads.
--
-- Vault secrets the cron jobs need (create once per project; see supabase/README.md):
--   project_url        e.g. https://<ref>.supabase.co   (local: http://host.docker.internal:54321)
--   service_role_key   the service-role key (sent as the Bearer token to the edge function)
-- Until both exist, the cron jobs do nothing (messages stay queued).

select pgmq.create('publish');
select pgmq.create('import');

-- ---------------------------------------------------------------- sync lock
-- Per-user lease lock. A Postgres advisory lock would be the obvious tool, but the edge functions
-- reach Postgres through PostgREST/pooled connections, where session-level advisory locks don't
-- survive between calls and transaction-level ones release immediately. A lease row works across
-- connections and self-heals if a function dies (the lease expires).
create table public.sync_locks (
  user_id      uuid primary key references auth.users on delete cascade,
  locked_until timestamptz not null
);
alter table public.sync_locks enable row level security;  -- no policies: service role / definer functions only
revoke all on public.sync_locks from anon, authenticated;

-- true if the lock was acquired (and is now held for p_lease_seconds), false if another run holds it.
create function public.try_sync_lock(p_user_id uuid, p_lease_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.sync_locks as l (user_id, locked_until)
  values (p_user_id, clock_timestamp() + make_interval(secs => p_lease_seconds))
  on conflict (user_id) do update
    set locked_until = excluded.locked_until
    where l.locked_until <= clock_timestamp();
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

create function public.release_sync_lock(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.sync_locks where user_id = p_user_id;
$$;

-- --------------------------------------------------------- queue helpers (RPC)
-- pgmq's schema isn't exposed over PostgREST, so edge functions (service role) go through these.

-- Acknowledge (delete) processed messages.
create function public.queue_ack(p_queue text, p_msg_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_queue not in ('publish', 'import') then
    raise exception 'unknown queue %', p_queue using errcode = '22023';
  end if;
  select count(*) into n from pgmq.delete(p_queue, p_msg_ids);
  return n;
end;
$$;

-- Queue an import of one Google calendar (google-webhook, sweep, "Sync now"). Returns the new
-- message id, or null if an unread import for that calendar is already waiting.
create function public.enqueue_import(p_calendar_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_msg  bigint;
begin
  select user_id into v_user from public.google_calendars where id = p_calendar_id;
  if v_user is null then
    return null;
  end if;
  if exists (
    select 1 from pgmq.q_import
    where message ->> 'calendar_id' = p_calendar_id::text and read_ct = 0
  ) then
    return null;
  end if;
  select pgmq.send('import', jsonb_build_object('calendar_id', p_calendar_id, 'user_id', v_user)) into v_msg;
  return v_msg;
end;
$$;

-- ------------------------------------------------------- Google token (Vault)
-- Refresh tokens are stored in Vault; google_accounts.refresh_token_id points at the secret.
create function public.set_google_refresh_token(p_account_id uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  select refresh_token_id into v_secret from public.google_accounts where id = p_account_id for update;
  if not found then
    raise exception 'google account % not found', p_account_id using errcode = 'P0002';
  end if;

  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'google_refresh_token:' || p_account_id::text, 'Google OAuth refresh token');
  else
    perform vault.update_secret(v_secret, p_token);
  end if;

  update public.google_accounts set refresh_token_id = v_secret, status = 'ok' where id = p_account_id;
  return v_secret;
end;
$$;

create function public.get_google_refresh_token(p_account_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select s.decrypted_secret
  from public.google_accounts a
  join vault.decrypted_secrets s on s.id = a.refresh_token_id
  where a.id = p_account_id;
$$;

-- Don't leave orphaned secrets behind when an account row goes (disconnect, or account deletion
-- cascading from auth.users).
create function public.delete_google_refresh_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.refresh_token_id is not null then
    delete from vault.secrets where id = old.refresh_token_id;
  end if;
  return null;
end;
$$;

create trigger google_accounts_delete_token
  after delete on public.google_accounts
  for each row execute function public.delete_google_refresh_token();

-- ------------------------------------------------------- cron job functions
-- POST to the google-sync edge function with the service-role key from Vault. Returns the pg_net
-- request id, or null (and does nothing) if the Vault secrets aren't set up yet.
create function public.invoke_google_sync(p_body jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/google-sync',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 15000
  );
end;
$$;

create function public.vault_secrets_configured()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select count(*) = 2
  from vault.decrypted_secrets
  where name in ('project_url', 'service_role_key') and coalesce(decrypted_secret, '') <> '';
$$;

-- Every-minute consumer: claim a batch from each queue and hand it to google-sync.
--   body: {"action":"drain","queue":"publish"|"import","jobs":[{"msg_id":1,"attempt":1,"payload":{...}}]}
-- google-sync serialises per user with try_sync_lock(user_id) (jobs whose user is busy are simply
-- left unacknowledged and come back after p_vt seconds).
create function public.run_queue_consumer(
  p_batch integer default 50,
  p_vt integer default 120,
  p_max_attempts integer default 5
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q      text;
  rec    record;
  jobs   jsonb;
  sent   integer := 0;
begin
  -- Without the Vault secrets there is nowhere to send jobs; leave them queued (don't burn attempts).
  if not public.vault_secrets_configured() then
    return 0;
  end if;

  foreach q in array array['publish', 'import'] loop
    jobs := '[]'::jsonb;
    for rec in select * from pgmq.read(q, p_vt, p_batch) loop
      if rec.read_ct > p_max_attempts then
        perform pgmq.archive(q, rec.msg_id);  -- poison message: keep it in pgmq's archive for inspection
      else
        jobs := jobs || jsonb_build_array(
          jsonb_build_object('msg_id', rec.msg_id, 'attempt', rec.read_ct, 'payload', rec.message)
        );
      end if;
    end loop;

    if jsonb_array_length(jobs) > 0 then
      perform public.invoke_google_sync(jsonb_build_object('action', 'drain', 'queue', q, 'jobs', jobs));
      sent := sent + jsonb_array_length(jobs);
    end if;
  end loop;

  return sent;
end;
$$;

-- 15-minute fallback for missed push notifications: queue an import for every visible calendar.
create function public.enqueue_import_sweep()
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
    where c.show_in_app and a.status = 'ok'
  loop
    if public.enqueue_import(rec.id) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Daily: ask google-sync to (re)create watch channels that are missing or expire within 2 days.
--   body: {"action":"renew_watch","calendars":[{"id":uuid,"user_id":uuid}]}
create function public.renew_watch_channels()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cals jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'user_id', c.user_id)), '[]'::jsonb)
    into cals
  from public.google_calendars c
  join public.google_accounts a on a.id = c.account_id
  where c.show_in_app
    and a.status = 'ok'
    and (c.channel_id is null or c.channel_expires_at < now() + interval '2 days');

  if jsonb_array_length(cals) = 0 then
    return 0;
  end if;

  perform public.invoke_google_sync(jsonb_build_object('action', 'renew_watch', 'calendars', cals));
  return jsonb_array_length(cals);
end;
$$;

-- ---------------------------------------------------------------- privileges
-- None of these are for end users. Cron runs as postgres; edge functions use the service role.
revoke all on function public.try_sync_lock(uuid, integer)             from public, anon, authenticated;
revoke all on function public.release_sync_lock(uuid)                  from public, anon, authenticated;
revoke all on function public.queue_ack(text, bigint[])                from public, anon, authenticated;
revoke all on function public.enqueue_import(uuid)                     from public, anon, authenticated;
revoke all on function public.set_google_refresh_token(uuid, text)     from public, anon, authenticated;
revoke all on function public.get_google_refresh_token(uuid)           from public, anon, authenticated;
revoke all on function public.delete_google_refresh_token()            from public, anon, authenticated;
revoke all on function public.invoke_google_sync(jsonb)                from public, anon, authenticated;
revoke all on function public.vault_secrets_configured()               from public, anon, authenticated;
revoke all on function public.run_queue_consumer(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.enqueue_import_sweep()                   from public, anon, authenticated;
revoke all on function public.renew_watch_channels()                   from public, anon, authenticated;

grant execute on function public.try_sync_lock(uuid, integer)          to service_role;
grant execute on function public.release_sync_lock(uuid)               to service_role;
grant execute on function public.queue_ack(text, bigint[])             to service_role;
grant execute on function public.enqueue_import(uuid)                  to service_role;
grant execute on function public.set_google_refresh_token(uuid, text)  to service_role;
grant execute on function public.get_google_refresh_token(uuid)        to service_role;
