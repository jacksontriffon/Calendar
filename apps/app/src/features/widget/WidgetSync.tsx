/**
 * Mount once inside `<SessionProvider>` and `<SyncProvider>` in the root layout:
 *
 *   <WidgetSync />
 *
 * Keeps the home-screen widgets fed while the app is open: writes the snapshot
 * on every store change (debounced), applies checks tapped on the widget when
 * the app starts or returns to the foreground, clears the snapshot on sign-out
 * and schedules the background refresh. Renders nothing, and does nothing on web.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/features/auth/session';
import { getDeviceKv } from '@/lib/deviceKv';
import { getStore } from '@/store';
import { useSyncContext } from '@/sync';

import { unregisterWidgetRefresh, registerWidgetRefresh } from './background';
import { deviceClock } from './clock';
import { drainDoneOps } from './queue';
import { hidePrivateTitles, liveStoreSource, refreshNow, setLiveSource, writer } from './runtime';
import { widgetStorage, widgetsSupported } from './storage';

/** Keeps `writtenAt` fresh while the app is open and nothing else changes. */
const HEARTBEAT_MS = 10 * 60000;

export function WidgetSync(): null {
  const { signedIn, loading, userId } = useSyncContext();
  const { displayName } = useSession();
  const name = useRef<string | null>(null);
  useEffect(() => {
    name.current = displayName;
  }, [displayName]);

  useEffect(() => {
    if (!widgetsSupported || loading) return;
    if (!signedIn || !userId) {
      setLiveSource(null);
      writer.clear();
      void unregisterWidgetRefresh();
      return;
    }

    const user = () => ({ id: userId, name: name.current });
    const store = getStore();
    setLiveSource(() => liveStoreSource(user()));
    void registerWidgetRefresh();

    let draining = false;
    const input = () => {
      const s = store.getState();
      return { data: s.data, prefs: s.prefs, user: user(), clock: deviceClock(), hidePrivate: hidePrivateTitles() };
    };
    // Checks tapped on the widget: apply them (a store change then writes the snapshot).
    const drain = () => {
      if (draining) return;
      draining = true;
      try {
        drainDoneOps({ storage: widgetStorage, kv: getDeviceKv(), store, now: new Date() });
      } finally {
        draining = false;
      }
    };

    drain();
    void refreshNow();
    const off = store.subscribe(() => {
      drain();
      writer.schedule(input());
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshNow();
      else writer.flush();
    });
    const beat = setInterval(() => void refreshNow(), HEARTBEAT_MS);

    return () => {
      off();
      sub.remove();
      clearInterval(beat);
      writer.flush();
      setLiveSource(null);
    };
  }, [signedIn, loading, userId]);

  return null;
}
