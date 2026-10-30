# Local-first store spike (phase 3)

Plan §6 asks for a spike on Legend-State v3 with its Supabase sync plugin, MMKV on native and IndexedDB on web, before building on it. This is what the spike found and what was built.

## Decision

**Legend-State v3 is not used. The app ships the plan's fallback: a small hand-written outbox + pull sync on supabase-js** (`engine.ts`, `remote.ts`), with MMKV on native and IndexedDB on web. PowerSync is not adopted (it needs a service); it stays the documented escape hatch if this engine ever proves too costly to maintain.

Legend-State is a good library and its happy path works. It was rejected because the calendar's requirements are the parts it does not do, so most of the work would have been glue around it, with less control than writing the engine directly.

## What was spiked

`@legendapp/state@3.0.0-beta.48` (the current v3; `latest` on npm is still v2), `syncedSupabase` with `fieldCreatedAt` / `fieldUpdatedAt` / `fieldDeleted`, `changesSince: 'last-sync'`, `realtime: true`, `retry: { infinite: true }`, `persist: { plugin: observablePersistIndexedDB, retrySync: true }`, on the `events` and `categories` tables. It ran in real headless Chromium (IndexedDB), against the real `@supabase/supabase-js` client with a fake PostgREST behind `fetch` (an in-memory server that enforces the foreign key, rejects bad timestamps and bumps `updated_at`), and a stubbed realtime channel. The harness was throwaway and is not committed.

### Worked (verified on web)

- Optimistic create / update through `syncedSupabase`; the server row (`updated_at`, `created_at`) is merged back into the local row.
- IndexedDB persistence across a reload, including a write made offline, which was sent after the reload.
- An offline create was retried with `retry.infinite` and landed once the "server" was reachable again (no connectivity signal is involved: it is a timer with backoff).
- Realtime `postgres_changes` handling with an `updated_at` freshness check.

### Did not fit

1. **Soft delete is broken against a `timestamptz` column.** With `fieldDeleted: 'deleted_at'`, a delete is sent as `PATCH {id, deleted_at: true}`. Postgres rejects `true` for `deleted_at timestamptz` (22007); in the spike it retried forever and the row was never deleted. Fixable with a custom `update`, but then the plugin's delete path is replaced anyway.
2. **No last-write-wins and no conflict signal.** A pending local edit is overlaid on whatever the server sends: with an unsynced local edit and a newer remote change (realtime), the local value stayed, and after reconnecting it overwrote the server. The remote change was lost silently. The brief needs LWW on `updated_at` and a "remote overwrote your edit" event for the OA 05 toast; neither can be configured, and the pending-change bookkeeping is internal.
3. **Tables are independent, but a commit spans five.** One user action changes categories, goals, series and events. The plugin sends each table on its own, so the spike sent the event insert before its category and relied on the foreign-key failure plus a retry to converge. Ordered, dependency-aware writes need our own queue.
4. **Undo of a delete re-creates the same id.** The plugin would `insert` a row whose soft-deleted copy exists (unique violation). It needs an upsert path and `deleted_at: null` in the payload.
5. **The data shapes do not match.** The app works on `CalendarData` (categories by name, string ids that are not always uuids, goals by category name), the database is normalised. Every write needs a diff and every read a mapping; that code (`mapping.ts`) is the bulk of the work whichever library is under it.
6. **Smaller points.** Updates send the whole row including `created_at` / `updated_at` (`updatePartial: false`); no built-in connectivity handling (retry is timer-based); per-user cache keys, read-only (Google) rows and a user switch all need wrapping; the library is a beta (48 betas so far) with churn between them.

Net: keeping Legend-State would have meant a custom `update`/`create`, our own ordering, our own conflict layer and our own mapping, on top of a beta whose internal pending-change handling we would be working around. A purpose-built engine is about 700 lines and fully unit-testable.

## What was built

- `mapping.ts`: pure row <-> `CalendarData` mapping and the commit diff (see below).
- `engine.ts`: local row cache, persisted outbox, pull (start, reconnect, foreground, realtime re-subscribe), realtime, LWW, status, retry/backoff.
- `remote.ts`: supabase-js adapter with error classification (`network` / `auth` / `server` / `rejected`).
- `storage.native.ts` (MMKV via `react-native-mmkv` v4, which needs `react-native-nitro-modules`), `storage.web.ts` (IndexedDB), `network.native.ts` (NetInfo), `network.web.ts` (`navigator.onLine`).
- `syncedStore.ts`: the `CalendarStore` over the engine; History/Undo stays on the device.
- `controller.ts` + `SyncProvider.tsx`: auth session -> store, per-user cache, sign-out wipe, session-expired flag.

