-- Queues, cron jobs, sync lock and the consumer
--
-- pgTAP test (runs under `supabase test db`, and under supabase/tests/local/run.sh with the mini
-- pgTAP in tests/local/shim.sql). Everything happens inside a transaction that is rolled back.
begin;
select plan(48);

-- Act as a signed-in user: sets the JWT claims auth.uid() reads, then switches to the API role.
-- (Call it while still the superuser; `reset role;` goes back.)
create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;

-- One row in every user table for user `uid`; ids end in `n` so user 1 / user 2 rows are predictable:
--   category c.., goal a.., series 5.., event e.., hidden item 3.., google account 7.., google calendar 9..,
--   device target 4.., google target 6..
create function pg_temp.fx(uid uuid, n integer) returns void
language plpgsql as $$
begin
  insert into public.categories (id, user_id, name, hue)
    values (('c0000000-0000-4000-8000-00000000000' || n)::uuid, uid, 'Fixture', 200);
  insert into public.goals (id, user_id, title, hue, hours, category_id)
    values (('a0000000-0000-4000-8000-00000000000' || n)::uuid, uid, 'Fixture goal', 100, 10, ('c0000000-0000-4000-8000-00000000000' || n)::uuid);
  insert into public.series (id, user_id, weekdays, start_day)
    values (('50000000-0000-4000-8000-00000000000' || n)::uuid, uid, '{1,3}', current_date);
  insert into public.events (id, user_id, title, category_id, day, start_min, end_min)
    values (('e0000000-0000-4000-8000-00000000000' || n)::uuid, uid, 'Fixture event', ('c0000000-0000-4000-8000-00000000000' || n)::uuid, current_date, 540, 600);
  insert into public.hidden_items (id, user_id, source, external_key)
    values (('30000000-0000-4000-8000-00000000000' || n)::uuid, uid, 'google', 'fixture-' || n);
  insert into public.google_accounts (id, user_id, email)
    values (('70000000-0000-4000-8000-00000000000' || n)::uuid, uid, 'fixture' || n || '@example.test');
  insert into public.google_calendars (id, user_id, account_id, google_id, name, access_role)
    values (('90000000-0000-4000-8000-00000000000' || n)::uuid, uid, ('70000000-0000-4000-8000-00000000000' || n)::uuid, 'cal-' || n, 'Fixture calendar', 'writer');
  insert into public.event_targets (id, user_id, event_id, kind, device_id, device_calendar_key)
    values (('40000000-0000-4000-8000-00000000000' || n)::uuid, uid, ('e0000000-0000-4000-8000-00000000000' || n)::uuid, 'device', 'dev-' || n, 'cal-key');
  insert into public.event_targets (id, user_id, event_id, kind, google_calendar_id)
    values (('60000000-0000-4000-8000-00000000000' || n)::uuid, uid, ('e0000000-0000-4000-8000-00000000000' || n)::uuid, 'google', ('90000000-0000-4000-8000-00000000000' || n)::uuid);
  insert into public.ai_usage (user_id, month, notes) values (uid, date_trunc('month', current_date)::date, 3);
  insert into public.legacy_calendar_blobs (user_id, data) values (uid, '{"events":[]}');
  insert into public.gcal_links (user_id, map) values (uid, '{}');
end $$;

