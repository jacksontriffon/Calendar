import type { GoogleApi } from './api.ts';
import type { GoogleDb } from './db.ts';
import type { AccessTokens } from './tokens.ts';

/** Everything the sync code needs, injected so tests can fake it. */
export interface SyncDeps {
  db: GoogleDb;
  api: GoogleApi;
  tokens: AccessTokens;
  /** epoch ms */
  now: () => number;
  /** public URL of the google-webhook function (Google requires https) */
  webhookUrl: string;
  webhookSecret: string;
  log: (msg: string, extra?: unknown) => void;
}
