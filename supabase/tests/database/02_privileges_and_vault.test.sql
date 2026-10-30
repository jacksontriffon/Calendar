-- Column-level privileges, Vault tokens, event_targets, ai_usage, legacy tables
--
-- pgTAP test (runs under `supabase test db`, and under supabase/tests/local/run.sh with the mini
-- pgTAP in tests/local/shim.sql). Everything happens inside a transaction that is rolled back.
begin;
select plan(59);

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

-- ========================================================================== google_accounts token
-- A has a Vault-stored refresh token (set the way the edge functions do it).
select ok(public.set_google_refresh_token('70000000-0000-4000-8000-000000000001', 'refresh-token-A') is not null, 'service helper stores the refresh token in Vault');
select ok((select refresh_token_id from public.google_accounts where id = '70000000-0000-4000-8000-000000000001') is not null, 'google_accounts.refresh_token_id points at the Vault secret');
select is((select decrypted_secret from vault.decrypted_secrets where id = (select refresh_token_id from public.google_accounts where id = '70000000-0000-4000-8000-000000000001')), 'refresh-token-A', 'the secret holds the token');
select is(public.get_google_refresh_token('70000000-0000-4000-8000-000000000001'), 'refresh-token-A', 'service helper reads it back');
select lives_ok($$select public.set_google_refresh_token('70000000-0000-4000-8000-000000000001', 'refresh-token-A2')$$, 'rotating the token updates the secret');
select is((select count(*)::int from vault.secrets where name like 'google_refresh_token:%'), 1, 'rotation reuses the same Vault secret');
select is(public.get_google_refresh_token('70000000-0000-4000-8000-000000000001'), 'refresh-token-A2', 'rotated token is returned');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select throws_ok($$select refresh_token_id from public.google_accounts$$, '42501', null, 'client cannot select refresh_token_id');
select throws_ok($$select * from public.google_accounts$$, '42501', null, 'select * on the base table is refused (token column is not granted)');
select throws_ok($$select id from public.google_accounts where refresh_token_id is not null$$, '42501', null, 'client cannot even filter on refresh_token_id');
select lives_ok($$select id, email, status from public.google_accounts$$, 'client can select the non-token columns');
select ok((select count(*) from public.google_accounts_public) = 1, 'google_accounts_public returns only the caller''s account');
select ok((select to_jsonb(v)::text from public.google_accounts_public v limit 1) not like '%refresh%', 'google_accounts_public rows carry no token column');
select throws_ok($$select * from vault.decrypted_secrets$$, '42501', null, 'client cannot read Vault');
select throws_ok($$select public.get_google_refresh_token('70000000-0000-4000-8000-000000000001')$$, '42501', null, 'client cannot call get_google_refresh_token');
select throws_ok($$select public.set_google_refresh_token('70000000-0000-4000-8000-000000000001', 'evil')$$, '42501', null, 'client cannot call set_google_refresh_token');
select throws_ok($$update public.google_accounts set status = 'ok'$$, '42501', null, 'client cannot update google_accounts');

reset role;
set local role service_role;
select is(public.get_google_refresh_token('70000000-0000-4000-8000-000000000001'), 'refresh-token-A2', 'service role can read the token through the helper');
select ok((select count(*) from public.google_accounts where user_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) = 2, 'service role bypasses RLS');
reset role;

