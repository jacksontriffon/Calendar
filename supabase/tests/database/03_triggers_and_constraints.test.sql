-- Triggers (new user, publish queue, updated_at), constraints and cascades
--
-- pgTAP test (runs under `supabase test db`, and under supabase/tests/local/run.sh with the mini
-- pgTAP in tests/local/shim.sql). Everything happens inside a transaction that is rolled back.
begin;
select plan(63);

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

-- ========================================================================== new-user trigger
insert into auth.users (id, email, raw_user_meta_data)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@example.test', '{"full_name":"Casey Cee","picture":"https://example.test/c.png"}');
insert into auth.users (id, email) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@example.test');

select is((select count(*)::int from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 1, 'new user gets a profile row');
select is((select display_name from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'Casey Cee', 'profile display_name comes from the auth metadata');
select is((select avatar_url from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'https://example.test/c.png', 'profile avatar_url comes from the auth metadata');
select is((select tz from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'UTC', 'profile tz defaults to UTC');
select is((select count(*)::int from public.categories where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 7, 'new user gets 7 categories');
select is((select jsonb_object_agg(name, hue) from public.categories where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
          '{"Work":255,"Food":72,"Health":132,"Family":28,"Social":12,"Routine":104,"Pets":166}'::jsonb, 'default categories use the prototype''s hues');
select ok((select bool_and(default_visibility = 'private' and default_targets = '{}') from public.categories where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 'default categories are private with no default targets');
select is((select count(*)::int from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), 1, 'a user without metadata still gets a profile');
select is((select count(*)::int from public.categories where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), 7, '...and 7 categories');
select is((select count(*)::int from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 8, 'categories are per user (A has the 7 defaults + the fixture)');

-- ========================================================================== publish enqueue
-- Count publish jobs for an event (postgres only; clients cannot read pgmq).
create function pg_temp.jobs(eid uuid) returns integer language sql as
  $$ select count(*)::integer from pgmq.q_publish where message ->> 'event_id' = eid::text $$;

-- Writes below are made as the user (through RLS) to prove the trigger works for clients.
select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.events (id, title, day, start_min, end_min, visibility) values
  ('e1000000-0000-4000-8000-000000000001', 'private only', current_date, 60, 120, 'private'),
  ('e1000000-0000-4000-8000-000000000002', 'public',       current_date, 60, 120, 'public'),
  ('e1000000-0000-4000-8000-000000000003', 'public no-op',  current_date, 60, 120, 'public'),
  ('e1000000-0000-4000-8000-000000000004', 'goes public',   current_date, 60, 120, 'private');
reset role;

select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000001'), 0, 'a private event does not enqueue a publish job');
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000002'), 1, 'a new public event enqueues one publish job');
select is((select message from pgmq.q_publish where message ->> 'event_id' = 'e1000000-0000-4000-8000-000000000002'),
          '{"event_id":"e1000000-0000-4000-8000-000000000002","user_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}'::jsonb, 'the job carries {event_id, user_id}');

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.events set title = 'private, renamed' where id = 'e1000000-0000-4000-8000-000000000001';
reset role;
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000001'), 0, 'editing a private event still does not enqueue');

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.events set title = 'public, renamed' where id = 'e1000000-0000-4000-8000-000000000002';
reset role;
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000002'), 2, 'editing a public event enqueues again');

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.events set visibility = 'private' where id = 'e1000000-0000-4000-8000-000000000002';
reset role;
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000002'), 3, 'public -> private enqueues (so the published copies get removed)');

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.events set title = 'now private, renamed' where id = 'e1000000-0000-4000-8000-000000000002';
reset role;
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000002'), 3, 'edits to the now-private event do not enqueue');

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.events set visibility = 'public' where id = 'e1000000-0000-4000-8000-000000000004';
reset role;
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000004'), 1, 'private -> public enqueues');

select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.events set title = title where id = 'e1000000-0000-4000-8000-000000000003';
reset role;
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000003'), 1, 'a no-op update of a public event does not enqueue (only the insert did)');

-- Soft delete: the row stays, and the unpublish job is queued.
select pg_temp.act_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.events set deleted_at = now() where id = 'e1000000-0000-4000-8000-000000000003';
select ok((select count(*) from public.events where id = 'e1000000-0000-4000-8000-000000000003') = 1, 'soft delete keeps the row (client can still read it)');
select ok((select deleted_at is not null from public.events where id = 'e1000000-0000-4000-8000-000000000003'), 'soft delete sets deleted_at');
reset role;
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000003'), 2, 'soft-deleting a public event enqueues an unpublish job');
select is((select count(*)::int from public.events where id = 'e1000000-0000-4000-8000-000000000003' and deleted_at is not null), 1, 'the soft-deleted row is still in the table');

-- Imported Google events are never published back.
select pg_temp.fx('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 3);
insert into public.events (id, user_id, title, day, start_min, end_min, visibility, source, google_calendar_id, google_event_id, is_mine)
  values ('e1000000-0000-4000-8000-000000000005', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'imported', current_date, 60, 120, 'public', 'google', '90000000-0000-4000-8000-000000000003', 'g-1', false);
select is(pg_temp.jobs('e1000000-0000-4000-8000-000000000005'), 0, 'an imported (source=google) event never enqueues, even if marked public');

-- ========================================================================== updated_at
insert into public.events (id, user_id, title, day, start_min, end_min)
  values ('e1000000-0000-4000-8000-000000000006', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'clock', current_date, 60, 120);
create temp table t_clock as select updated_at as before from public.events where id = 'e1000000-0000-4000-8000-000000000006';
update public.events set title = 'clock 2' where id = 'e1000000-0000-4000-8000-000000000006';
select ok((select e.updated_at > t.before from public.events e, t_clock t where e.id = 'e1000000-0000-4000-8000-000000000006'), 'updated_at is bumped on update');
update public.events set updated_at = '2000-01-01' where id = 'e1000000-0000-4000-8000-000000000006';
select ok((select updated_at > '2020-01-01' from public.events where id = 'e1000000-0000-4000-8000-000000000006'), 'a client-supplied updated_at is ignored');

-- ========================================================================== constraints
select throws_ok($$insert into public.events (user_id, day, start_min, end_min) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 100, 100)$$, '23514', null, 'events: end must be after start');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 1440, 1500)$$, '23514', null, 'events: start_min must be < 1440');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, -1, 60)$$, '23514', null, 'events: start_min must be >= 0');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 1501)$$, '23514', null, 'events: end_min must be <= start_min + 1440');
select lives_ok($$insert into public.events (user_id, day, start_min, end_min) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 1380, 1500)$$, 'events: an event may run past midnight');
select lives_ok($$insert into public.events (user_id, day, start_min, end_min, all_day, days) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 0, 1440, true, 7)$$, 'events: all-day (0..1440, several days) is valid');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, visibility) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, 'friends')$$, '23514', null, 'events: visibility is private|public');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, source) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, 'outlook')$$, '23514', null, 'events: source is app|google');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, source) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, 'google')$$, '23514', null, 'events: a google event needs its google ids');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, google_event_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, 'x')$$, '23514', null, 'events: an app event carries no google ids');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, source, google_calendar_id, google_event_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, 'google', '90000000-0000-4000-8000-000000000003', 'g-1')$$, '23505', null, 'events: (google_calendar_id, google_event_id) is unique');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, legacy_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, 'e1'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, 'e1')$$, '23505', null, 'events: (user_id, legacy_id) is unique');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, pauses) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 60, 120, '{}')$$, '23514', null, 'events: pauses must be a JSON array');
select throws_ok($$insert into public.categories (user_id, name, hue) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Work', 10)$$, '23505', null, 'categories: (user_id, name) is unique');
select lives_ok($$insert into public.categories (user_id, name, hue) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Neutral', 1000)$$, 'categories: hue 1000 (the grey swatch) is valid');
select throws_ok($$insert into public.categories (user_id, name, hue) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Bad hue', 361)$$, '23514', null, 'categories: hue must be 0..360 or 1000');
select throws_ok($$insert into public.categories (user_id, name, hue, default_visibility) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Bad vis', 10, 'friends')$$, '23514', null, 'categories: default_visibility is private|public');
select throws_ok($$insert into public.series (user_id, weekdays, start_day) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{7}', current_date)$$, '23514', null, 'series: weekdays are 0..6');
select throws_ok($$insert into public.series (user_id, weekdays, start_day) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{}', current_date)$$, '23514', null, 'series: weekdays is not empty');
select throws_ok($$insert into public.series (user_id, weekdays, start_day, "until") values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{1}', current_date, current_date - 1)$$, '23514', null, 'series: until is not before start_day');
select throws_ok($$insert into public.series (user_id, freq, weekdays, start_day) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'daily', '{1}', current_date)$$, '23514', null, 'series: freq is weekly');
select throws_ok($$insert into public.goals (user_id, title, hue, hours) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'g', 10, -1)$$, '23514', null, 'goals: hours >= 0');
select throws_ok($$insert into public.hidden_items (user_id, source, external_key) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'outlook', 'k')$$, '23514', null, 'hidden_items: source is google|device');
select lives_ok($$insert into public.hidden_items (user_id, source, external_key) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'device', 'k')$$, 'hidden_items: insert (Remove)');
select throws_ok($$insert into public.hidden_items (user_id, source, external_key) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'device', 'k')$$, '23505', null, 'hidden_items: hiding the same item twice is a conflict');
select throws_ok($$insert into public.event_targets (user_id, event_id, kind, google_calendar_id, device_id, device_calendar_key) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'e1000000-0000-4000-8000-000000000001', 'device', '90000000-0000-4000-8000-000000000003', 'd', 'k')$$, '23514', null, 'event_targets: a device target has no google_calendar_id');
select throws_ok($$insert into public.google_accounts (user_id, email, status) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'x@example.test', 'revoked')$$, '23514', null, 'google_accounts: status is ok|needs_signin');
select throws_ok($$insert into public.google_calendars (user_id, account_id, google_id, access_role) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '70000000-0000-4000-8000-000000000003', 'x', 'admin')$$, '23514', null, 'google_calendars: access_role is a Google role');
select throws_ok($$insert into public.google_calendars (user_id, account_id, google_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '70000000-0000-4000-8000-000000000003', 'cal-3')$$, '23505', null, 'google_calendars: (account_id, google_id) is unique');
select throws_ok($$insert into public.google_calendars (user_id, account_id, google_id) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '70000000-0000-4000-8000-000000000003', 'other')$$, '23503', null, 'google_calendars: a calendar cannot hang off another user''s account');
select throws_ok($$insert into public.profiles (id, prefs) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{}')$$, '23505', null, 'profiles: one per user');

-- ========================================================================== foreign keys & cascades
select pg_temp.fx('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 4);
delete from public.categories where id = 'c0000000-0000-4000-8000-000000000004';
select ok((select category_id is null from public.events where id = 'e0000000-0000-4000-8000-000000000004'), 'deleting a category keeps its events (category_id -> null)');
select ok((select category_id is null from public.goals where id = 'a0000000-0000-4000-8000-000000000004'), 'deleting a category keeps its goals');
delete from public.series where id = '50000000-0000-4000-8000-000000000004';
select is((select count(*)::int from public.events where id = 'e0000000-0000-4000-8000-000000000004'), 1, 'deleting a series keeps its events');
insert into public.events (id, user_id, title, day, start_min, end_min, source, google_calendar_id, google_event_id)
  values ('e1000000-0000-4000-8000-000000000007', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'imported', current_date, 0, 1440, 'google', '90000000-0000-4000-8000-000000000004', 'g-7');
delete from public.google_calendars where id = '90000000-0000-4000-8000-000000000004';
select is((select count(*)::int from public.events where id = 'e1000000-0000-4000-8000-000000000007'), 0, 'deleting a google calendar deletes the events imported from it');
select is((select count(*)::int from public.events where id = 'e0000000-0000-4000-8000-000000000004'), 1, '...but not the user''s own events');
delete from auth.users where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select is((select (select count(*) from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
                 + (select count(*) from public.categories where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
                 + (select count(*) from public.events where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
                 + (select count(*) from public.goals where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'))::int, 0, 'deleting the user removes every row they own');

select * from finish();
rollback;
