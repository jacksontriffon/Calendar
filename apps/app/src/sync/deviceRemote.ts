/**
 * The phone-calendar bridge's only door to Supabase.
 *
 * PRIVACY INVARIANT: phone events never reach the server. Everything the bridge says to Supabase goes
 * through this file, and this file can only say three kinds of thing:
 *  1. `event_targets` rows (kind `device`) about OUR events: which of the user's own events was
 *     published to which phone calendar, with a status. Every column is checked by `assertTargetWrite`
 *     before it is sent: ids are uuids / opaque keys / hashes, `status` and `error` come from fixed
 *     sets, so no title, time or note can ride along.
 *  2. `hidden_items` rows whose `external_key` is an opaque hash (`assertHiddenKey`).
 *  3. Reads of the user's connected Google calendars (names and account emails), to hide duplicates.
 *
 * `deviceInvariants.test.ts` fails if any other bridge file imports supabase, and runs the whole
 * bridge against mocked `expo-calendar` while recording every call made here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DeviceRemote, GoogleCalendarRef, RemoteTargetRow, TargetErrorCode, TargetWrite } from './deviceTypes';
import { isUuid } from './deviceMap';
import { toRemoteError } from './remote';

const TARGET_COLUMNS = ['event_id', 'kind', 'device_id', 'device_calendar_key', 'external_id', 'fingerprint', 'status', 'error', 'synced_at'];
const STATUSES = ['pending', 'synced', 'failed', 'queued'];
const ERRORS: (TargetErrorCode | null)[] = [null, 'permission', 'no_calendar', 'not_allowed', 'write_failed'];

/** Throws unless `w` is exactly an `event_targets` device row about one of our events. */
export function assertTargetWrite(w: TargetWrite): TargetWrite {
  const extra = Object.keys(w).filter((k) => !TARGET_COLUMNS.includes(k));
  if (extra.length) throw new Error('device bridge: unexpected event_targets column ' + extra.join(','));
  if (w.kind !== 'device') throw new Error('device bridge: only device targets are written');
  if (!isUuid(w.event_id)) throw new Error('device bridge: event_id must be an event uuid');
  if (!/^[0-9A-Za-z-]{8,64}$/.test(w.device_id)) throw new Error('device bridge: bad device_id');
  if (!/^dc_[0-9a-f]{16}$/.test(w.device_calendar_key)) throw new Error('device bridge: bad device_calendar_key');
  if (!STATUSES.includes(w.status)) throw new Error('device bridge: bad status');
  if (!ERRORS.includes(w.error)) throw new Error('device bridge: bad error code');
  if (w.fingerprint !== null && !/^[0-9a-f]{24}$/.test(w.fingerprint)) throw new Error('device bridge: bad fingerprint');
  if (w.external_id !== null && !/^[^\s]{1,200}$/.test(w.external_id)) throw new Error('device bridge: bad external_id');
  if (w.synced_at !== null && Number.isNaN(Date.parse(w.synced_at))) throw new Error('device bridge: bad synced_at');
  return w;
}

/** Throws unless `k` is an opaque hidden-item key (a hex digest). */
export function assertHiddenKey(k: string): string {
  if (!/^[0-9a-f]{40}$/.test(k)) throw new Error('device bridge: hidden key must be an opaque digest');
  return k;
}

type Res<T> = { data: T | null; error: { message?: string; code?: string } | null; status?: number };

async function call<T>(p: PromiseLike<Res<T>>): Promise<T> {
  let res: Res<T>;
  try {
    res = await p;
  } catch (e) {
    throw toRemoteError(e);
  }
  if (res.error) throw toRemoteError(res.error, res.status);
  return (res.data ?? ([] as unknown)) as T;
}

const PAGE = 1000;

export function createDeviceRemote(client: SupabaseClient): DeviceRemote {
  return {
    async fetchTargets() {
      const out: RemoteTargetRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const page = await call(
          client
            .from('event_targets')
            .select('event_id, device_id, device_calendar_key, external_id, fingerprint, status')
            .eq('kind', 'device')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1),
        );
        const rows = page as unknown as RemoteTargetRow[];
        out.push(...rows.filter((r) => r.device_id && r.device_calendar_key));
        if (rows.length < PAGE) break;
      }
      return out;
    },

    async upsertTargets(rows) {
      if (!rows.length) return;
      const clean = rows.map(assertTargetWrite);
      await call(client.from('event_targets').upsert(clean, { onConflict: 'event_id,device_id,device_calendar_key' }));
    },

    async deleteTargets(keys) {
      for (const k of keys) {
        if (!isUuid(k.event_id) || !/^dc_[0-9a-f]{16}$/.test(k.device_calendar_key)) continue;
        await call(
          client
            .from('event_targets')
            .delete()
            .eq('kind', 'device')
            .eq('event_id', k.event_id)
            .eq('device_id', k.device_id)
            .eq('device_calendar_key', k.device_calendar_key),
        );
      }
    },

    async fetchHiddenKeys() {
      const rows = await call(client.from('hidden_items').select('external_key').eq('source', 'device'));
      return (rows as unknown as { external_key: string }[]).map((r) => r.external_key);
    },

    async insertHidden(key) {
      assertHiddenKey(key);
      await call(client.from('hidden_items').upsert({ source: 'device', external_key: key }, { onConflict: 'user_id,source,external_key', ignoreDuplicates: true }));
    },

    async deleteHidden(key) {
      assertHiddenKey(key);
      await call(client.from('hidden_items').delete().eq('source', 'device').eq('external_key', key));
    },

    async fetchGoogleCalendars() {
      const [accounts, cals] = await Promise.all([
        call(client.from('google_accounts_public').select('id, email')),
        call(client.from('google_calendars').select('account_id, name')),
      ]);
      const email = new Map((accounts as unknown as { id: string; email: string }[]).map((a) => [a.id, a.email]));
      const out: GoogleCalendarRef[] = [];
      (cals as unknown as { account_id: string; name: string }[]).forEach((c) => {
        const e = email.get(c.account_id);
        if (e) out.push({ name: c.name ?? '', accountEmail: e });
      });
      return out;
    },
  };
}
