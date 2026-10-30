-- ai_claim / ai_refund (monthly allowance + per-minute rate limit for ai-schedule) and series.legacy_id
--
-- pgTAP test (runs under `supabase test db`, and under supabase/tests/local/run.sh with the mini
-- pgTAP in tests/local/shim.sql). Everything happens inside a transaction that is rolled back.
begin;
select plan(41);

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

-- ========================================================================== series.legacy_id
select lives_ok($$insert into public.series (user_id, weekdays, start_day, legacy_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{1}', current_date, 's1')$$, 'a series can carry a legacy id');
select throws_ok($$insert into public.series (user_id, weekdays, start_day, legacy_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{2}', current_date, 's1')$$, '23505', null, 'the same legacy id twice for one user is refused (idempotent import)');
select lives_ok($$insert into public.series (user_id, weekdays, start_day, legacy_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{1}', current_date, 's1')$$, 'another user may reuse the legacy id');
select lives_ok($$insert into public.series (user_id, weekdays, start_day) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{3}', current_date), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{4}', current_date)$$, 'series without a legacy id can repeat');

-- ========================================================================== ai_claim
create temp table r1 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5, 2);
select ok((select allowed from r1), 'the first call is allowed');
select is((select reason from r1), 'ok', '...with reason ok');
select is((select used from r1), 1, '...and counts one note');
select is((select usage_month from r1), date_trunc('month', timezone('utc', now()))::date, '...in the current UTC month');
select is((select notes from public.ai_usage where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1, 'ai_usage was incremented');
select is((select count(*)::int from public.ai_calls where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1, 'and a rate-window row recorded');

create temp table r2 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5, 2);
select is((select used from r2), 2, 'the second call in the minute is allowed (per-minute limit 2)');

create temp table r3 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5, 2);
select ok(not (select allowed from r3), 'the third call within a minute is refused');
select is((select reason from r3), 'rate', '...as a rate limit');
select ok((select retry_after from r3) between 1 and 60, '...with a retry_after in seconds');
select is((select used from r3), 2, '...and reports the notes used so far');
select is((select notes from public.ai_usage where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 2, 'a refused call does not count');
select is((select count(*)::int from public.ai_calls where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 2, '...and is not recorded in the window');

-- The window slides: calls older than a minute stop counting.
update public.ai_calls set called_at = clock_timestamp() - interval '61 seconds' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
create temp table r4 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5, 2);
select ok((select allowed from r4), 'calls older than a minute no longer count against the rate limit');
select is((select used from r4), 3, '...but still count against the month');
select is((select count(*)::int from public.ai_calls where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 3, 'old window rows are kept for five minutes');
update public.ai_calls set called_at = clock_timestamp() - interval '10 minutes' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 100, 100);
select is((select count(*)::int from public.ai_calls where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1, 'rows older than five minutes are pruned');

-- Monthly allowance: notes is now 4; a limit of 4 is exhausted even though the rate window is empty.
update public.ai_calls set called_at = clock_timestamp() - interval '2 minutes' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
create temp table r5 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 4, 10);
select ok(not (select allowed from r5), 'at the monthly limit the call is refused');
select is((select reason from r5), 'limit', '...as a monthly limit');
select is((select used from r5), 4, '...reporting used = limit');
select is((select retry_after from r5), 0, '...with no retry_after');
select is((select notes from public.ai_usage where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 4, 'a refused call at the limit does not count');

-- The monthly check wins when both limits are hit.
create temp table r6 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 4, 0);
select is((select reason from r6), 'limit', 'the monthly limit is reported before the rate limit');
create temp table r7 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, 10);
select ok(not (select allowed from r7) and (select reason from r7) = 'limit', 'a limit of 0 refuses everything');
select throws_ok($$select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', -1, 5)$$, '22023', null, 'negative limits are rejected');

-- Another month's usage doesn't count (the key is (user, month)).
insert into public.ai_usage (user_id, month, notes) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (date_trunc('month', now()) - interval '1 month')::date, 150);
create temp table r8 as select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200, 10);
select is((select used from r8), 5, 'last month''s notes do not count towards this month');

-- ========================================================================== isolation
create temp table r9 as select * from public.ai_claim('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 5, 2);
select is((select used from r9), 1, 'another user has their own count');
select is((select count(*)::int from public.ai_calls where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1, '...and their own rate window');

-- ========================================================================== ai_refund
select is(public.ai_refund('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'ai_refund gives the note back');
select is(public.ai_refund('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, '...and never goes below zero');
select is(public.ai_refund('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 0, '...or fails for a user without usage');

-- ========================================================================== privileges
select ok(has_function_privilege('service_role', 'public.ai_claim(uuid,integer,integer)', 'execute'), 'service_role can execute ai_claim');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select throws_ok($$select * from public.ai_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5, 5)$$, '42501', null, 'a client cannot call ai_claim');
select throws_ok($$select public.ai_refund('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '42501', null, 'a client cannot call ai_refund');
select throws_ok($$select * from public.ai_calls$$, '42501', null, 'a client cannot read ai_calls');
select throws_ok($$update public.ai_usage set notes = 0$$, '42501', null, 'a client cannot reset its own usage');
reset role;

-- ========================================================================== cascade
delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*)::int from public.ai_calls where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'deleting the user removes their rate-window rows');

select * from finish();
rollback;