### Sync rules

- Writes go to the local cache first and into an ordered, persisted outbox; the UI never waits on the network.
- Send order: categories and series, goals, events (including soft deletes), then goal / series / category deletes. A category delete goes first only when a category with the same name is being re-created (unique `(user_id, name)`).
- Outbox ops for the same row are merged. A row created and deleted before it was ever sent is never sent.
- Events soft-delete (`deleted_at`) and keep a tombstone for 30 days. Categories, goals and series hard-delete, so they are re-read in full on every pull (that is how a deletion made on another device while offline is noticed); events pull incrementally by `updated_at` with a 5 s overlap.
- LWW per row: a remote row that is newer than the local edit (server `updated_at` against the edit time, corrected by a running estimate of clock skew taken from our own writes) replaces it and fires `useSyncConflict`; if the local edit is newer it stays and overwrites. Echoes of our own writes are recognised by payload and are not conflicts. The flush pulls first whenever the device was offline, so a reconnecting device sees remote changes before it pushes.
- A write the server will never accept (constraint, RLS) is dropped, logged in `getRejected()`, status goes to `error`, and the server's version is re-read.

## What cannot be verified here

- **iOS and Android.** MMKV (nitro module) and NetInfo are native modules needing a dev client build; only their wiring, types, and that `expo export -p web` and `expo export -p ios` (Metro, with the sync layer imported) bundle without errors were checked. The native storage and network files are not executed by any test.
- **A real Supabase project.** No PostgREST here and no contact with the remote project. The request shapes are covered by `remote.test.ts` against a recording fake builder, and the engine by tests against an in-memory server that mimics the migrations (foreign keys, unique category names, `source = 'app'` on insert, server-side `updated_at`, realtime fan-out). Things only the real backend can show: the exact PostgREST behaviour of `upsert(..., { onConflict: 'id', defaultToNull: false })` under RLS, `Prefer: return` handling, Realtime filters and `old` payloads on DELETE (the engine needs only `old.id`), and token refresh on a long-lived socket.
- **Two real devices and real clock skew.** Skew handling is tested with injected clocks only.

## Risks

- **Clock skew.** LWW compares a server timestamp with a client clock. A running skew estimate (from our own write responses) reduces the error, but a device with a wrong clock that has never written can mis-order a conflict. Worst case is the "wrong" side winning one conflict, which the toast's Undo corrects.
- **Race window.** There is no conditional update (`updated_at = base`), so a push can still overwrite a remote change that neither realtime nor the pre-flush pull had delivered yet. This is the same window any LWW design without version checks has; it is a few seconds at most while connected.
- **Undo across devices.** History/Undo restores a whole device-local snapshot (core `restoreEntry`), so undoing an old entry also reverts changes other devices made to unrelated rows since. Only differences against the current data are written, which limits it to rows that differ from the snapshot.
- **Category order.** The schema has no position column; order is `created_at`, then the default categories' order, then name. New categories get a strictly increasing `created_at`; categories created by the new-user trigger share a timestamp, so the default order is hard-coded as the tie break.
- **Local-only fields.** `ProtoEvent.goalId` has no column and stays on the device (`goalLinks`), so it does not follow the user to a new device.
- **Non-uuid ids.** Goals (`g...`) and any event ids not from `store.newId()` get a persisted uuid alias; the app keeps seeing its own id, other devices see the uuid.
- **Web, two tabs.** Signing out in one tab emits SIGNED_OUT in the other, which cannot tell it from an expired session and keeps its cache (it may re-persist after the first tab wiped). Low impact; the cache is keyed by user and not readable by another user.
- **First run offline.** With no cache the provider waits up to 6 s for the first pull, then shows the empty state; writes are allowed but categories typed before the first pull can collide with the server's default ones (a unique-name rejection, then a re-read).
- **Expired session.** Detected as a SIGNED_OUT event without an explicit `signOut()` (the controller wraps `supabase.auth.signOut` to tell them apart) or a repeated 401. The local cache and outbox are kept so the same user can sign back in without losing edits.
