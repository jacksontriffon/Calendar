/**
 * Phone-calendar bridge (docs/expo-plan.md §6). Runs only on a device, because phone calendars are
 * only reachable there; on web `DeviceCalendarApi.supported` is false and every method is a no-op.
 *
 * READ: for each phone calendar with "Show in app", events in a rolling window go into an in-memory,
 * device-only list. They are never written to Supabase and never enter the store's `CalendarData`.
 * Events the user removed (someone else's) are hidden by an opaque key (`hidden_items`).
 *
 * PUBLISH: a public event of ours that targets a phone calendar is created, updated or deleted there,
 * and an `event_targets` row (kind `device`, this install's `device_id`) reports the status. Rows with
 * another `device_id` are shown, never acted on.
 *
 * The bridge is React-free and takes its platform pieces as dependencies (`DeviceCalendarApi`,
 * `DeviceRemote`, a key-value store, the calendar store), so it is tested without any of them.
 * Supabase is reached only through `deviceRemote.ts` (see the privacy invariant there).
 */
import { addDays, type ProtoEvent } from '@calendar/core';

import { DEFAULT_FLAGS, buildCalendars, findDuplicates, fingerprintOf, isOwnCopy, isPublishable, isUuid, mapEvent, sameWindow, targetKey, toWrite, windowFor, type ReadWindow } from './deviceMap';
import { loadInstallId, loadPersisted, savePersisted, userStore, type PersistedDevice } from './deviceSettings';
import {
  EMPTY_DEVICE_STATE,
  type DeviceCalendarApi,
  type DeviceCalendarFlags,
  type DeviceCalendarInfo,
  type DeviceEvent,
  type DevicePermission,
  type DeviceRemote,
  type DeviceState,
  type GoogleCalendarRef,
  type LocalTarget,
  type RemoteTargetRow,
  type TargetErrorCode,
  type TargetView,
  type TargetWrite,
} from './deviceTypes';
import type { KeyValueStore } from './types';

/** The slice of the calendar store the bridge reads. */
export interface BridgeStore {
  getState(): { data: { events: readonly ProtoEvent[] }; sync?: string };
  subscribe(listener: () => void): () => void;
}

export interface DeviceBridgeDeps {
  api: DeviceCalendarApi;
  /** the shared device key-value store (MMKV / IndexedDB); the bridge carves out its own keys */
  base: KeyValueStore;
  userId: string;
  remote: DeviceRemote;
  store: BridgeStore;
  /** called whenever the app comes back to the foreground */
  onForeground?: (cb: () => void) => () => void;
  now?: () => Date;
  timeZone?: string;
  /** refresh while the app is open, ms (0 = never; default 5 minutes) */
  refreshEveryMs?: number;
  /** first retry delay for server writes that failed, ms (0 = no automatic retry; default 20 s) */
  retryMs?: number;
  /** debounce for reacting to store changes, ms (default 60) */
  debounceMs?: number;
}

const isNotFound = (e: unknown): boolean => /not found|does not exist|no such|no event|invalid event/i.test(String((e as Error)?.message ?? e));

export class DeviceBridge {
  private readonly d: DeviceBridgeDeps;
  private state: DeviceState;
  private listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();

  private installId = '';
  private kv: KeyValueStore | null = null;
  private flags: Record<string, DeviceCalendarFlags> = {};
  private targets: Record<string, LocalTarget> = {};
  private tombstones: PersistedDevice['tombstones'] = {};
  private hiddenKeys = new Set<string>();
  private hiddenAdd = new Set<string>();
  private hiddenRemove = new Set<string>();

  private cals: DeviceCalendarInfo[] = [];
  private duplicateAccounts: string[] = [];
  private googleRefs: GoogleCalendarRef[] = [];
  private rawEvents: DeviceEvent[] = [];
  private others: RemoteTargetRow[] = [];
  private extra: ReadWindow | null = null;
  private loaded: ReadWindow | null = null;

  private started = false;
  private stopped = false;
  private storeReady = true;
  private storeSig = '';
  private offs: (() => void)[] = [];
  private storeTimer: ReturnType<typeof setTimeout> | null = null;
  private rangeTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay: number;

