-- Row Level Security: users are isolated from each other in every user table
--
-- pgTAP test (runs under `supabase test db`, and under supabase/tests/local/run.sh with the mini
-- pgTAP in tests/local/shim.sql). Everything happens inside a transaction that is rolled back.
begin;
select plan(90);

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

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- A sees their own rows
select ok((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'A sees their own profiles row');
select ok((select count(*) from public.categories where id = 'c0000000-0000-4000-8000-000000000001') = 1, 'A sees their own categories row');
select ok((select count(*) from public.goals where id = 'a0000000-0000-4000-8000-000000000001') = 1, 'A sees their own goals row');
select ok((select count(*) from public.series where id = '50000000-0000-4000-8000-000000000001') = 1, 'A sees their own series row');
select ok((select count(*) from public.events where id = 'e0000000-0000-4000-8000-000000000001') = 1, 'A sees their own events row');
select ok((select count(*) from public.hidden_items where id = '30000000-0000-4000-8000-000000000001') = 1, 'A sees their own hidden_items row');
select ok((select count(*) from public.google_accounts where id = '70000000-0000-4000-8000-000000000001') = 1, 'A sees their own google_accounts row');
select ok((select count(*) from public.google_calendars where id = '90000000-0000-4000-8000-000000000001') = 1, 'A sees their own google_calendars row');
select ok((select count(*) from public.event_targets where id = '40000000-0000-4000-8000-000000000001') = 1, 'A sees their own event_targets (device) row');
select ok((select count(*) from public.event_targets where id = '60000000-0000-4000-8000-000000000001') = 1, 'A sees their own event_targets (google) row');
select ok((select count(*) from public.ai_usage where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'A sees their own ai_usage row');
select ok((select count(*) from public.legacy_calendar_blobs where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'A sees their own legacy_calendar_blobs row');
select ok((select count(*) from public.gcal_links where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'A sees their own gcal_links row');
select ok((select count(*) from public.calendars where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'A sees their own calendars (legacy view) row');

-- A cannot see B's rows
select ok((select count(*) from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'A cannot select B''s profiles row');
select ok((select count(*) from public.categories where id = 'c0000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s categories row');
select ok((select count(*) from public.goals where id = 'a0000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s goals row');
select ok((select count(*) from public.series where id = '50000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s series row');
select ok((select count(*) from public.events where id = 'e0000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s events row');
select ok((select count(*) from public.hidden_items where id = '30000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s hidden_items row');
select ok((select count(*) from public.google_accounts where id = '70000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s google_accounts row');
select ok((select count(*) from public.google_calendars where id = '90000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s google_calendars row');
select ok((select count(*) from public.event_targets where id = '40000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s event_targets (device) row');
select ok((select count(*) from public.event_targets where id = '60000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s event_targets (google) row');
select ok((select count(*) from public.ai_usage where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'A cannot select B''s ai_usage row');
select ok((select count(*) from public.legacy_calendar_blobs where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'A cannot select B''s legacy_calendar_blobs row');
select ok((select count(*) from public.gcal_links where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'A cannot select B''s gcal_links row');
select ok((select count(*) from public.calendars where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'A cannot select B''s calendars (legacy view) row');
select ok((select count(*) from public.google_accounts_public where id = '70000000-0000-4000-8000-000000000002') = 0, 'A cannot select B''s google_accounts_public row');

-- A cannot update B's rows (0 rows affected, or no UPDATE privilege at all)
with u as (update public.profiles set display_name = 'hacked' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s profiles row');
with u as (update public.categories set name = 'hacked' where id = 'c0000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s categories row');
with u as (update public.goals set title = 'hacked' where id = 'a0000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s goals row');
with u as (update public.series set weekdays = '{1}' where id = '50000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s series row');
with u as (update public.events set title = 'hacked' where id = 'e0000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s events row');
with u as (update public.hidden_items set external_key = 'hacked' where id = '30000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s hidden_items row');
select throws_ok($$update public.google_accounts set updated_at = now() where id = '70000000-0000-4000-8000-000000000002'$$, '42501', null, 'A cannot update google_accounts (no client UPDATE privilege)');
with u as (update public.google_calendars set show_in_app = true where id = '90000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s google_calendars row');
with u as (update public.event_targets set status = 'failed' where id = '40000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s event_targets (device) row');
with u as (update public.event_targets set status = 'failed' where id = '60000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s event_targets (google) row');
select throws_ok($$update public.ai_usage set updated_at = now() where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', null, 'A cannot update ai_usage (no client UPDATE privilege)');
with u as (update public.legacy_calendar_blobs set data = '{}' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s legacy_calendar_blobs row');
select throws_ok($$update public.gcal_links set updated_at = now() where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', null, 'A cannot update gcal_links (no client UPDATE privilege)');
with u as (update public.calendars set data = '{}' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1) select ok((select count(*) from u) = 0, 'A cannot update B''s calendars (legacy view) row');

-- A cannot delete B's rows (0 rows affected, or no DELETE privilege at all)
select throws_ok($$delete from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', null, 'A cannot delete profiles rows (no client DELETE privilege)');
with d as (delete from public.categories where id = 'c0000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s categories row');
with d as (delete from public.goals where id = 'a0000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s goals row');
with d as (delete from public.series where id = '50000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s series row');
with d as (delete from public.events where id = 'e0000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s events row');
with d as (delete from public.hidden_items where id = '30000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s hidden_items row');
select throws_ok($$delete from public.google_accounts where id = '70000000-0000-4000-8000-000000000002'$$, '42501', null, 'A cannot delete google_accounts rows (no client DELETE privilege)');
select throws_ok($$delete from public.google_calendars where id = '90000000-0000-4000-8000-000000000002'$$, '42501', null, 'A cannot delete google_calendars rows (no client DELETE privilege)');
with d as (delete from public.event_targets where id = '40000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s event_targets (device) row');
with d as (delete from public.event_targets where id = '60000000-0000-4000-8000-000000000002' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s event_targets (google) row');
select throws_ok($$delete from public.ai_usage where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', null, 'A cannot delete ai_usage rows (no client DELETE privilege)');
with d as (delete from public.legacy_calendar_blobs where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s legacy_calendar_blobs row');
select throws_ok($$delete from public.gcal_links where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', null, 'A cannot delete gcal_links rows (no client DELETE privilege)');
with d as (delete from public.calendars where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1) select ok((select count(*) from d) = 0, 'A cannot delete B''s calendars (legacy view) row');

-- A can update their own rows; and cannot hand a row to B
with u as (update public.events set title = 'mine' where id = 'e0000000-0000-4000-8000-000000000001' returning 1) select ok((select count(*) from u) = 1, 'A can update their own event');
with u as (update public.categories set name = 'Mine' where id = 'c0000000-0000-4000-8000-000000000001' returning 1) select ok((select count(*) from u) = 1, 'A can update their own category');
with u as (update public.profiles set display_name = 'A' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning 1) select ok((select count(*) from u) = 1, 'A can update their own profile');
select throws_ok($$update public.events set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = 'e0000000-0000-4000-8000-000000000001'$$, '42501', null, 'A cannot move an event to B (update with another user_id)');

-- insert with another user's user_id is rejected
select throws_ok($$insert into public.profiles (id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$, '42501', null, 'A cannot insert profiles with B''s user_id');
select throws_ok($$insert into public.categories (user_id, name, hue) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Sneaky', 10)$$, '42501', null, 'A cannot insert categories with B''s user_id');
select throws_ok($$insert into public.goals (user_id, title, hue) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Sneaky', 10)$$, '42501', null, 'A cannot insert goals with B''s user_id');
select throws_ok($$insert into public.series (user_id, weekdays, start_day) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{1}', current_date)$$, '42501', null, 'A cannot insert series with B''s user_id');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_date, 60, 120)$$, '42501', null, 'A cannot insert events with B''s user_id');
select throws_ok($$insert into public.hidden_items (user_id, source, external_key) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'google', 'k')$$, '42501', null, 'A cannot insert hidden_items with B''s user_id');
select throws_ok($$insert into public.event_targets (user_id, event_id, kind, device_id, device_calendar_key) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e0000000-0000-4000-8000-000000000002', 'device', 'd', 'k')$$, '42501', null, 'A cannot insert event_targets with B''s user_id');
select throws_ok($$insert into public.legacy_calendar_blobs (user_id, data) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}')$$, '42501', null, 'A cannot insert legacy_calendar_blobs with B''s user_id');

-- own user_id but pointing at B's rows: the composite (id, user_id) foreign keys reject it
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, category_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date, 60, 120, 'c0000000-0000-4000-8000-000000000002')$$, '23503', null, 'A cannot attach an event to B''s category');
select throws_ok($$insert into public.event_targets (user_id, event_id, kind, device_id, device_calendar_key) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-000000000002', 'device', 'd', 'k')$$, '23503', null, 'A cannot add a target to B''s event');
select throws_ok($$insert into public.goals (user_id, title, hue, category_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 10, 'c0000000-0000-4000-8000-000000000002')$$, '23503', null, 'A cannot attach a goal to B''s category');

-- tables clients cannot write at all
select throws_ok($$insert into public.google_accounts (user_id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'me@example.test')$$, '42501', null, 'A cannot insert google_accounts (service role only)');
select throws_ok($$insert into public.google_calendars (user_id, account_id, google_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-000000000001', 'new')$$, '42501', null, 'A cannot insert google_calendars (service role only)');
select throws_ok($$insert into public.ai_usage (user_id, month, notes) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date_trunc('month', current_date - 40)::date, 1)$$, '42501', null, 'A cannot insert ai_usage (service role only)');
select throws_ok($$insert into public.gcal_links (user_id, map) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}')$$, '42501', null, 'A cannot insert gcal_links (service role only)');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min, source, google_calendar_id, google_event_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date, 60, 120, 'google', '90000000-0000-4000-8000-000000000001', 'x')$$, '42501', null, 'A cannot insert imported (source=google) events');
select lives_ok($$insert into public.events (day, start_min, end_min, title) values (current_date, 60, 120, 'A writes')$$, 'A can insert their own event (user_id defaults to auth.uid())');

-- anon gets nothing
reset role;
set local role anon;
select throws_ok($$select count(*) from public.events$$, '42501', null, 'anon cannot read events');
select throws_ok($$select count(*) from public.categories$$, '42501', null, 'anon cannot read categories');
select throws_ok($$select count(*) from public.goals$$, '42501', null, 'anon cannot read goals');
select throws_ok($$select count(*) from public.series$$, '42501', null, 'anon cannot read series');
select throws_ok($$select count(*) from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select count(*) from public.event_targets$$, '42501', null, 'anon cannot read event_targets');
select throws_ok($$select count(*) from public.google_accounts_public$$, '42501', null, 'anon cannot read google_accounts_public');
select throws_ok($$select count(*) from public.google_calendars$$, '42501', null, 'anon cannot read google_calendars');
select throws_ok($$select count(*) from public.ai_usage$$, '42501', null, 'anon cannot read ai_usage');
select throws_ok($$select count(*) from public.hidden_items$$, '42501', null, 'anon cannot read hidden_items');
select throws_ok($$select count(*) from public.legacy_calendar_blobs$$, '42501', null, 'anon cannot read legacy_calendar_blobs');
select throws_ok($$insert into public.events (user_id, day, start_min, end_min) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date, 60, 120)$$, '42501', null, 'anon cannot insert events');
reset role;

select * from finish();
rollback;
