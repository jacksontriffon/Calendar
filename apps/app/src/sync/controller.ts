/**
 * Ties the auth session to the store: when a user signs in, load that user's
 * cache, install the synced store and start syncing; when they sign out, wipe
 * the cache and go back to an empty in-memory store. React-free so it can be
 * tested; `SyncProvider` is a thin wrapper.
 *
 * Per-user isolation: the cache is keyed by user id (`userPrefix`). Only the
 * signed-in user's key space is ever opened, so a different user never sees
 * the previous user's data. An explicit sign-out wipes that user's key space.
 * A session that merely expired keeps it, so the same user can sign back in
 * and their unsynced edits are still there.
 */
import { createMemoryStore, emitSyncConflict, setSessionExpired, setStore, type CalendarStore } from '../store';
import { SyncEngine, type ConflictInfo, type EngineOptions } from './engine';
import { scopedStore, userPrefix } from './kv';
import { createSyncedStore, type SyncedCalendarStore } from './syncedStore';
import type { KeyValueStore, NetworkMonitor, RemoteApi } from './types';

export interface SessionLike {
  user: { id: string };
}

/** The slice of `supabase.auth` the controller uses. */
export interface AuthLike {
  onAuthStateChange(cb: (event: string, session: SessionLike | null) => void): { data: { subscription: { unsubscribe(): void } } };
  signOut: (...args: never[]) => Promise<unknown>;
  /** Forces a token refresh (used once when the server says the token is expired). */
  refreshSession?: () => Promise<unknown>;
}

export interface SyncControllerState {
  /** No store is ready yet: the session is being read, or a first sync is in progress. */
  loading: boolean;
  userId: string | null;
}

export interface SyncControllerDeps {
  auth: AuthLike;
  /** The shared device store; user key spaces are carved out of it. */
  device: KeyValueStore;
  createRemote: (userId: string) => RemoteApi;
  createNet: () => NetworkMonitor;
  onForeground?: (cb: () => void) => () => void;
  /** Longest wait for a first sync when there is no cache (offline first run). */
  firstSyncTimeoutMs?: number;
  /** Overridable for tests. */
  install?: (store: CalendarStore) => void;
  onConflict?: (c: ConflictInfo) => void;
  setExpired?: (v: boolean) => void;
  engineOptions?: Partial<Pick<EngineOptions, 'retry' | 'persistDelayMs' | 'now' | 'newId'>>;
}

interface Active {
  userId: string;
  engine: SyncEngine;
  store: SyncedCalendarStore;
  off: (() => void)[];
}

const patched = new WeakSet<object>();
const intentional = { flag: false };

/**
 * `supabase.auth.signOut()` and a failed token refresh both end in a SIGNED_OUT event. To tell an
 * explicit sign-out from an expired session, wrap `signOut` once so the controller can see it was asked for.
 */
export function installSignOutTracker(auth: AuthLike): void {
  if (patched.has(auth)) return;
  patched.add(auth);
  const original = auth.signOut.bind(auth) as (...a: unknown[]) => Promise<unknown>;
  (auth as { signOut: unknown }).signOut = async (...args: unknown[]) => {
    intentional.flag = true;
    try {
      return await original(...args);
    } finally {
      // The SIGNED_OUT event is dispatched before signOut resolves; keep the flag for the rest of this tick.
      setTimeout(() => {
        intentional.flag = false;
      }, 0);
    }
  };
}

export class SyncController {
  private readonly d: SyncControllerDeps;
  private state: SyncControllerState = { loading: true, userId: null };
  private listeners = new Set<(s: SyncControllerState) => void>();
  private active: Active | null = null;
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private unsubscribeAuth: (() => void) | null = null;

  constructor(deps: SyncControllerDeps) {
    this.d = deps;
  }

  getState(): SyncControllerState {
    return this.state;
  }

