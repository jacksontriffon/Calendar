-- ai-schedule limits and legacy-import support.
--
--  * public.ai_calls + ai_claim()/ai_refund(): the monthly allowance and per-minute rate limit of the
--    ai-schedule edge function, decided atomically in one SQL call (service role only).
--  * series.legacy_id: lets legacy-import upsert series idempotently, like goals and events
--    (unique (user_id, legacy_id)).

-- ------------------------------------------------------------------ series.legacy_id
alter table public.series add column legacy_id text;
alter table public.series add constraint series_user_legacy_id_key unique (user_id, legacy_id);

-- ------------------------------------------------------------------ ai_calls
-- One row per accepted ai-schedule call, for the sliding one-minute window. Pruned by ai_claim.
create table public.ai_calls (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users on delete cascade,
  called_at timestamptz not null default clock_timestamp()
);
create index ai_calls_user_called_idx on public.ai_calls (user_id, called_at desc);

alter table public.ai_calls enable row level security;  -- no policies: service role / definer functions only
revoke all on public.ai_calls from anon, authenticated;

-- ------------------------------------------------------------------ ai_claim
-- Reserve one AI call for a user, atomically (a per-user advisory transaction lock serialises
-- concurrent calls, so two requests can't both take the last slot).
--
--   allowed      true  => the call was recorded: ai_usage.notes for the current UTC month was
--                         incremented and a rate-window row was added
--   reason       'ok' | 'limit' (monthly allowance used up) | 'rate' (too many calls in the last minute)
--   used         notes used this month (after the increment when allowed)
--   usage_month  first day of the current UTC month (the ai_usage key); the allowance resets on the 1st of the next
--   retry_after  seconds until a slot frees up when reason = 'rate', else 0
--
-- The monthly check wins over the rate check, and a refused call is never recorded or counted.
create function public.ai_claim(p_user_id uuid, p_limit integer, p_per_minute integer)
returns table (allowed boolean, reason text, used integer, usage_month date, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month  date := date_trunc('month', timezone('utc', clock_timestamp()))::date;
  v_now    timestamptz := clock_timestamp();
  v_used   integer;
  v_recent integer;
  v_oldest timestamptz;
begin
  if p_limit < 0 or p_per_minute < 0 then
    raise exception 'limits must be non-negative' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_claim:' || p_user_id::text, 0));

  delete from public.ai_calls where user_id = p_user_id and called_at < v_now - interval '5 minutes';

  select coalesce(u.notes, 0) into v_used
    from (select 1) one
    left join public.ai_usage u on u.user_id = p_user_id and u.month = v_month;

  if v_used >= p_limit then
    return query select false, 'limit'::text, v_used, v_month, 0;
    return;
  end if;

  select count(*), min(c.called_at) into v_recent, v_oldest
    from public.ai_calls c
   where c.user_id = p_user_id and c.called_at > v_now - interval '1 minute';

  if v_recent >= p_per_minute then
    return query select false, 'rate'::text, v_used, v_month,
      greatest(1, ceil(extract(epoch from (coalesce(v_oldest, v_now) + interval '1 minute' - v_now)))::integer);
    return;
  end if;

  insert into public.ai_calls (user_id, called_at) values (p_user_id, v_now);
  insert into public.ai_usage as u (user_id, month, notes) values (p_user_id, v_month, 1)
    on conflict (user_id, month) do update set notes = u.notes + 1
    returning u.notes into v_used;

  return query select true, 'ok'::text, v_used, v_month, 0;
end;
$$;

-- ------------------------------------------------------------------ ai_refund
-- Give back the note an ai_claim() took, when the call failed through no fault of the user
-- (Anthropic down, unusable reply). The rate-window row stays. Returns the notes now used.
create function public.ai_refund(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', timezone('utc', clock_timestamp()))::date;
  v_used  integer;
begin
  update public.ai_usage u set notes = greatest(u.notes - 1, 0)
   where u.user_id = p_user_id and u.month = v_month
   returning u.notes into v_used;
  return coalesce(v_used, 0);
end;
$$;

revoke all on function public.ai_claim(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.ai_refund(uuid)                  from public, anon, authenticated;
grant execute on function public.ai_claim(uuid, integer, integer) to service_role;
grant execute on function public.ai_refund(uuid)                  to service_role;