-- Users A and B. (The on_auth_user_created trigger gives each a profile and the default categories.)
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');
select pg_temp.fx('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1);
select pg_temp.fx('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2);

-- ========================================================================== queues and cron jobs exist
select ok(to_regclass('pgmq.q_publish') is not null, 'pgmq queue "publish" exists');
select ok(to_regclass('pgmq.q_import') is not null, 'pgmq queue "import" exists');
select is((select schedule from cron.job where jobname = 'calendar-queue-consumer'), '* * * * *', 'queue consumer runs every minute');
select ok((select command from cron.job where jobname = 'calendar-queue-consumer') like '%run_queue_consumer%', 'the consumer job runs run_queue_consumer()');
select is((select schedule from cron.job where jobname = 'calendar-import-sweep'), '*/15 * * * *', 'import sweep runs every 15 minutes');
select ok((select command from cron.job where jobname = 'calendar-import-sweep') like '%enqueue_import_sweep%', 'the sweep job runs enqueue_import_sweep()');
select is((select count(*)::int from cron.job where jobname = 'calendar-watch-renewal'), 1, 'watch-channel renewal job exists');
select ok((select schedule from cron.job where jobname = 'calendar-watch-renewal') ~ '^\d+ \d+ \* \* \*$', 'watch-channel renewal runs daily');
select ok((select command from cron.job where jobname = 'calendar-watch-renewal') like '%renew_watch_channels%', 'the renewal job runs renew_watch_channels()');

-- ========================================================================== per-user sync lock
select is(public.try_sync_lock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true, 'try_sync_lock: first caller gets the lock');
select is(public.try_sync_lock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false, 'try_sync_lock: a second caller for the same user is refused');
select is(public.try_sync_lock('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), true, 'try_sync_lock: locks are per user');
select lives_ok($$select public.release_sync_lock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, 'release_sync_lock');
select is(public.try_sync_lock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true, 'try_sync_lock: free again after release');
update public.sync_locks set locked_until = clock_timestamp() - interval '1 second' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(public.try_sync_lock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true, 'try_sync_lock: an expired lease can be taken over');

-- ========================================================================== privileges of the helpers
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select throws_ok($$select public.try_sync_lock('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '42501', null, 'client cannot call try_sync_lock');
select throws_ok($$select public.run_queue_consumer()$$, '42501', null, 'client cannot run the queue consumer');
select throws_ok($$select public.enqueue_import('90000000-0000-4000-8000-000000000001')$$, '42501', null, 'client cannot enqueue imports');
select throws_ok($$select public.queue_ack('publish', array[1]::bigint[])$$, '42501', null, 'client cannot ack queue messages');
select throws_ok($$select public.invoke_google_sync('{}')$$, '42501', null, 'client cannot invoke google-sync');
select throws_ok($$select * from public.sync_locks$$, '42501', null, 'client cannot read sync_locks');
reset role;
set local role service_role;
select lives_ok($$select public.try_sync_lock('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$, 'service role can call try_sync_lock');
select lives_ok($$select public.enqueue_import('90000000-0000-4000-8000-000000000002')$$, 'service role can enqueue imports');
reset role;

-- ========================================================================== consumer
-- Start from a known state: no Vault config, and a public event so the publish queue has a job.
delete from vault.secrets where name in ('project_url', 'service_role_key');
create function pg_temp.q(eid uuid) returns integer language sql as
  $$ select count(*)::integer from pgmq.q_publish where message ->> 'event_id' = eid::text $$;
insert into public.events (id, user_id, title, day, start_min, end_min, visibility)
  values ('e2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'published', current_date, 60, 120, 'public');
select is(pg_temp.q('e2000000-0000-4000-8000-000000000001'), 1, 'the public event queued a publish job');

select is(public.vault_secrets_configured(), false, 'Vault secrets project_url/service_role_key are not set');
select is(public.run_queue_consumer(), 0, 'without Vault secrets the consumer does nothing');
select is((select read_ct from pgmq.q_publish where message ->> 'event_id' = 'e2000000-0000-4000-8000-000000000001'), 0, '...and leaves the job unread');
select is(public.invoke_google_sync('{}'), null::bigint, 'invoke_google_sync is a no-op without secrets');

select vault.create_secret('http://localhost:54321/', 'project_url');
select vault.create_secret('test-service-key', 'service_role_key');
select is(public.vault_secrets_configured(), true, 'Vault secrets are detected once created');
select ok(public.run_queue_consumer() >= 1, 'with secrets the consumer claims the queued jobs');
select is((select read_ct from pgmq.q_publish where message ->> 'event_id' = 'e2000000-0000-4000-8000-000000000001'), 1, '...marking the job read once');
select is((select count(*)::int from pgmq.read('publish', 1, 100) r where r.message ->> 'event_id' = 'e2000000-0000-4000-8000-000000000001'), 0, 'a claimed job is not handed out again before its visibility timeout');

-- Ack deletes; an unacknowledged job that keeps failing ends up in the archive.
select is(public.queue_ack('publish', array[(select msg_id from pgmq.q_publish where message ->> 'event_id' = 'e2000000-0000-4000-8000-000000000001')]), 1, 'queue_ack deletes the acknowledged message');
select is(pg_temp.q('e2000000-0000-4000-8000-000000000001'), 0, '...it is gone from the queue');
select throws_ok($$select public.queue_ack('bogus', array[1]::bigint[])$$, '22023', null, 'queue_ack refuses unknown queues');

update public.events set title = 'published again' where id = 'e2000000-0000-4000-8000-000000000001';
create temp table t_poison as select msg_id from pgmq.q_publish where message ->> 'event_id' = 'e2000000-0000-4000-8000-000000000001';
update pgmq.q_publish set read_ct = 50, vt = clock_timestamp() - interval '1 second' where msg_id in (select msg_id from t_poison);
select ok(public.run_queue_consumer() >= 0, 'consumer runs over a poison message');
select is((select count(*)::int from pgmq.q_publish where msg_id in (select msg_id from t_poison)), 0, 'a message read more than max_attempts times leaves the queue...');
select is((select count(*)::int from pgmq.a_publish where msg_id in (select msg_id from t_poison)), 1, '...and is archived');

-- ========================================================================== import queue and sweep
select ok(public.enqueue_import('90000000-0000-4000-8000-000000000001') is not null, 'enqueue_import queues an import');
select is((select message from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-000000000001'),
          '{"calendar_id":"90000000-0000-4000-8000-000000000001","user_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}'::jsonb, 'the import job carries {calendar_id, user_id}');
select is(public.enqueue_import('90000000-0000-4000-8000-000000000001'), null::bigint, 'a second import for the same calendar is deduplicated while the first is unread');
select is(public.enqueue_import('99999999-9999-4999-8999-999999999999'), null::bigint, 'an unknown calendar queues nothing');

delete from pgmq.q_import where message ->> 'calendar_id' in ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002');
update public.google_calendars set show_in_app = true where id = '90000000-0000-4000-8000-000000000001';
update public.google_calendars set show_in_app = false where id = '90000000-0000-4000-8000-000000000002';
select ok(public.enqueue_import_sweep() >= 1, 'the sweep queues imports');
select is((select count(*)::int from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-000000000001'), 1, 'the sweep queued the calendar shown in the app');
select is((select count(*)::int from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-000000000002'), 0, '...and skipped the hidden one');

delete from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-000000000001';
update public.google_accounts set status = 'needs_signin' where id = '70000000-0000-4000-8000-000000000001';
select public.enqueue_import_sweep();
select is((select count(*)::int from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-000000000001'), 0, 'the sweep skips accounts that need sign-in');
update public.google_accounts set status = 'ok' where id = '70000000-0000-4000-8000-000000000001';

-- ========================================================================== watch-channel renewal
update public.google_calendars set show_in_app = true, channel_id = 'ch-a', channel_expires_at = now() + interval '1 day' where id = '90000000-0000-4000-8000-000000000001';
update public.google_calendars set show_in_app = true, channel_id = 'ch-b', channel_expires_at = now() + interval '10 days' where id = '90000000-0000-4000-8000-000000000002';
select ok(public.renew_watch_channels() >= 1, 'renewal picks up channels expiring within 2 days');
select throws_ok($$update public.google_calendars set channel_id = 'ch-b' where id = '90000000-0000-4000-8000-000000000001'$$, '23505', null, 'a watch channel id is unique');

select * from finish();
rollback;
