-- The row shapes legacy-import writes (supabase/functions/legacy-import) against the real tables:
-- same columns as its inserts, `on conflict ... do nothing` on the idempotency keys, and the
-- check constraints its sanitising is meant to satisfy.
--
-- pgTAP test (runs under `supabase test db`, and under supabase/tests/local/run.sh with the mini
-- pgTAP in tests/local/shim.sql). Everything happens inside a transaction that is rolled back.
begin;
select plan(18);

insert into auth.users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test');
-- the new-user trigger created the profile and the default categories
select ok(exists (select 1 from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Work'), 'default categories exist before the import (so it reuses them by name)');

-- ---------------------------------------------------------------- categories
insert into public.categories (user_id, name, hue) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Work', 99), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Deep work', 1000)
  on conflict (user_id, name) do nothing;
select is((select count(*)::int from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Work'), 1, 'an existing category is not duplicated');
select ok((select hue from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Work') <> 99, '...and keeps its hue');
select is((select hue from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Deep work'), 1000::smallint, 'a new category takes the grey swatch 1000');

-- ------------------------------------------------------------------- series
create function pg_temp.series_row() returns void language sql as $$
  insert into public.series (user_id, freq, weekdays, start_day, "until", legacy_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'weekly', '{1,3}', '2026-09-21', null, 's1')
  on conflict (user_id, legacy_id) do nothing
$$;
select pg_temp.series_row();
select pg_temp.series_row();
select is((select count(*)::int from public.series where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 's1'), 1, 'series upsert on (user_id, legacy_id) is idempotent');

-- -------------------------------------------------------------------- goals
create function pg_temp.goal_row(h numeric) returns void language sql as $$
  insert into public.goals (user_id, title, outcome, deadline, hours, hue, category_id, start_date, created_at, legacy_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Marathon training', 'Run a marathon', '2026-12-01', h, 206,
          (select id from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Deep work'), '2026-09-01', '2026-10-30T12:00:00Z', 'g1')
  on conflict (user_id, legacy_id) do nothing
$$;
select pg_temp.goal_row(60);
select pg_temp.goal_row(75);
select is((select count(*)::int from public.goals where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 'g1'), 1, 'goal upsert on (user_id, legacy_id) is idempotent');
select is((select hours from public.goals where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 'g1'), 60::numeric, '...and a re-run does not overwrite the goal');
select lives_ok($$insert into public.goals (user_id, title, outcome, deadline, hours, hue, category_id, start_date, created_at, legacy_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'No deadline', '', null, 0, 47, null, '2026-09-01', now(), 'g2')$$, 'a goal without a deadline or category is accepted');

-- ------------------------------------------------------------------- events
create function pg_temp.event_row(l text, vis text, d date, s integer, e integer, ad boolean, dy integer, ttl text default 'T') returns void language sql as $$
  insert into public.events (user_id, title, category_id, day, start_min, end_min, all_day, days, done, pauses, win, series_id, visibility, source,
                             google_calendar_id, google_event_id, etag, organizer_email, is_mine, updated_at, deleted_at, legacy_id, win_asked, created_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ttl, (select id from public.categories where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name = 'Work'),
          d, s, e, ad, dy, true, '[[970,980]]', '{"text":"ok","at":1790000000000}', (select id from public.series where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 's1'), vis, 'app',
          null, null, null, null, true, '2026-10-30T12:00:00Z', null, l, true, '2026-09-10T00:26:40Z')
  on conflict (user_id, legacy_id) do nothing
$$;
select lives_ok($$select pg_temp.event_row('e1', 'public', '2026-09-23', 960, 1020, false, 1)$$, 'an imported event row is accepted');
select lives_ok($$select pg_temp.event_row('e2', 'private', '2026-09-25', 0, 1440, true, 3)$$, '...also an all-day one');
select lives_ok($$select pg_temp.event_row('e3', 'private', '2026-09-26', 1320, 1800, false, 1)$$, '...and one running past midnight');
select lives_ok($$select pg_temp.event_row('e4', 'private', '2026-09-27', 1439, 2879, false, 1)$$, '...and the longest allowed one');
select throws_ok($$select pg_temp.event_row('e5', 'private', '2026-09-27', 600, 600, false, 1)$$, '23514', null, 'a zero-length event violates the table check (which is why the import gives it 15 minutes)');
select throws_ok($$select pg_temp.event_row('e6', 'private', '2026-09-27', 1500, 1600, false, 1)$$, '23514', null, 'so does a start past 23:59 (the import clamps it)');
select pg_temp.event_row('e1', 'private', '2026-09-29', 60, 120, false, 1, 'edited later');
select is((select count(*)::int from public.events where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 'e1'), 1, 'event upsert on (user_id, legacy_id) is idempotent');
select is((select title from public.events where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 'e1'), 'T', '...and a re-run does not overwrite the event');
select is((select count(*)::int from pgmq.q_publish where message ->> 'event_id' = (select id::text from public.events where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 'e1')), 1, 'a public imported event is queued for publishing once');

-- ------------------------------------------------------------ event_targets
insert into public.google_accounts (id, user_id, email) values ('70000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@gmail.test');
insert into public.google_calendars (id, user_id, account_id, google_id, name, access_role, is_primary)
  values ('90000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000000-0000-4000-8000-000000000001', 'primary', 'a@gmail.test', 'owner', true);
create function pg_temp.target_row() returns void language sql as $$
  insert into public.event_targets (user_id, event_id, kind, google_calendar_id, external_id, fingerprint, status, synced_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.events where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and legacy_id = 'e1'), 'google', '90000000-0000-4000-8000-000000000001', 'gev-1', null, 'synced', '2026-10-30T12:00:00Z')
  on conflict (event_id, google_calendar_id) do nothing
$$;
select pg_temp.target_row();
select pg_temp.target_row();
select is((select count(*)::int from public.event_targets where external_id = 'gev-1'), 1, 'a legacy Google link becomes one synced google target, idempotently');

select * from finish();
rollback;
