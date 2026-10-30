import { GoogleApi } from '../api.ts';
import type { ConnectDeps } from '../connect.ts';
import type { SyncDeps } from '../deps.ts';
import { AccessTokens } from '../tokens.ts';
import { FakeDb, uid } from './fake_db.ts';
import { FakeGoogle } from './fake_google.ts';

export { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';

export const NOW = Date.parse('2026-10-30T12:00:00Z');

export interface Harness {
  db: FakeDb;
  g: FakeGoogle;
  deps: SyncDeps;
  connect: ConnectDeps;
  sleeps: number[];
  logs: string[];
  userId: string;
}

export const harness = (o: { tz?: string; returnUrls?: string[]; clock?: { t: number } } = {}): Harness => {
  const db = new FakeDb();
  const g = new FakeGoogle();
  const sleeps: number[] = [];
  const logs: string[] = [];
  const clock = o.clock ?? { t: NOW };
  const now = () => clock.t;
  db.now = now;
  const api = new GoogleApi({
    clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x.test/functions/v1/google-connect',
    fetch: g.fetch, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }, random: () => 0.5,
  });
  const tokens = new AccessTokens(db, api, now);
  const userId = uid();
  db.tz.set(userId, o.tz ?? 'America/New_York');
  const log = (m: string, x?: unknown) => { logs.push(x === undefined ? m : m + ' ' + JSON.stringify(x)); };
  return {
    db, g, sleeps, logs, userId,
    deps: { db, api, tokens, now, webhookUrl: 'https://x.test/functions/v1/google-webhook', webhookSecret: 'whsec', log },
    connect: { db, api, tokens, log, returnUrls: o.returnUrls ?? ['aicalendar://google/connected', 'https://www.claude-calendar.com'] },
  };
};