-- Deleting the account row removes its secret.
delete from public.google_accounts where id = '70000000-0000-4000-8000-000000000001';
select is((select count(*)::int from vault.secrets where name like 'google_refresh_token:%'), 0, 'deleting a google account deletes its Vault secret');
-- ...and so does deleting the user (cascade).
select public.set_google_refresh_token('70000000-0000-4000-8000-000000000002', 'refresh-token-B');
delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*)::int from vault.secrets where name like 'google_refresh_token:%'), 0, 'deleting a user deletes the Vault secret of their google accounts');
select is((select count(*)::int from public.events where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'deleting a user cascades to their events');

-- ========================================================================== google_calendars
-- A (account 1 was deleted above, so recreate a small set). reader calendar for the publish check.
insert into public.google_accounts (id, user_id, email) values ('70000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cal-owner@example.test');
insert into public.google_calendars (id, user_id, account_id, google_id, name, access_role)
  values ('90000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-0000000000a1', 'writer-cal', 'Writer', 'writer'),
         ('90000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-0000000000a1', 'reader-cal', 'Reader', 'reader');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select ok((select count(*) from public.google_calendars) = 2, 'client reads its google_calendars');
select lives_ok($$update public.google_calendars set show_in_app = true where id = '90000000-0000-4000-8000-0000000000a1'$$, 'client can toggle show_in_app');
select lives_ok($$update public.google_calendars set can_publish = true where id = '90000000-0000-4000-8000-0000000000a1'$$, 'client can toggle can_publish on a writable calendar');
select ok((select show_in_app and can_publish from public.google_calendars where id = '90000000-0000-4000-8000-0000000000a1'), 'both toggles stuck');
select lives_ok($$update public.google_calendars set show_in_app = false, can_publish = false where id = '90000000-0000-4000-8000-0000000000a1'$$, 'client can update both toggles at once');
select throws_ok($$update public.google_calendars set name = 'renamed' where id = '90000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'client cannot update name');
select throws_ok($$update public.google_calendars set access_role = 'owner' where id = '90000000-0000-4000-8000-0000000000a2'$$, '42501', null, 'client cannot escalate access_role');
select throws_ok($$update public.google_calendars set sync_token = 'x' where id = '90000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'client cannot update sync_token');
select throws_ok($$update public.google_calendars set channel_id = 'x' where id = '90000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'client cannot update channel_id');
select throws_ok($$update public.google_calendars set is_primary = true where id = '90000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'client cannot update is_primary');
select throws_ok($$update public.google_calendars set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = '90000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'client cannot reassign user_id');
select throws_ok($$update public.google_calendars set show_in_app = true, name = 'sneaky' where id = '90000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'a mixed update touching a forbidden column is refused as a whole');
select throws_ok($$update public.google_calendars set can_publish = true where id = '90000000-0000-4000-8000-0000000000a2'$$, '23514', null, 'cannot publish to a read-only calendar (check constraint)');
select throws_ok($$delete from public.google_calendars where id = '90000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'client cannot delete calendars');
select throws_ok($$insert into public.google_calendars (account_id, google_id) values ('70000000-0000-4000-8000-0000000000a1', 'x')$$, '42501', null, 'client cannot insert calendars');
reset role;
select ok((select updated_at from public.google_calendars where id = '90000000-0000-4000-8000-0000000000a1') > (select created_at from public.google_calendars where id = '90000000-0000-4000-8000-0000000000a1'), 'updated_at is bumped on update');

-- ========================================================================== event_targets
-- (A's original google target went with the account deleted above; add one on the new calendar.)
insert into public.event_targets (id, user_id, event_id, kind, google_calendar_id)
  values ('60000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-000000000001', 'google', '90000000-0000-4000-8000-0000000000a1');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select lives_ok($$insert into public.event_targets (event_id, kind, device_id, device_calendar_key) values ('e0000000-0000-4000-8000-000000000001', 'device', 'dev-2', 'cal-key')$$, 'client can add a device target for its own event');
select throws_ok($$insert into public.event_targets (event_id, kind, google_calendar_id) values ('e0000000-0000-4000-8000-000000000001', 'google', '90000000-0000-4000-8000-0000000000a1')$$, '42501', null, 'client cannot add a google target');
select throws_ok($$update public.event_targets set kind = 'google', device_id = null, device_calendar_key = null, google_calendar_id = '90000000-0000-4000-8000-0000000000a1' where id = '40000000-0000-4000-8000-000000000001'$$, '42501', null, 'client cannot turn a device target into a google target');
select throws_ok($$insert into public.event_targets (event_id, kind, device_id) values ('e0000000-0000-4000-8000-000000000001', 'device', 'dev-3')$$, '23514', null, 'a device target needs device_id and device_calendar_key');
select throws_ok($$insert into public.event_targets (event_id, kind, device_id, device_calendar_key, status) values ('e0000000-0000-4000-8000-000000000001', 'device', 'dev-4', 'k', 'bogus')$$, '23514', null, 'target status is constrained');
with u as (update public.event_targets set status = 'synced', external_id = 'ek1' where id = '40000000-0000-4000-8000-000000000001' returning 1) select ok((select count(*) from u) = 1, 'client can update its own device target');
with u as (update public.event_targets set status = 'synced' where id = '60000000-0000-4000-8000-000000000001' returning 1) select ok((select count(*) from u) = 0, 'client cannot update a google target (not even its own)');
with d as (delete from public.event_targets where id = '60000000-0000-4000-8000-000000000001' returning 1) select ok((select count(*) from d) = 0, 'client cannot delete a google target');
select ok((select count(*) from public.event_targets where kind = 'google') = 1, 'client can still read its google target status');
with d as (delete from public.event_targets where id = '40000000-0000-4000-8000-000000000001' returning 1) select ok((select count(*) from d) = 1, 'client can delete its own device target');
reset role;
set local role service_role;
select lives_ok($$update public.event_targets set status = 'synced', synced_at = now() where id = '60000000-0000-4000-8000-000000000001'$$, 'service role can write google targets');
select is((select status from public.event_targets where id = '60000000-0000-4000-8000-000000000001'), 'synced', 'the service-role write took effect');
reset role;
-- Targets follow their event.
delete from public.events where id = 'e0000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.event_targets where event_id = 'e0000000-0000-4000-8000-000000000001'), 0, 'deleting an event deletes its targets');

-- ========================================================================== ai_usage
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select is((select notes from public.ai_usage where month = date_trunc('month', current_date)::date), 3, 'client can read its usage');
select throws_ok($$update public.ai_usage set notes = 0$$, '42501', null, 'client cannot reset its usage');
reset role;
set local role service_role;
select lives_ok($$insert into public.ai_usage (user_id, month, notes) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (date_trunc('month', current_date) - interval '1 month')::date, 7)$$, 'service role can write usage');
select lives_ok($$update public.ai_usage set notes = notes + 1 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$, 'service role can update usage');
reset role;
select throws_ok($$insert into public.ai_usage (user_id, month) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2026-01-15')$$, '23514', null, 'usage month must be the first of a month');

-- ========================================================================== legacy tables
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select lives_ok($$insert into public.calendars (user_id, data) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"x":1}') on conflict (user_id) do update set data = excluded.data$$, 'the old app''s upsert (on_conflict=user_id) still works through the public.calendars view');
select is((select data ->> 'x' from public.legacy_calendar_blobs where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), '1', '...and lands in legacy_calendar_blobs');
select ok((select count(*) from public.gcal_links) = 1, 'client can read its gcal_links row');
reset role;

select * from finish();
rollback;
