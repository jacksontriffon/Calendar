-- Local, no-Docker stand-in for the parts of a Supabase stack the migrations and tests rely on:
-- roles, the `auth` schema, and stub `pgmq`, `cron`, `vault` and `net` schemas, plus a tiny
-- pgTAP-compatible assertion library (plan/ok/is/throws_ok/lives_ok/finish) so the SAME test files
-- in tests/database run both here and under `supabase test db` (real pgTAP).
--
-- Applied by tests/local/run.sh to a fresh scratch database BEFORE the migrations. The stubs only
-- implement what this repo uses, with the same names/signatures/column names as the real things.
--
-- If this file is ever picked up by `supabase test db` (it recurses through supabase/tests) it
-- detects the real stack (an `auth` schema already exists) and reports itself as skipped.

select to_regnamespace('auth') is not null as is_real_stack \gset
\if :is_real_stack
\echo '1..0 # SKIP local-runner shim, not applicable on a real Supabase stack'
\q
\endif

-- ------------------------------------------------------------------- roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Supabase grants new public objects to the API roles by default; the migrations must revoke
-- what clients may not have, so mirror that here.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to public;
create extension if not exists pgcrypto with schema extensions;  -- crypt()/gen_salt() used by seed.sql

-- -------------------------------------------------------------------- auth
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  instance_id            uuid,
  id                     uuid primary key,
  aud                    text,
  role                   text,
  email                  text,
  encrypted_password     text,
  email_confirmed_at     timestamptz,
  confirmation_token     text,
  recovery_token         text,
  email_change_token_new text,
  email_change           text,
  raw_app_meta_data      jsonb,
  raw_user_meta_data     jsonb,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

create table auth.identities (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  identity_data  jsonb not null,
  provider       text not null,
  provider_id    text not null,
  last_sign_in_at timestamptz,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Same contract as Supabase: the caller's id comes from the JWT claims the API layer sets.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- -------------------------------------------------------------------- pgmq
-- Stub of the pgmq extension: queue tables are pgmq.q_<name> / pgmq.a_<name> with the real column
-- names, so SQL that reads them works unchanged.
create schema pgmq;

create type pgmq.message_record as (
  msg_id      bigint,
  read_ct     integer,
  enqueued_at timestamptz,
  vt          timestamptz,
  message     jsonb,
  headers     jsonb
);

create function pgmq."create"(queue_name text) returns void
language plpgsql as $$
begin
  execute format(
    'create table if not exists pgmq.%I (
       msg_id bigserial primary key, read_ct integer not null default 0,
       enqueued_at timestamptz not null default now(), vt timestamptz not null default now(),
       message jsonb, headers jsonb)', 'q_' || queue_name);
  execute format(
    'create table if not exists pgmq.%I (
       msg_id bigint primary key, read_ct integer not null, enqueued_at timestamptz not null,
       archived_at timestamptz not null default now(), vt timestamptz not null,
       message jsonb, headers jsonb)', 'a_' || queue_name);
end $$;

create function pgmq.send(queue_name text, msg jsonb, delay integer default 0) returns setof bigint
language plpgsql as $$
begin
  return query execute format(
    'insert into pgmq.%I (vt, message) values (clock_timestamp() + make_interval(secs => $1), $2) returning msg_id',
    'q_' || queue_name) using delay, msg;
end $$;

create function pgmq.read(queue_name text, vt integer, qty integer, conditional jsonb default '{}')
returns setof pgmq.message_record
language plpgsql as $$
begin
  return query execute format(
    'with cte as (
       select msg_id from pgmq.%1$I where vt <= clock_timestamp() order by msg_id limit $1 for update skip locked)
     update pgmq.%1$I m
        set vt = clock_timestamp() + make_interval(secs => $2), read_ct = m.read_ct + 1
       from cte where m.msg_id = cte.msg_id
     returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message, m.headers',
    'q_' || queue_name) using qty, vt;
end $$;

create function pgmq.delete(queue_name text, msg_ids bigint[]) returns setof bigint
language plpgsql as $$
begin
  return query execute format('delete from pgmq.%I where msg_id = any($1) returning msg_id', 'q_' || queue_name) using msg_ids;
end $$;

create function pgmq.delete(queue_name text, msg_id bigint) returns boolean
language plpgsql as $$
declare n integer;
begin
  execute format('delete from pgmq.%I where msg_id = $1', 'q_' || queue_name) using msg_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create function pgmq.archive(queue_name text, msg_id bigint) returns boolean
