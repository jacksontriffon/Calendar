-- Seed data for local development (`supabase db reset`) and for the no-Docker test runner.
--
-- One confirmed test user (sign in locally with test@example.com / password123) whose calendar
-- mirrors the prototype's sample data (logic.js): the three goal categories, three goals, the
-- events around "today" (days are relative to the day the database is seeded), plus one weekly
-- series. The new-user trigger creates the profile and the 7 default categories on insert.

-- Fixed ids so other fixtures/tests can refer to them:
--   user 00000000-0000-4000-8000-0000000000a1, goals ...0001a1..a3, series ...0002a1
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-0000000000a1',
  'authenticated', 'authenticated', 'test@example.com',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(), '', '', '', '',
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Test User"}',
  now(), now()
) on conflict (id) do nothing;

insert into auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', id::text, now(), now(), now()
from auth.users
where id = '00000000-0000-4000-8000-0000000000a1'
  and not exists (select 1 from auth.identities i where i.user_id = auth.users.id);

update public.profiles
   set display_name = 'Test User', tz = 'America/Los_Angeles',
       prefs = '{"view":"day3","font":"serif","zoom":1}'
 where id = '00000000-0000-4000-8000-0000000000a1';

-- The prototype's extra categories (one per goal).
insert into public.categories (user_id, name, hue) values
  ('00000000-0000-4000-8000-0000000000a1', 'Deep work',          240),
  ('00000000-0000-4000-8000-0000000000a1', 'Marathon training',  125),
  ('00000000-0000-4000-8000-0000000000a1', 'Reading',            290)
on conflict (user_id, name) do nothing;

insert into public.goals (id, user_id, title, outcome, hours, start_date, deadline, hue, category_id, legacy_id)
select g.id, '00000000-0000-4000-8000-0000000000a1', g.title, g.outcome, g.hours,
       current_date + g.start_off, current_date + g.deadline_off, g.hue, c.id, g.legacy_id
from (values
  ('00000000-0000-4000-8000-0000000001a1'::uuid, 'Deep work',         'Ship the sync layer rewrite', 70, -20, 25, 255, 'g1'),
  ('00000000-0000-4000-8000-0000000001a2'::uuid, 'Marathon training', 'Run a sub-4 hour marathon',   95, -24, 66, 132, 'g2'),
  ('00000000-0000-4000-8000-0000000001a3'::uuid, 'Reading',           'Finish four books',           14,  -4, 13, 290, 'g3')
) as g(id, title, outcome, hours, start_off, deadline_off, hue, legacy_id)
join public.categories c on c.user_id = '00000000-0000-4000-8000-0000000000a1' and c.name = g.title
on conflict do nothing;

-- A weekly series: "Weekly review", Fridays 16:00-16:30, materialised for the weeks around today.
insert into public.series (id, user_id, freq, weekdays, start_day)
values ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000000a1', 'weekly', '{5}',
        current_date - 14)
on conflict do nothing;

insert into public.events (user_id, title, category_id, day, start_min, end_min, series_id, legacy_id)
select '00000000-0000-4000-8000-0000000000a1', 'Weekly review', c.id, d.day, 960, 990,
       '00000000-0000-4000-8000-0000000002a1', 'series-wr-' || to_char(d.day, 'YYYYMMDD')
from (select current_date - 14 + n as day from generate_series(0, 42) n) d
join public.categories c on c.user_id = '00000000-0000-4000-8000-0000000000a1' and c.name = 'Work'
where extract(dow from d.day) = 5
on conflict do nothing;

-- The prototype's events: (day offset, category, title, start, end, done). 'Family brunch' is
-- public so the visibility UI has something to show; it also queues one publish job, which is a
-- no-op until google-sync exists and calendars are connected.
insert into public.events (user_id, day, category_id, title, start_min, end_min, done, visibility, legacy_id)
select '00000000-0000-4000-8000-0000000000a1', current_date + e.off, c.id, e.title, e.s, e.e, e.done, e.vis, 'e' || e.n
from (values
  (1,  -17, 'Marathon training', 'Tempo 6k',                    1080, 1125, true,  'private'),
  (2,  -16, 'Deep work',         'Sync spec',                    540,  720, true,  'private'),
  (3,  -15, 'Deep work',         'Sync spec review',             570,  660, true,  'private'),
  (4,  -14, 'Marathon training', 'Long run',                     480,  570, true,  'private'),
  (5,  -12, 'Marathon training', 'Easy 6k',                     1050, 1095, true,  'private'),
  (6,  -10, 'Deep work',         'Prototype conflict handling',  540,  750, true,  'private'),
  (7,   -9, 'Deep work',         'Conflict handling, part two',  540,  690, true,  'private'),
  (8,   -8, 'Deep work',         'Tests for the merge path',     780,  900, true,  'private'),
  (9,   -7, 'Marathon training', 'Long run',                     480,  590, true,  'private'),
  (10,  -6, 'Deep work',         'Offline queue',                540,  690, true,  'private'),
  (11,  -5, 'Marathon training', 'Intervals',                   1080, 1135, true,  'private'),
  (12,  -3, 'Deep work',         'Schema migration',             570,  750, true,  'private'),
  (13,  -3, 'Marathon training', 'Intervals',                   1080, 1140, true,  'private'),
  (14,  -3, 'Reading',           'Reading',                     1275, 1320, true,  'private'),
  (15,  -2, 'Deep work',         'Migration, part two',          540,  720, true,  'private'),
  (16,  -2, 'Reading',           'Reading',                     1260, 1310, true,  'private'),
  (17,  -1, 'Health',            'Morning pages',                450,  480, false, 'private'),
  (18,  -1, 'Deep work',         'Rewrite the sync layer',       540,  690, true,  'private'),
  (19,  -1, 'Social',            'Lunch with Dan',               750,  795, false, 'private'),
  (20,  -1, 'Marathon training', 'Easy 8k',                     1050, 1110, true,  'private'),
  (21,  -1, 'Reading',           'Reading',                     1260, 1305, true,  'private'),
  (22,   0, 'Food',              'Coffee + plan the day',        480,  505, false, 'private'),
  (23,   0, 'Deep work',         'Sync layer, part two',         540,  690, false, 'private'),
  (24,   0, 'Pets',              'Dog walk',                    1050, 1090, false, 'private'),
  (25,   1, 'Marathon training', 'Long run',                     480,  600, false, 'private'),
  (26,   1, 'Family',            'Family brunch',                660,  750, false, 'public')
) as e(n, off, cat, title, s, e, done, vis)
join public.categories c on c.user_id = '00000000-0000-4000-8000-0000000000a1' and c.name = e.cat
on conflict do nothing;
