/**
 * The data layer: local-first store + Supabase sync.
 *
 * Mount `<SyncProvider>` once in the root layout. Screens keep using the
 * store contract in `@/store` (`useCalendarData`, `getStore().commit`, ...).
 */
export { SyncProvider, useSyncContext, useSyncLoading, type SyncContextValue } from './SyncProvider';
export { SyncController, installSignOutTracker, type SyncControllerDeps, type SyncControllerState } from './controller';
export { SyncEngine, type ConflictInfo, type EngineOptions, type SyncStatus } from './engine';
export { createSyncedStore, type SyncedCalendarStore } from './syncedStore';
export { createSupabaseRemote, toRemoteError } from './remote';
export { createMemoryKv, scopedStore, userPrefix } from './kv';
export * from './mapping';
export type * from './types';