language plpgsql as $$
declare n integer;
begin
  execute format(
    'with d as (delete from pgmq.%1$I where msg_id = $1 returning msg_id, read_ct, enqueued_at, vt, message, headers)
     insert into pgmq.%2$I (msg_id, read_ct, enqueued_at, vt, message, headers)
     select msg_id, read_ct, enqueued_at, vt, message, headers from d',
    'q_' || queue_name, 'a_' || queue_name) using msg_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- --------------------------------------------------------------------- cron
create schema cron;
create table cron.job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  jobname  text unique,
  active   boolean not null default true
);
-- Like pg_cron >= 1.4: scheduling an existing job name updates it.
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

-- -------------------------------------------------------------------- vault
-- Plain-text stand-in for Supabase Vault.
create schema vault;
create table vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text not null default '',
  secret      text not null,
  key_id      uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, key_id, created_at, updated_at
  from vault.secrets;

create function vault.create_secret(new_secret text, new_name text default null,
                                    new_description text default '', new_key_id uuid default null)
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description, key_id)
  values (new_secret, new_name, coalesce(new_description, ''), new_key_id)
  returning id
$$;

create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                    new_description text default null, new_key_id uuid default null)
returns void language sql as $$
  update vault.secrets
     set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
         description = coalesce(new_description, description), key_id = coalesce(new_key_id, key_id),
         updated_at = now()
   where id = secret_id
$$;

-- ---------------------------------------------------------------------- net
-- Records requests instead of sending them. (Real pg_net sends asynchronously and returns a request id.)
create schema net;
create table net._stub_requests (
  id         bigserial primary key,
  url        text,
  body       jsonb,
  headers    jsonb,
  created_at timestamptz not null default now()
);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                              headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
                              timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net._stub_requests (url, body, headers) values (url, body, headers) returning id
$$;

-- ----------------------------------------------------------------- realtime
create publication supabase_realtime;

-- ------------------------------------------------------------- mini pgTAP
-- Just enough of pgTAP's API for tests/database/*.sql: plan, ok, is, throws_ok (4-arg), lives_ok,
-- finish. Output is TAP ("ok 1 - ...", "not ok 2 - ..."), so run.sh can grep it.
create schema tap;
grant usage on schema tap to public;
create table tap.results (n integer primary key, ok boolean not null, descr text);
create table tap.plan (planned integer);
grant all on tap.results, tap.plan to public;

create function extensions.plan(n integer) returns text
language plpgsql as $$
begin
  delete from tap.results;
  delete from tap.plan;
  insert into tap.plan values (n);
  return '1..' || n;
end $$;

create function extensions.ok(cond boolean, descr text default '') returns text
language plpgsql as $$
declare i integer;
begin
  select coalesce(max(n), 0) + 1 into i from tap.results;
  insert into tap.results values (i, coalesce(cond, false), descr);
  return case when cond is true then 'ok ' else 'not ok ' end || i || ' - ' || coalesce(descr, '');
end $$;

create function extensions."is"(have anyelement, want anyelement, descr text default '') returns text
language plpgsql as $$
declare r text;
begin
  r := extensions.ok(have is not distinct from want, descr);
  if have is distinct from want then
    r := r || E'\n# have: ' || coalesce(have::text, 'NULL') || E'\n# want: ' || coalesce(want::text, 'NULL');
  end if;
  return r;
end $$;

create function extensions.throws_ok(sql text, errcode text, errmsg text, descr text default '') returns text
language plpgsql as $$
declare r text;
begin
  begin
    execute sql;
  exception when others then
    r := extensions.ok(sqlstate = errcode and (errmsg is null or sqlerrm = errmsg), descr);
    if not (sqlstate = errcode and (errmsg is null or sqlerrm = errmsg)) then
      r := r || E'\n# caught: ' || sqlstate || ': ' || sqlerrm || E'\n# wanted: ' || errcode || ': ' || coalesce(errmsg, 'anything');
    end if;
    return r;
  end;
  return extensions.ok(false, descr) || E'\n# caught: no exception\n# wanted: ' || errcode;
end $$;

create function extensions.lives_ok(sql text, descr text default '') returns text
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    return extensions.ok(false, descr) || E'\n# died: ' || sqlstate || ': ' || sqlerrm;
  end;
  return extensions.ok(true, descr);
end $$;

create function extensions.finish() returns setof text
language plpgsql as $$
declare planned integer; ran integer; failed integer;
begin
  select p.planned into planned from tap.plan p;
  select count(*), count(*) filter (where not ok) into ran, failed from tap.results;
  if planned is distinct from ran then
    return next '# Looks like you planned ' || coalesce(planned::text, '?') || ' tests but ran ' || ran;
  end if;
  if failed > 0 then
    return next '# Looks like you failed ' || failed || ' test' || case when failed = 1 then '' else 's' end || ' of ' || ran;
  end if;
end $$;
