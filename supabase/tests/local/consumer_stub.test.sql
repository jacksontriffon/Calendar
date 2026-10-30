-- Local-runner-only checks of what the pg_cron job functions send to google-sync, using the pg_net
-- stub in shim.sql (net._stub_requests). On a real stack (no stub) this file reports itself as skipped.
select to_regclass('net._stub_requests') is null as no_stub \gset
\if :no_stub
\echo '1..0 # SKIP needs the pg_net stub from tests/local/shim.sql'
\q
\endif

begin;
select plan(14);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');
insert into public.google_accounts (id, user_id, email) values
  ('70000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@gmail.test'),
  ('70000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@gmail.test');
insert into public.google_calendars (id, user_id, account_id, google_id, access_role, show_in_app, channel_id, channel_expires_at) values
  ('90000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-000000000001', 'a-cal', 'owner', true, 'ch-a', now() + interval '1 day'),
  ('90000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '70000000-0000-4000-8000-000000000002', 'b-cal', 'owner', true, 'ch-b', now() + interval '10 days'),
  ('90000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '70000000-0000-4000-8000-000000000002', 'b-hidden', 'reader', false, null, null);
insert into public.events (id, user_id, title, day, start_min, end_min, visibility)
  values ('e3000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'public', current_date, 60, 120, 'public');
select vault.create_secret('http://localhost:54321/', 'project_url');
select vault.create_secret('test-service-key', 'service_role_key');
delete from net._stub_requests;

-- queue consumer -> google-sync
select ok(public.run_queue_consumer() >= 1, 'consumer sent a batch');
select is((select count(*)::int from net._stub_requests where body ->> 'queue' = 'publish'), 1, 'one POST for the publish queue');
select is((select url from net._stub_requests where body ->> 'queue' = 'publish'), 'http://localhost:54321/functions/v1/google-sync', 'POSTs to <project_url>/functions/v1/google-sync (trailing slash handled)');
select is((select headers ->> 'Authorization' from net._stub_requests where body ->> 'queue' = 'publish'), 'Bearer test-service-key', 'authenticates with the service_role_key secret');
select is((select body ->> 'action' from net._stub_requests where body ->> 'queue' = 'publish'), 'drain', 'action is "drain"');
select ok((select body -> 'jobs' from net._stub_requests where body ->> 'queue' = 'publish') @> '[{"payload":{"event_id":"e3000000-0000-4000-8000-000000000001","user_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}]'::jsonb, 'the batch contains the event''s job (msg_id, attempt, payload)');
select ok((select (body -> 'jobs' -> 0 ->> 'msg_id') is not null and (body -> 'jobs' -> 0 ->> 'attempt') = '1' from net._stub_requests where body ->> 'queue' = 'publish'), 'jobs carry msg_id and attempt');

-- 15-minute sweep -> import queue -> consumer
select is(public.enqueue_import_sweep(), 2, 'the sweep queues one import per calendar shown in the app');
delete from net._stub_requests;
select ok(public.run_queue_consumer() >= 2, 'consumer drains the import queue');
select is((select jsonb_array_length(body -> 'jobs') from net._stub_requests where body ->> 'queue' = 'import'), 2, 'one POST carrying both import jobs');
select ok((select body -> 'jobs' from net._stub_requests where body ->> 'queue' = 'import') @> '[{"payload":{"calendar_id":"90000000-0000-4000-8000-000000000001"}}]'::jsonb, 'import jobs name the calendar');

-- daily watch renewal
delete from net._stub_requests;
select is(public.renew_watch_channels(), 1, 'renewal selects only calendars without a channel or expiring within 2 days (b-hidden is not shown in the app, b-cal expires in 10 days)');
select is((select body ->> 'action' from net._stub_requests), 'renew_watch', 'renewal POSTs action "renew_watch"');
select is((select body -> 'calendars' from net._stub_requests), '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]'::jsonb, 'with the calendar id and user id');

select * from finish();
rollback;
