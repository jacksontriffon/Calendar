-- Google edge-function support: OAuth state nonces, calendar triggers, picking publish targets
--
-- pgTAP test (runs under `supabase test db`, and under supabase/tests/local/run.sh with the mini
-- pgTAP in tests/local/shim.sql). Everything happens inside a transaction that is rolled back.
begin;
select plan(50);

create function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');

-- User A: one account; calendars p (primary, publishable), q (publishable), r (read-only).
-- User B: one account with calendar b1 (publishable).
insert into public.google_accounts (id, user_id, email) values
  ('70000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@gmail.test'),
  ('70000000-0000-4000-8000-00000000000b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@gmail.test');
insert into public.google_calendars (id, user_id, account_id, google_id, name, access_role, is_primary, can_publish) values
  ('90000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-00000000000a', 'p', 'Primary', 'owner', true, true),
  ('90000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-00000000000a', 'q', 'Family', 'writer', false, true),
  ('90000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-00000000000a', 'r', 'Holidays', 'reader', false, false),
  ('90000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '70000000-0000-4000-8000-00000000000b', 'b1', 'Primary', 'owner', true, true);

-- ========================================================================== OAuth state
select lives_ok($$select public.create_google_oauth_state(repeat('a', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aicalendar://google/connected')$$, 'create_google_oauth_state');
select is((select return_url from public.consume_google_oauth_state(repeat('a', 64))), 'aicalendar://google/connected', 'consume returns the stored return url');
select is((select count(*)::int from public.consume_google_oauth_state(repeat('a', 64))), 0, 'a state can be consumed only once');
select is((select count(*)::int from public.consume_google_oauth_state(repeat('f', 64))), 0, 'an unknown state is not found');

select public.create_google_oauth_state(repeat('b', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://www.claude-calendar.com', '70000000-0000-4000-8000-00000000000a');
select is((select user_id from public.consume_google_oauth_state(repeat('b', 64))), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'the state is bound to the user it was created for');

select public.create_google_oauth_state(repeat('c', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://www.claude-calendar.com', '70000000-0000-4000-8000-00000000000a');
select is((select account_id from public.consume_google_oauth_state(repeat('c', 64))), '70000000-0000-4000-8000-00000000000a'::uuid, 'a reconnect state carries the account');

select public.create_google_oauth_state(repeat('d', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://www.claude-calendar.com', null, -5);
select is((select count(*)::int from public.consume_google_oauth_state(repeat('d', 64))), 0, 'an expired state is not accepted');

select throws_ok($$select public.create_google_oauth_state(repeat('e', 63), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x')$$, '23514', null, 'the state hash must be a sha256 hex string');
select throws_ok($$select public.create_google_oauth_state(repeat('e', 64), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'x')$$, '23503', null, 'the state needs a real user');
select throws_ok($$select public.create_google_oauth_state(repeat('e', 64), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x', '70000000-0000-4000-8000-00000000000a')$$, '23503', null, 'a reconnect state cannot point at another user''s account');

-- ============================================================================= import sweep
delete from pgmq.q_import;
update public.google_calendars set show_in_app = false where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.google_calendars (id, user_id, account_id, google_id, name, access_role, show_in_app, sync_token) values
  ('90000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-00000000000a', 's', 'Turned off, token left', 'reader', false, 'tok'),
  ('90000000-0000-4000-8000-0000000000a5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-00000000000a', 'h', 'Turned off, events left', 'reader', false, null),
  ('90000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-00000000000a', 'z', 'Shown', 'reader', true, null);
insert into public.events (id, user_id, title, day, start_min, end_min, source, google_calendar_id, google_event_id) values
  ('e0000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Leftover', '2026-11-03', 540, 600, 'google', '90000000-0000-4000-8000-0000000000a5', 'old');
select public.enqueue_import_sweep();
select is((select count(*)::int from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-0000000000a6'), 1, 'sweep: a calendar shown in the app is queued');
select is((select count(*)::int from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-0000000000a4'), 1, 'sweep: a turned-off calendar that still has a sync token is queued (to be purged)');
select is((select count(*)::int from pgmq.q_import where message ->> 'calendar_id' = '90000000-0000-4000-8000-0000000000a5'), 1, 'sweep: a turned-off calendar that still has imported events is queued (to be purged)');
select is((select count(*)::int from pgmq.q_import where message ->> 'calendar_id' in ('90000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a3')), 0, 'sweep: clean turned-off calendars are skipped');
delete from pgmq.q_import;
update public.google_accounts set status = 'needs_signin' where id = '70000000-0000-4000-8000-00000000000a';
select public.enqueue_import_sweep();
select is((select count(*)::int from pgmq.q_import), 0, 'sweep: accounts that need sign-in are skipped');
update public.google_accounts set status = 'ok' where id = '70000000-0000-4000-8000-00000000000a';
delete from public.events where id = 'e0000000-0000-4000-8000-0000000000c1';
delete from public.google_calendars where id in ('90000000-0000-4000-8000-0000000000a4', '90000000-0000-4000-8000-0000000000a5', '90000000-0000-4000-8000-0000000000a6');

-- ============================================================ calendars drop out of the defaults
update public.categories set default_targets = array['90000000-0000-4000-8000-0000000000a2', '90000000-0000-4000-8000-0000000000a1']::uuid[]
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Work';
delete from public.google_calendars where id = '90000000-0000-4000-8000-0000000000a2';
select is((select default_targets from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Work'), array['90000000-0000-4000-8000-0000000000a1']::uuid[], 'a deleted calendar drops off the categories'' default targets');
-- bring q back for the remaining tests
insert into public.google_calendars (id, user_id, account_id, google_id, name, access_role, can_publish) values
  ('90000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-00000000000a', 'q', 'Family', 'writer', true);

-- ============================================================ set_event_google_targets
insert into public.series (id, user_id, weekdays, start_day) values
  ('50000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{1}', '2026-11-02');
insert into public.events (id, user_id, title, day, start_min, end_min, visibility, series_id) values
  ('e0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Solo', '2026-11-03', 540, 600, 'public', null),
  ('e0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Run 1', '2026-11-02', 480, 540, 'public', '50000000-0000-4000-8000-0000000000a1'),
  ('e0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Run 2', '2026-11-09', 480, 540, 'public', '50000000-0000-4000-8000-0000000000a1'),
  ('e0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Run 3', '2026-11-16', 480, 540, 'public', '50000000-0000-4000-8000-0000000000a1'),
  ('e0000000-0000-4000-8000-0000000000a5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Run 4 (deleted)', '2026-11-23', 480, 540, 'public', '50000000-0000-4000-8000-0000000000a1');
update public.events set deleted_at = now() where id = 'e0000000-0000-4000-8000-0000000000a5';
insert into public.events (id, user_id, title, day, start_min, end_min, source, google_calendar_id, google_event_id) values
  ('e0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Imported', '2026-11-03', 540, 600, 'google', '90000000-0000-4000-8000-0000000000a1', 'g1');
insert into public.events (id, user_id, title, day, start_min, end_min) values
  ('e0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B event', '2026-11-03', 540, 600);

delete from pgmq.q_publish;   -- (the events trigger queued the inserts above)
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select lives_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a2']::uuid[])$$, 'client can pick Google targets for its event');
select is((select count(*)::int from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and kind = 'google' and status = 'pending'), 2, 'two pending google targets were created');
reset role;
select is((select count(*)::int from pgmq.q_publish where message ->> 'event_id' = 'e0000000-0000-4000-8000-0000000000a1' and message ->> 'user_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1, 'one publish job was queued');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- google-sync publishes (service role writes the result)
reset role;
update public.event_targets set status = 'synced', external_id = 'x-' || google_calendar_id::text, fingerprint = 'fp'
  where event_id = 'e0000000-0000-4000-8000-0000000000a1';
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select lives_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a2']::uuid[])$$, 'saving the same picks again works');
select is((select count(*)::int from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and status = 'synced'), 2, 'synced targets are left alone');

select lives_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000a1']::uuid[])$$, 'unticking a published calendar');
select is((select remove_requested from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and google_calendar_id = '90000000-0000-4000-8000-0000000000a2'), true, 'a published target is marked remove_requested (the Google copy must be deleted first)');
select is((select status from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and google_calendar_id = '90000000-0000-4000-8000-0000000000a2'), 'pending', 'and goes back to pending');
select is((select external_id from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and google_calendar_id = '90000000-0000-4000-8000-0000000000a2'), 'x-90000000-0000-4000-8000-0000000000a2', 'its external id is kept so the copy can be deleted');
select is((select remove_requested from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and google_calendar_id = '90000000-0000-4000-8000-0000000000a1'), false, 'the ticked calendar is untouched');

select lives_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a2']::uuid[])$$, 're-ticking a calendar');
select is((select remove_requested from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and google_calendar_id = '90000000-0000-4000-8000-0000000000a2'), false, 're-ticking cancels the removal');

-- Retry: a failed target goes back to pending when the same picks are saved again
reset role;
update public.event_targets set status = 'failed', error = 'boom' where event_id = 'e0000000-0000-4000-8000-0000000000a1' and google_calendar_id = '90000000-0000-4000-8000-0000000000a1';
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a2']::uuid[]);
select is((select status || '/' || coalesce(error, 'null') from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1' and google_calendar_id = '90000000-0000-4000-8000-0000000000a1'), 'pending/null', 'saving again retries a failed target and clears its error');

-- A target that was never published is simply deleted when unticked
select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a3', array['90000000-0000-4000-8000-0000000000a1']::uuid[]);
select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a3', array[]::uuid[]);
select is((select count(*)::int from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a3'), 0, 'an unpublished target is deleted when unticked');

-- Rejections
select throws_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000a3']::uuid[])$$, '22023', null, 'a read-only calendar cannot be a target');
select throws_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000b1']::uuid[])$$, '22023', null, 'another user''s calendar cannot be a target');
select throws_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000b1', array['90000000-0000-4000-8000-0000000000a1']::uuid[])$$, 'P0002', null, 'another user''s event cannot be published');
select throws_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a6', array['90000000-0000-4000-8000-0000000000a1']::uuid[])$$, '22023', null, 'an imported event cannot be published');
select throws_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array['90000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a3']::uuid[])$$, '22023', null, 'one bad calendar rejects the whole call');
select is((select count(*)::int from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a1'), 2, 'and changes nothing');

-- Series scope: this and all later occurrences
select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a3', array['90000000-0000-4000-8000-0000000000a1']::uuid[], true);
select is((select count(*)::int from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a2'), 0, 'series scope: earlier occurrences are not touched');
select is((select count(*)::int from public.event_targets where event_id in ('e0000000-0000-4000-8000-0000000000a3', 'e0000000-0000-4000-8000-0000000000a4') and kind = 'google'), 2, 'series scope: this and later occurrences get the target');
select is((select count(*)::int from public.event_targets where event_id = 'e0000000-0000-4000-8000-0000000000a5'), 0, 'series scope: deleted occurrences are skipped');

-- The client still cannot write google targets directly
select throws_ok($$insert into public.event_targets (event_id, kind, google_calendar_id) values ('e0000000-0000-4000-8000-0000000000a2', 'google', '90000000-0000-4000-8000-0000000000a1')$$, '42501', null, 'direct client inserts of google targets are still refused');
with u as (update public.event_targets set remove_requested = true where event_id = 'e0000000-0000-4000-8000-0000000000a3' and kind = 'google' returning 1)
  select is((select count(*)::int from u), 0, 'the client cannot flip remove_requested directly');
select is((select count(*)::int from public.event_targets where remove_requested), 0, 'the client can read the new column (nothing is marked)');

-- Function privileges
reset role;
select throws_ok($$set local role anon; select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array[]::uuid[])$$, '42501', null, 'anon cannot call set_event_google_targets');
reset role;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select throws_ok($$select public.create_google_oauth_state(repeat('1', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x')$$, '42501', null, 'client cannot create OAuth states');
select throws_ok($$select public.consume_google_oauth_state(repeat('1', 64))$$, '42501', null, 'client cannot consume OAuth states');
select throws_ok($$select count(*) from public.google_oauth_states$$, '42501', null, 'client cannot read the OAuth states table');
reset role;
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.set_event_google_targets('e0000000-0000-4000-8000-0000000000a1', array[]::uuid[])$$, '28000', null, 'without a signed-in user the call is refused');

-- Disconnecting an account removes its calendars' targets and states with it
select public.create_google_oauth_state(repeat('2', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', '70000000-0000-4000-8000-00000000000a');
delete from public.google_accounts where id = '70000000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.event_targets where kind = 'google' and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0, 'deleting the account deletes its google targets');
select is((select count(*)::int from public.events where source = 'google' and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0, 'and its imported events');
select is((select count(*)::int from public.google_oauth_states where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0, 'and its pending reconnect states');

select * from finish();
rollback;
