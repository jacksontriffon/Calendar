# Google edge functions

`google-connect`, `google-sync` and `google-webhook` (plan §5). The code lives here; each function's `index.ts` only builds its dependencies from the environment and calls `handlers.ts` / `webhook.ts`.

| File | What |
|---|---|
| `connect.ts` | OAuth `start` / `reconnect` / `callback` / `list` / `disconnect`, calendar-list sync |
| `import.ts` | Google → `events` (`syncToken` incremental sync, bounded first window, 410 resync, echo suppression) |
| `publish.ts`, `publish_map.ts` | `event_targets` → Google create/patch/delete, fingerprints, weekly RRULE series, the privacy guard |
| `watch.ts`, `webhook.ts` | `events.watch` channels (HMAC token) and the push-notification handler |
| `sync.ts` | queue `drain`, `renew_watch`, `sync_now`, per-user lock |
| `mapping.ts`, `tz.ts` | pure mappings and time-zone conversion |
| `api.ts` | Google HTTP client with bounded exponential backoff |
| `db.ts` | `GoogleDb` interface + Supabase implementation (tests use `testing/fake_db.ts`) |
| `config.ts`, `http.ts` | env + wiring, small HTTP helpers (to be folded into the shared cors/auth helpers) |

## Secrets and settings

Set as function secrets (`supabase secrets set ...`). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.

| Name | Used by | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | connect, sync | OAuth client id (Web application type) |
| `GOOGLE_CLIENT_SECRET` | connect, sync | its secret |
| `GOOGLE_REDIRECT_URI` | connect, sync | `https://<ref>.supabase.co/functions/v1/google-connect`; must be an authorised redirect URI of the OAuth client, and identical in `start` and the code exchange |
| `GOOGLE_RETURN_URLS` | connect | comma-separated allow-list, e.g. `aicalendar://google/connected,https://www.claude-calendar.com`. An `http(s)` entry without a path allows any path on that origin; a custom-scheme entry must match host and path exactly. Anything else is refused (400) |
| `GOOGLE_WEBHOOK_SECRET` | sync, webhook | long random string; channel token = HMAC-SHA256(secret, channel id) |
| `GOOGLE_WEBHOOK_URL` | sync | optional; defaults to `$SUPABASE_URL/functions/v1/google-webhook`. Google only delivers to public `https` URLs, so on a local stack the channel creation fails (logged, import still works) |

`config.toml` needs `verify_jwt = false` for all three functions: Google's OAuth redirect and push notifications carry no JWT, and the functions check credentials themselves (`google-connect`: user JWT for every action except the `GET` callback, which validates its own `state`; `google-sync`: the service-role key, or a user JWT for `sync_now` only; `google-webhook`: the channel token). That also makes them work with `sb_secret_...` keys.

Google Cloud: enable the Calendar API; scopes `calendar.events`, `calendar.readonly`, `openid`, `email` (the first is sensitive: verification needed before non-test users).

## Request shapes

`google-connect`
- `POST {action:'start', return_url?, login_hint?}` → `{url}` (return URL defaults to the first allow-listed entry)
- `POST {action:'reconnect', account_id, return_url?}` → `{url}` (login hint = the account's email; a different Google account is refused with `?error=wrong_account`)
- `GET ?code=&state=` is the callback; it redirects to the return URL with `?connected=1&account_id=…`, or `?error=` (`access_denied`, `missing_scope`, `no_refresh_token`, `no_email`, `wrong_account`, `token_exchange_failed`, `server_error`). An unknown/expired/replayed `state` is a plain 400 (there is nowhere trustworthy to redirect)
- `POST {action:'list'}` → `{accounts:[{id,email,status,calendars:[…]}]}` (refreshes each signed-in account; `invalid_grant` sets `needs_signin`)
- `POST {action:'disconnect', account_id}` revokes the token, stops channels, deletes the account (calendars, imported events, targets cascade; Vault secret is deleted by trigger). Copies the user published stay on Google.

`google-sync` (see `supabase/README.md` for the consumer contract)
- service role: `{action:'drain', queue, jobs}`, `{action:'renew_watch', calendars}`
- user JWT or service role: `{action:'sync_now', calendar_id?}` (a user JWT is always that user's calendars). The client should call it after toggling *Show in app*; the 15-minute sweep is the fallback (and, with `enqueue_import_sweep` as replaced by `20261030121000`, also purges calendars that were turned off).

Client-side publishing: the client picks Google targets with `rpc('set_event_google_targets', { p_event_id, p_calendar_ids, p_apply_to_series })` (RLS still forbids direct writes to `google` targets). Retry = call it again with the same list.

## Behaviour and limitations

- **Times**: Google `dateTime` → floating local `day`/`start_min`/`end_min` in `profiles.tz` (wall-clock, so DST changes keep the displayed hours). Crossing midnight → `end_min` > 1440. Timed events longer than 24 h are clipped to `start_min + 1440`; zero/negative length → 15 min. All-day → `all_day`, `days` = span (max 366).
- **Import**: first sync = 30 days back to 180 ahead, `singleEvents=true`; then `syncToken`. A token keeps its first window, so a full sync is repeated every 14 days. `410` → clear token, full resync; imported events in the window that Google no longer returns are soft-deleted. Cancelled and self-declined events soft-delete; working-location events are skipped. Own published copies are skipped (target `external_id`, its recurring instances, or our `aiCalendarEventId` private property).
- **`is_mine`**: creator or organizer email equals the account email (case-insensitive); nothing else (Google's `self` flag is about the calendar, not the user).
- **Publish**: public + live + target present → create/patch (fingerprint of title, times, all-day span, RRULE, zone); private, soft-deleted or unticked → delete the Google copy. Creating is crash-safe (the Google id is written to the target first and sent as the event id). A target on a calendar that is no longer *Can publish to* is marked `failed` and Google is not touched. Never sent: private events (guarded in `buildGoogleEvent`, plus a re-read before each write), imported events.
- **Series** publish as one Google event per calendar with an RRULE from the first targeted occurrence; `UNTIL` follows `series.until`. Limitation: edits to a single occurrence (move, retitle, delete, privatise) and partial un-publishing are not reflected until the whole series changes; the anchor occurrence drives title/time.
- **Errors**: 429, 5xx, rate-limit 403s and network errors retry 4 times with exponential backoff (0.5 s doubling, jittered, `Retry-After` honoured). Transient failures leave the queue message un-acked (and the target `failed`); permanent ones are recorded and acked. `invalid_grant` → account `needs_signin`; reconnecting re-queues failed targets and imports.
- A shared calendar's `shared` flag: any non-owner role, or an owned calendar whose ACL has a rule for anyone but the account.
