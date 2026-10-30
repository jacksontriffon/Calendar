-- pg_cron jobs. They run as postgres and call the SECURITY DEFINER functions from the queues
-- migration, which read `project_url` / `service_role_key` from Vault and POST to the google-sync
-- edge function through pg_net. cron.schedule(name, ...) with an existing name updates that job,
-- so this migration is safe to re-run.

-- Every minute: drain the publish and import queues into google-sync.
select cron.schedule('calendar-queue-consumer', '* * * * *', $$select public.run_queue_consumer()$$);

-- Every 15 minutes: queue an import for every calendar shown in the app (fallback for missed
-- Google push notifications).
select cron.schedule('calendar-import-sweep', '*/15 * * * *', $$select public.enqueue_import_sweep()$$);

-- Daily at 03:17 UTC: renew Google watch channels that are missing or expire within 2 days
-- (Google channels live ~7 days, so this renews them about every 5-6 days).
select cron.schedule('calendar-watch-renewal', '17 3 * * *', $$select public.renew_watch_channels()$$);