  constructor(deps: DeviceBridgeDeps) {
    this.d = deps;
    this.state = { ...EMPTY_DEVICE_STATE, supported: deps.api.supported };
    this.retryDelay = deps.retryMs ?? 20000;
  }

  /* ------------------------------------------------------------------ state */

  getState = (): DeviceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private patch(p: Partial<DeviceState>): void {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  private emit(): void {
    const permission = this.state.permission;
    const available = this.state.supported && permission === 'granted';
    const hidden = this.hiddenKeys;
    const targets: Record<string, TargetView[]> = {};
    Object.values(this.targets).forEach((t) => {
      if (t.removing) return;
      (targets[t.eventId] ??= []).push({ key: t.calendarKey, status: t.remoteDirty && t.status === 'synced' ? 'queued' : t.status, mine: true });
    });
    this.others.forEach((r) => {
      if (r.device_id === this.installId) return;
      const list = (targets[r.event_id] ??= []);
      if (list.some((x) => x.key === r.device_calendar_key)) return;
      list.push({ key: r.device_calendar_key, status: r.status, mine: false });
    });
    this.patch({
      available,
      calendars: available ? this.cals : [],
      duplicateAccounts: available ? this.duplicateAccounts : [],
      events: available ? this.rawEvents.filter((e) => !hidden.has(e.hiddenKey)) : [],
      hidden: available ? this.rawEvents.filter((e) => hidden.has(e.hiddenKey)) : [],
      targets,
    });
  }

  /** One at a time, in order. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => (this.stopped ? (undefined as T) : fn()));
    this.chain = run.catch((e) => {
      console.warn('[device] bridge error', e);
    });
    return run;
  }

  /** Resolves when everything queued so far has run (tests). */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  /* -------------------------------------------------------------- lifecycle */

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.d.api.supported) {
      this.patch({ ready: true });
      return;
    }
    this.installId = await loadInstallId(this.d.base);
    this.kv = userStore(this.d.base, this.d.userId);
    const p = await loadPersisted(this.kv);
    this.flags = p.calendars;
    this.targets = Object.fromEntries(Object.entries(p.targets).map(([k, t]) => [k, { ...t, removing: t.removing ?? false }]));
    this.tombstones = p.tombstones;
    this.hiddenKeys = new Set(p.hidden);
    this.hiddenAdd = new Set(p.hiddenAdd);
    this.hiddenRemove = new Set(p.hiddenRemove);
    if (this.stopped) return;

