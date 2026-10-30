-- Checks that supabase/seed.sql produced the sample calendar. Skipped if the seed user isn't there
-- (e.g. a database reset with seeding disabled).
select not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000000a1') as no_seed \gset
\if :no_seed
\echo '1..0 # SKIP seed user not present'
\q
\endif

begin;
select plan(8);

select is((select email from auth.users where id = '00000000-0000-4000-8000-0000000000a1'), 'test@example.com', 'seed user exists');
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000a1'), 'Test User', 'seed profile');
select is((select count(*)::int from public.categories where user_id = '00000000-0000-4000-8000-0000000000a1'), 10, '7 default categories + the 3 goal categories');
select is((select count(*)::int from public.goals where user_id = '00000000-0000-4000-8000-0000000000a1'), 3, '3 goals');
select is((select count(*)::int from public.series where user_id = '00000000-0000-4000-8000-0000000000a1'), 1, '1 series');
select ok((select count(*) from public.events where user_id = '00000000-0000-4000-8000-0000000000a1' and series_id is null) = 26, 'the prototype''s 26 sample events');
select ok((select count(*) from public.events where series_id = '00000000-0000-4000-8000-0000000002a1') >= 6, 'the series is materialised into events');
select ok((select count(*) from public.events where user_id = '00000000-0000-4000-8000-0000000000a1' and visibility = 'public') = 1, 'one public sample event');

select * from finish();
rollback;