  subscribe(listener: (s: SyncControllerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: Partial<SyncControllerState>) {
    const merged = { ...this.state, ...next };
    if (merged.loading === this.state.loading && merged.userId === this.state.userId) return;
    this.state = merged;
    this.listeners.forEach((l) => l(merged));
  }

  /** Listen to auth changes. Returns the cleanup. */
  start(): () => void {
    installSignOutTracker(this.d.auth);
    const { data } = this.d.auth.onAuthStateChange((event, session) => {
      // Read the flag now: it is only set for the duration of the signOut() call.
      const explicit = intentional.flag;
      this.enqueue(() => this.handle(event, session, explicit));
    });
    this.unsubscribeAuth = () => data.subscription.unsubscribe();
    return () => {
      this.unsubscribeAuth?.();
      this.unsubscribeAuth = null;
      this.generation++;
      void this.enqueue(() => this.deactivate(false));
    };
  }

  /** Resolves when everything triggered so far has been handled (tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task, task).catch((e) => {
      console.warn('[sync] controller error', e);
    });
    return this.chain;
  }

  private async handle(event: string, session: SessionLike | null, explicitSignOut: boolean): Promise<void> {
    const userId = session?.user?.id ?? null;
    const setExpired = this.d.setExpired ?? setSessionExpired;

    if (!userId) {
      const hadUser = !!this.active;
      // SIGNED_OUT without a signOut() call means the refresh token failed or was revoked.
      const expired = event === 'SIGNED_OUT' && hadUser && !explicitSignOut;
      await this.deactivate(!expired && hadUser);
      if (expired) setExpired(true);
      this.set({ loading: false, userId: null });
      return;
    }

    if (this.active && this.active.userId === userId) {
      // Token refresh, tab focus, user metadata update: same user, nothing to rebuild.
      setExpired(false);
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') void this.active.engine.refresh();
      return;
    }

    // A different user (or the first one): never reuse another user's state.
    await this.deactivate(false);
    setExpired(false);
    await this.activate(userId);
  }

  private async activate(userId: string): Promise<void> {
    const gen = ++this.generation;
    this.set({ loading: true, userId });
    const kv = scopedStore(this.d.device, userPrefix(userId));
    const engine = await SyncEngine.create({
      userId,
      kv,
      remote: this.d.createRemote(userId),
      net: this.d.createNet(),
      onConflict: (c) => (this.d.onConflict ?? defaultOnConflict)(c),
      onAuthError: () => void this.onAuthError(engine),
      ...this.d.engineOptions,
    });
    const store = await createSyncedStore({ engine, kv });
    if (gen !== this.generation) {
      // Superseded (another sign-in or unmount) while loading.
      await store.dispose();
      await engine.stop();
      return;
    }
    const off: (() => void)[] = [];
    if (this.d.onForeground) off.push(this.d.onForeground(() => void engine.refresh()));
    this.active = { userId, engine, store, off };
    (this.d.install ?? setStore)(store);
    engine.start();
    await this.firstSync(engine);
    if (gen === this.generation) this.set({ loading: false, userId });
  }

  /** With a cache the app is usable at once; without one, wait for the first pull (bounded, so offline first runs do not hang). */
  private async firstSync(engine: SyncEngine): Promise<void> {
    if (engine.isReady()) return;
    const limit = this.d.firstSyncTimeoutMs ?? 6000;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        resolve();
      };
      const timer = setTimeout(finish, limit);
      const off = engine.subscribe(() => {
        if (engine.isReady()) finish();
      });
      if (engine.isReady()) finish();
    });
  }

  private lastAuthRetry = 0;

  /**
   * The server answered 401. Try one token refresh and one more sync; if that did not help (we were
   * here less than 15 s ago), the session is unusable until the user signs in again.
   */
  private async onAuthError(engine: SyncEngine): Promise<void> {
    const t = Date.now();
    if (t - this.lastAuthRetry < 15000 || !this.d.auth.refreshSession) {
      (this.d.setExpired ?? setSessionExpired)(true);
      return;
    }
    this.lastAuthRetry = t;
    try {
      await this.d.auth.refreshSession();
      void engine.refresh();
    } catch {
      (this.d.setExpired ?? setSessionExpired)(true);
    }
  }

  private async deactivate(wipe: boolean): Promise<void> {
    const a = this.active;
    this.active = null;
    (this.d.install ?? setStore)(createMemoryStore());
    if (!a) return;
    a.off.forEach((o) => o());
    if (wipe) {
      a.store.discard();
      await a.engine.wipe();
    } else {
      await a.store.dispose();
      await a.engine.stop();
    }
  }
}

function defaultOnConflict(c: ConflictInfo): void {
  emitSyncConflict({ table: c.table, rowId: c.rowId, label: c.label, undo: c.undo });
}
