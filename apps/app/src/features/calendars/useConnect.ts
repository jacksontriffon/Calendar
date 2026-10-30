import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { connectGoogle } from './actions';
import { CANCELLED_MESSAGE, parseConnectReturn } from './connect';
import { getCalendarsStore } from './data';

export const chooseHref = (accountId: string, from?: string): string => `/settings/calendars/choose/${accountId}${from ? '?from=' + from : ''}`;

/**
 * Connect Google (or reconnect an account) from a Calendars screen: the browser session, then Choose
 * calendars for a new account. `notice` is the CA 2.6 message when Google said no.
 */
export function useConnectGoogle() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const connect = useCallback(async (opts: { accountId?: string; loginHint?: string } = {}) => {
    setBusy(true);
    setNotice(null);
    const r = await connectGoogle(opts);
    setBusy(false);
    if (r.kind === 'connected') {
      if (!opts.accountId && r.accountId) router.push(chooseHref(r.accountId) as never);
    } else if (r.kind === 'cancelled') setNotice(CANCELLED_MESSAGE);
    else if (r.kind === 'error') setNotice(r.message);
  }, []);

  return { busy, notice, connect, clearNotice: () => setNotice(null) };
}

/**
 * Web: Google returns to `/settings/calendars?connected=1&account_id=…` (or `?error=…`). Read it once, move
 * on to Choose calendars, and drop the query so a reload doesn't repeat it.
 */
export function useConnectReturn(onNotice: (msg: string) => void): void {
  const params = useLocalSearchParams<{ connected?: string; account_id?: string; error?: string }>();
  const handled = useRef(false);
  const { connected, account_id, error } = params;
  useEffect(() => {
    if (handled.current || (!connected && !error)) return;
    handled.current = true;
    const qs = new URLSearchParams();
    if (connected) qs.set('connected', connected);
    if (account_id) qs.set('account_id', account_id);
    if (error) qs.set('error', error);
    const r = parseConnectReturn('?' + qs.toString());
    if (r?.kind === 'connected') {
      void getCalendarsStore().reloadAccounts();
      if (r.accountId) router.replace(chooseHref(r.accountId) as never);
      else router.replace('/settings/calendars' as never);
    } else {
      router.replace('/settings/calendars' as never);
      onNotice(r?.kind === 'error' ? r.message : CANCELLED_MESSAGE);
    }
  }, [connected, account_id, error, onNotice]);
}
