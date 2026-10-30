# sync

Data layer between the UI and Supabase (`docs/expo-plan.md` §6). See `SPIKE.md` for why it is a hand-written engine and what is verified.

```
index.ts          exports (SyncProvider, engine, mapping, ...)
SyncProvider.tsx  mounts once in the root layout; reacts to auth session changes
controller.ts     auth session -> per-user store (React-free, tested)
syncedStore.ts    the CalendarStore contract (src/store) over the engine + device-local History/Undo
engine.ts         local row cache, outbox, pull, realtime, LWW, status
mapping.ts        pure: rows <-> CalendarData, commit diff -> upserts / deletes
remote.ts         supabase-js adapter and error classification
storage.*.ts      key-value storage: MMKV (native), IndexedDB (web), memory (tests)
network.*.ts      connectivity: NetInfo (native), navigator.onLine (web)
fakeServer.ts     test-only in-memory backend
```

Wiring (one line in `app/_layout.tsx`): wrap the tree in `<SyncProvider>` from `@/sync` (inside `GestureHandlerRootView`, above the `Stack`). Gate the splash screen on `useSyncLoading()`.

Screens keep using `@/store`. Additions there: `useSyncConflict()` (OA 05 toast with Undo), `useSessionExpired()`, `useSeries()`, `getStore().setSeries()`.

Still to come here: `device.ts` (phone-calendar bridge, phase 6), widget snapshot writer and background refresh (phase 7).
