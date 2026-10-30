-- Triggers: updated_at bump, publish enqueue, new-user bootstrap.
-- (The `publish` / `import` queues themselves are created in the next migration; the publish trigger
-- only touches them at run time.)

-- --------------------------------------------------------------- updated_at
-- Server-side LWW clock for sync: every UPDATE bumps updated_at, whatever the client sent.
-- clock_timestamp() (not now()) so two updates in one transaction still order.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger profiles_set_updated_at        before update on public.profiles         for each row execute function public.set_updated_at();
create trigger categories_set_updated_at      before update on public.categories       for each row execute function public.set_updated_at();
create trigger goals_set_updated_at           before update on public.goals            for each row execute function public.set_updated_at();
create trigger series_set_updated_at          before update on public.series           for each row execute function public.set_updated_at();
create trigger events_set_updated_at          before update on public.events           for each row execute function public.set_updated_at();
create trigger google_accounts_set_updated_at before update on public.google_accounts  for each row execute function public.set_updated_at();
create trigger google_calendars_set_updated_at before update on public.google_calendars for each row execute function public.set_updated_at();
create trigger event_targets_set_updated_at   before update on public.event_targets    for each row execute function public.set_updated_at();
create trigger ai_usage_set_updated_at        before update on public.ai_usage         for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ publish enqueue
-- When an app event is public, or was public before the change (so the Google/phone copies get
-- removed when it goes private or is soft-deleted), enqueue `publish:{event_id,user_id}`.
--   * Private-only events never enqueue: they never leave the app.
--   * Imported events (source = 'google') never enqueue: they came from Google, and publishing
--     them back would loop.
--   * No-op updates (nothing but updated_at differs) don't enqueue.
--   * Hard DELETEs don't enqueue: the event's event_targets cascade away with it, so there is
--     nothing left to unpublish. Deletion is soft (deleted_at), which is an UPDATE.
-- Runs in the writer's transaction, so the job exists iff the change committed.
create function public.enqueue_event_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source <> 'app' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.visibility <> 'public' then
      return null;
    end if;
  else
    if old.visibility <> 'public' and new.visibility <> 'public' then
      return null;
    end if;
    if (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
      return null;
    end if;
  end if;

  perform pgmq.send('publish', jsonb_build_object('event_id', new.id, 'user_id', new.user_id));
  return null;
end;
$$;

create trigger events_enqueue_publish
  after insert or update on public.events
  for each row execute function public.enqueue_event_publish();

-- ---------------------------------------------------------------- new user
-- profiles row + the seven default categories, with the prototype's hues (DEFCATS / HUES in the
-- prototype's logic).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  insert into public.categories (user_id, name, hue)
  values
    (new.id, 'Work',    255),
    (new.id, 'Food',     72),
    (new.id, 'Health',  132),
    (new.id, 'Family',   28),
    (new.id, 'Social',   12),
    (new.id, 'Routine', 104),
    (new.id, 'Pets',    166)
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger functions are never called directly.
revoke all on function public.set_updated_at()         from public, anon, authenticated;
revoke all on function public.enqueue_event_publish()  from public, anon, authenticated;
revoke all on function public.handle_new_user()        from public, anon, authenticated;
