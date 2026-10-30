/**
 * Actions the Calendars screens, the picker and the read-only event sheet trigger, wired to the real
 * Supabase client, the system browser and the toast.
 */
import type { ProtoEvent } from '@calendar/core';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { showToast } from '@/components/toast';
import { supabase } from '@/lib/supabase';
import { runConnect, type ConnectDeps, type ConnectOutcome } from './connect';
import { getCalendarsStore } from './data';

export function realConnectDeps(): ConnectDeps {
  const web = Platform.OS === 'web';
  return {
    platform: web ? 'web' : 'native',
    origin: web && typeof window !== 'undefined' ? window.location.origin : undefined,
    invoke: (name, body) => supabase.functions.invoke(name, { body }),
    openAuth: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
    redirect: (url) => {
      if (typeof window !== 'undefined') window.location.assign(url);
    },
  };
}

/** Connect a Google account (or reconnect one, with `accountId`). Reloads the accounts when it succeeds. */
export async function connectGoogle(opts: { accountId?: string; loginHint?: string } = {}): Promise<ConnectOutcome> {
  const res = await runConnect(realConnectDeps(), opts);
  if (res.kind === 'connected') await getCalendarsStore().reloadAccounts();
  return res;
}

/**
 * Remove someone else's event from every view (EV 05): insert the `hidden_items` row, with an Undo toast
 * that deletes it. Hiding is optimistic, so the event is gone from the views straight away.
 */
export async function removeSomeoneElsesEvent(ev: Pick<ProtoEvent, 'id' | 'title'>): Promise<boolean> {
  const store = getCalendarsStore();
  let key = store.getState().meta[ev.id]?.googleEventId ?? null;
  if (!key) {
    // not loaded yet (or an event that arrived a moment ago): ask the server
    try {
      const { data } = await supabase.from('events').select('google_event_id').eq('id', ev.id).maybeSingle();
      key = data?.google_event_id ?? null;
    } catch {
      key = null;
    }
  }
  if (!key) {
    showToast({ label: 'Couldn’t hide this event. Try again in a moment.' });
    return false;
  }
  try {
    const row = await store.hide('google', key);
    showToast({
      label: 'Hidden from your calendar',
      action: {
        label: 'Undo',
        run: () => {
          void store.unhide(row).catch(() => showToast({ label: 'Couldn’t unhide. Try Settings › Calendars › Hidden events.' }));
        },
      },
    });
    return true;
  } catch {
    showToast({ label: 'Couldn’t hide this event. Check your connection and try again.' });
    return false;
  }
}