    this.storeSig = this.signature();
    this.offs.push(this.d.store.subscribe(() => this.onStoreChange()));
    if (this.d.onForeground) this.offs.push(this.d.onForeground(() => void this.refresh()));
    if (this.d.api.onChange) this.offs.push(this.d.api.onChange(() => void this.refresh()));
    const every = this.d.refreshEveryMs ?? 5 * 60 * 1000;
    if (every > 0) {
      const t = setInterval(() => void this.refresh(), every);
      this.offs.push(() => clearInterval(t));
    }
    await this.refresh();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.offs.forEach((o) => o());
    this.offs = [];
    [this.storeTimer, this.rangeTimer, this.retryTimer].forEach((t) => t && clearTimeout(t));
    this.storeTimer = this.rangeTimer = this.retryTimer = null;
    this.listeners.clear();
    await this.chain;
  }

  /** The calendar store is (not) the signed-in user's loaded data. While it is not, nothing is published or removed. */
  setStoreReady(ready: boolean): void {
    const was = this.storeReady;
    this.storeReady = ready;
    if (ready && !was && this.started) void this.enqueue(() => this.reconcile().then(() => this.emit()));
  }

  /* ----------------------------------------------------------- permissions */

  private async checkPermission(): Promise<DevicePermission> {
    let p: DevicePermission;
    try {
      p = await this.d.api.getPermission();
    } catch {
      p = { status: 'undetermined', canAskAgain: true };
    }
    this.patch({ permission: p.status, canAskAgain: p.canAskAgain, ready: true });
    return p;
  }

  /** Show the OS permission prompt (call after the priming screen). Resolves with the answer. */
  async requestPermission(): Promise<DevicePermission> {
    if (!this.d.api.supported) return { status: 'undetermined', canAskAgain: false };
    let p: DevicePermission;
    try {
      p = await this.d.api.requestPermission();
    } catch {
      p = { status: 'denied', canAskAgain: false };
    }
    this.patch({ permission: p.status, canAskAgain: p.canAskAgain, ready: true });
    await this.refresh();
    return p;
  }

  /* ------------------------------------------------------------------ sync */

  /** Re-read permission, calendars and events, and bring published copies up to date. Safe to call any time. */
  refresh(): Promise<void> {
    if (!this.d.api.supported) return Promise.resolve();
    return this.enqueue(() => this.fullSync());
  }

  private async fullSync(): Promise<void> {
    this.patch({ loading: true });
    try {
      const perm = await this.checkPermission();
      await this.pullRemote();
      if (perm.status === 'granted') {
        await this.loadCalendars();
        await this.loadEvents();
      } else {
        this.cals = [];
        this.rawEvents = [];
        this.duplicateAccounts = [];
      }
      await this.reconcile();
    } finally {
      this.emit();
      this.patch({ loading: false });
    }
  }

  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }

  private persist(): Promise<void> {
    if (!this.kv) return Promise.resolve();
    return savePersisted(this.kv, {
      calendars: this.flags,
      targets: this.targets,
      tombstones: this.tombstones,
      hidden: [...this.hiddenKeys],
      hiddenAdd: [...this.hiddenAdd],
      hiddenRemove: [...this.hiddenRemove],
    });
  }

  /* ----------------------------------------------------------------- reads */

  private async loadCalendars(): Promise<void> {
    let raw;
    try {
      raw = await this.d.api.getCalendars();
    } catch (e) {
      console.warn('[device] could not list calendars', e);
      return;
    }
    const all = buildCalendars(raw, this.flags);
    const withInternal = all.map((c) => ({ ...c, internalName: raw.find((r) => r.id === c.id)?.internalName ?? null }));
    const dup = findDuplicates(withInternal, this.googleRefs);
    this.cals = all.filter((c) => !dup.keys.has(c.key));
    this.duplicateAccounts = dup.accounts;
    // Remember the defaults of newly seen calendars, so they stay put once the user has seen them.
    let fresh = false;
    this.cals.forEach((c) => {
      if (!this.flags[c.key]) {
        this.flags[c.key] = { showInApp: c.showInApp, canPublish: c.canPublish };
        fresh = true;
      }
    });
    if (fresh) await this.persist();
  }

  private async loadEvents(): Promise<void> {
    const win = windowFor(this.now(), this.extra);
    const cals = this.cals.filter((c) => c.showInApp);
    if (!cals.length) {
      this.rawEvents = [];
      this.loaded = win;
      return;
    }
    let raw;
    try {
      raw = await this.d.api.getEvents(cals.map((c) => c.id), win.from, addDays(win.to, 1));
    } catch (e) {
      console.warn('[device] could not read events', e);
      return;
    }
    const byId = new Map(cals.map((c) => [c.id, c]));
    const own = new Set(Object.values(this.targets).map((t) => t.externalId).filter((x): x is string => !!x));
    const seen = new Set<string>();
    const out: DeviceEvent[] = [];
    raw.forEach((r) => {
      const cal = byId.get(r.calendarId);
      if (!cal || isOwnCopy(r) || own.has(r.id)) return;
      const ev = mapEvent(r, cal, this.d.api.platform, cal.account);
      if (!ev || seen.has(ev.id)) return;
      seen.add(ev.id);
      out.push(ev);
    });
    out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.start - b.start || (a.title < b.title ? -1 : 1)));
    this.rawEvents = out;
    this.loaded = win;
  }

  /** Make sure the part of the calendar being looked at is read (the default window is today -14 / +60 days). */
  requestRange(from: Date, to: Date): void {
    if (!this.d.api.supported) return;
    const cur = windowFor(this.now(), this.extra);
    if (from >= cur.from && to <= cur.to) return;
    this.extra = {
      from: this.extra && this.extra.from < from ? this.extra.from : from,
      to: this.extra && this.extra.to > to ? this.extra.to : to,
    };
    if (this.rangeTimer) clearTimeout(this.rangeTimer);
    this.rangeTimer = setTimeout(() => {
      this.rangeTimer = null;
      const want = windowFor(this.now(), this.extra);
      if (this.loaded && sameWindow(this.loaded, want)) return;
      void this.enqueue(async () => {
        if (this.state.permission !== 'granted') return;
        await this.loadEvents();
        this.emit();
      });
    }, 120);
  }

  /** A phone event by its calendar-view id, hidden ones included. */
  getEvent(id: string): DeviceEvent | null {
    return this.rawEvents.find((e) => e.id === id) ?? null;
  }

  /* ----------------------------------------------------------------- flags */

  async setCalendarFlags(key: string, patch: Partial<DeviceCalendarFlags>): Promise<void> {
    if (!this.d.api.supported) return;
    await this.enqueue(async () => {
      const cur = this.flags[key] ?? DEFAULT_FLAGS;
      const cal = this.cals.find((c) => c.key === key);
      const next: DeviceCalendarFlags = { ...cur, ...patch };
      if (cal?.readOnly) next.canPublish = false;
      this.flags[key] = next;
      this.cals = this.cals.map((c) => (c.key === key ? { ...c, showInApp: next.showInApp, canPublish: !c.readOnly && next.canPublish } : c));
      await this.persist();
      this.emit();
      if (patch.showInApp !== undefined && cal) {
        await this.loadEvents();
        this.emit();
      }
      await this.reconcile();
      this.emit();
    });
  }

  /* ----------------------------------------------------------------- hide */

  /** "Remove" on someone else's phone event: hide it in this app only (`hidden_items`, opaque key). Returns it, for the Undo toast. */
  hideEvent(id: string): DeviceEvent | null {
    const ev = this.getEvent(id);
    if (!ev) return null;
    this.hiddenKeys.add(ev.hiddenKey);
    this.hiddenRemove.delete(ev.hiddenKey);
    this.hiddenAdd.add(ev.hiddenKey);
    this.emit();
    void this.enqueue(async () => {
      await this.persist();
      await this.flushHidden();
    });
    return ev;
  }

  /** Undo / "Unhide": show a removed phone event again. */
  unhideEvent(hiddenKeyValue: string): void {
    this.hiddenKeys.delete(hiddenKeyValue);
    this.hiddenAdd.delete(hiddenKeyValue);
    this.hiddenRemove.add(hiddenKeyValue);
    this.emit();
    void this.enqueue(async () => {
      await this.persist();
      await this.flushHidden();
    });
  }

  private async flushHidden(): Promise<void> {
    let failed = false;
    for (const k of [...this.hiddenAdd]) {
      try {
        await this.d.remote.insertHidden(k);
        this.hiddenAdd.delete(k);
      } catch {
        failed = true;
      }
    }
    for (const k of [...this.hiddenRemove]) {
      try {
        await this.d.remote.deleteHidden(k);
        this.hiddenRemove.delete(k);
      } catch {
        failed = true;
      }
    }
    await this.persist();
    if (failed) this.scheduleRetry();
  }

  /* ---------------------------------------------------------- server pulls */

  private async pullRemote(): Promise<void> {
    await this.flushHidden();
    try {
      const keys = await this.d.remote.fetchHiddenKeys();
      const next = new Set(keys);
      this.hiddenAdd.forEach((k) => next.add(k));
      this.hiddenRemove.forEach((k) => next.delete(k));
      this.hiddenKeys = next;
    } catch {
      // offline: keep what this device knows
    }
    try {
      this.googleRefs = await this.d.remote.fetchGoogleCalendars();
    } catch {
      // keep the last list
    }
    try {
      const rows = await this.d.remote.fetchTargets();
      this.others = rows.filter((r) => r.device_id !== this.installId);
      const mine = rows.filter((r) => r.device_id === this.installId);
      const have = new Set<string>();
      mine.forEach((r) => {
        const k = targetKey(r.event_id, r.device_calendar_key);
        have.add(k);
        if (!this.targets[k] && !this.tombstones[k]) {
          // This device's row that it has no record of (local data cleared): adopt it.
          this.targets[k] = {
            eventId: r.event_id,
            calendarKey: r.device_calendar_key,
            externalId: r.external_id,
            fingerprint: r.fingerprint,
            status: r.status === 'queued' ? 'pending' : r.status,
            error: null,
            remoteDirty: false,
            remoteKnown: true,
            removing: false,
            syncedAt: null,
          };
        } else if (this.targets[k]) {
          this.targets[k].remoteKnown = true;
        }
      });
      // A target the server no longer has a row for gets reported again.
      Object.entries(this.targets).forEach(([k, t]) => {
        if (t.remoteKnown && !have.has(k)) {
          t.remoteKnown = false;
          t.remoteDirty = true;
        }
      });
    } catch {
      // offline: keep the last known rows
    }
  }

  /* -------------------------------------------------------------- publish */

  private newTarget(eventId: string, calendarKeyValue: string): LocalTarget {
    return {
      eventId,
      calendarKey: calendarKeyValue,
      externalId: null,
      fingerprint: null,
      status: 'pending',
      error: null,
      remoteDirty: false,
      remoteKnown: false,
      removing: false,
      syncedAt: null,
    };
  }

  /**
   * Choose the phone calendars `eventId` is published to (all of them: calendars not listed are
   * un-published, their copies deleted). The copy appears once the event is public.
   */
  async setTargets(eventId: string, calendarKeys: readonly string[]): Promise<void> {
    if (!this.d.api.supported) return;
    await this.enqueue(async () => {
      const want = new Set(calendarKeys);
      const granted = this.state.permission === 'granted';
      for (const [k, t] of Object.entries(this.targets)) {
        if (t.eventId === eventId && !want.has(t.calendarKey)) await this.removeTarget(k, t, granted);
      }
      want.forEach((ck) => {
        const k = targetKey(eventId, ck);
        const have = this.targets[k];
        if (!have) this.targets[k] = this.newTarget(eventId, ck);
        else if (have.removing) have.removing = false;
        delete this.tombstones[k];
      });
      await this.persist();
      await this.reconcile();
      this.emit();
    });
  }

  private signature(): string {
    const st = this.d.store.getState();
    const byId = new Map(st.data.events.map((e) => [e.id, e]));
    const parts = Object.values(this.targets).map((t) => {
      const e = byId.get(t.eventId);
      return t.eventId + ':' + (e ? (isPublishable(e) ? 'p' : 'x') + fingerprintOf(e) : 'gone');
    });
    return parts.sort().join('|') + '#' + (st.sync ?? 'idle');
  }

  /** Our events changed: publish what needs it. Diffed by fingerprint, so ordinary edits cost nothing. */
  private onStoreChange(): void {
    if (this.stopped || !this.started) return;
    const sig = this.signature();
    if (sig === this.storeSig) return;
    this.storeSig = sig;
    if (this.storeTimer) clearTimeout(this.storeTimer);
    this.storeTimer = setTimeout(() => {
      this.storeTimer = null;
      void this.enqueue(async () => {
        await this.reconcile();
        this.emit();
      });
    }, this.d.debounceMs ?? 60);
  }

  /** Bring every published copy in line with the store: create, update, delete. */
  async reconcile(): Promise<void> {
    if (!this.d.api.supported || !this.storeReady) return;
    const st = this.d.store.getState();
    const events = new Map(st.data.events.map((e) => [e.id, e]));
    // A missing event only means "deleted" once the store has finished loading and syncing: an empty
    // cache on a first, offline run must not wipe the user's published copies.
    const settled = (st.sync ?? 'idle') === 'idle';
    const granted = this.state.permission === 'granted';
    const calByKey = new Map(this.cals.map((c) => [c.key, c]));
    let changed = false;

    for (const [k, t] of Object.entries(this.targets)) {
      if (this.stopped) return;
      const ev = events.get(t.eventId);
      if (t.removing || (!ev && settled) || (ev && !isPublishable(ev) && t.externalId)) {
        if (await this.removeTarget(k, t, granted)) changed = true;
        continue;
      }
      if (!ev || !isPublishable(ev)) continue; // waiting for the event to become public
      if (await this.publishTarget(t, ev, granted, calByKey.get(t.calendarKey))) changed = true;
    }
    if (changed) await this.persist();
    await this.flushRemote(events);
  }

  private mark(t: LocalTarget, status: LocalTarget['status'], error: TargetErrorCode | null): boolean {
    if (t.status === status && t.error === error) return false;
    t.status = status;
    t.error = error;
    t.remoteDirty = true;
    return true;
  }

  private async publishTarget(t: LocalTarget, ev: ProtoEvent, granted: boolean, cal: DeviceCalendarInfo | undefined): Promise<boolean> {
    if (!granted) return this.mark(t, 'failed', 'permission');
    if (!cal) return this.mark(t, 'failed', 'no_calendar');
    const fp = fingerprintOf(ev);
    const needsWrite = !t.externalId || t.fingerprint !== fp || t.status !== 'synced';
    if (!needsWrite) return false;
    // `Can publish to` gates new copies; one that already exists keeps being kept up to date.
    if ((!t.externalId && !cal.canPublish) || cal.readOnly) return this.mark(t, 'failed', 'not_allowed');

    const tz = this.d.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const write = toWrite(ev, this.d.api.platform, tz);
    try {
      if (!t.externalId) {
        t.externalId = await this.d.api.createEvent(cal.id, write);
      } else {
        try {
          await this.d.api.updateEvent(t.externalId, write);
        } catch (e) {
          if (!isNotFound(e)) throw e;
          t.externalId = await this.d.api.createEvent(cal.id, write); // the user deleted our copy on the phone: put it back
        }
      }
    } catch (e) {
      console.warn('[device] write failed', e);
      return this.mark(t, 'failed', 'write_failed');
    }
    t.fingerprint = fp;
    t.status = 'synced';
    t.error = null;
    t.syncedAt = this.now().toISOString();
    t.remoteDirty = true;
    return true;
  }

  /** Delete the phone copy (if any) and forget the target; the server row goes with it. Returns whether anything changed. */
  private async removeTarget(k: string, t: LocalTarget, granted: boolean): Promise<boolean> {
    if (t.externalId) {
      if (!granted) {
        const was = t.removing;
        t.removing = true;
        return !was; // can't reach the phone now; retried once access is back
      }
      try {
        await this.d.api.deleteEvent(t.externalId);
      } catch (e) {
        if (!isNotFound(e)) {
          console.warn('[device] delete failed', e);
          const was = t.removing;
          t.removing = true;
          return !was;
        }
      }
    }
    delete this.targets[k];
    if (t.remoteKnown || t.remoteDirty) this.tombstones[k] = { event_id: t.eventId, device_calendar_key: t.calendarKey };
    return true;
  }

  /** Report statuses to `event_targets` (our events only) and delete rows of copies that are gone. */
  private async flushRemote(events: Map<string, ProtoEvent>): Promise<void> {
    let failed = false;
    let changed = false;
    for (const t of Object.values(this.targets)) {
      if (!t.remoteDirty || t.removing) continue;
      const ev = events.get(t.eventId);
      // Not reported until the event is public and is a real server row.
      if (!ev || !isPublishable(ev) || !isUuid(t.eventId)) continue;
      const row: TargetWrite = {
        event_id: t.eventId,
        kind: 'device',
        device_id: this.installId,
        device_calendar_key: t.calendarKey,
        external_id: t.externalId,
        fingerprint: t.fingerprint,
        status: t.status,
        error: t.error,
        synced_at: t.syncedAt,
      };
      try {
        await this.d.remote.upsertTargets([row]);
        t.remoteDirty = false;
        t.remoteKnown = true;
        changed = true;
      } catch {
        failed = true;
      }
    }
    const gone = Object.entries(this.tombstones);
    if (gone.length) {
      try {
        await this.d.remote.deleteTargets(gone.map(([, v]) => ({ event_id: v.event_id, device_id: this.installId, device_calendar_key: v.device_calendar_key })));
        gone.forEach(([k]) => delete this.tombstones[k]);
        changed = true;
      } catch {
        failed = true;
      }
    }
    if (changed) await this.persist();
    if (failed) this.scheduleRetry();
    else this.retryDelay = this.d.retryMs ?? 20000;
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer || !this.retryDelay) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 5 * 60 * 1000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.refresh();
    }, delay);
  }
}
