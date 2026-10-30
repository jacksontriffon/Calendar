/**
 * Per-invocation access-token cache. Access tokens come from the account's refresh token (Vault),
 * are cached in memory until shortly before they expire, and concurrent requests for the same
 * account share one refresh. `invalid_grant` flips the account to `needs_signin` and raises
 * {@link NeedsSigninError}.
 */
import { InvalidGrantError } from './api.ts';
import type { GoogleApi } from './api.ts';
import type { GoogleDb } from './db.ts';

export class NeedsSigninError extends Error {
  constructor(public accountId: string) {
    super('Google needs you to sign in again');
    this.name = 'NeedsSigninError';
  }
}

export class AccessTokens {
  private cache = new Map<string, { token: string; exp: number } | Promise<string>>();

  constructor(private db: GoogleDb, private api: GoogleApi, private now: () => number = Date.now) {}

  /** Seeds a token we already hold (the one from the OAuth code exchange). */
  prime(accountId: string, token: string, expiresInSec: number): void {
    this.cache.set(accountId, { token, exp: this.now() + expiresInSec * 1000 - 60000 });
  }

  async get(accountId: string): Promise<string> {
    const hit = this.cache.get(accountId);
    if (hit instanceof Promise) return hit;
    if (hit && hit.exp > this.now()) return hit.token;

    const p = this.refresh(accountId);
    this.cache.set(accountId, p);
    try {
      return await p;
    } catch (e) {
      this.cache.delete(accountId);
      throw e;
    }
  }

  private async refresh(accountId: string): Promise<string> {
    const refreshToken = await this.db.getRefreshToken(accountId);
    if (!refreshToken) {
      await this.db.setAccountStatus(accountId, 'needs_signin');
      throw new NeedsSigninError(accountId);
    }
    try {
      const r = await this.api.refreshAccessToken(refreshToken);
      this.cache.set(accountId, { token: r.access_token, exp: this.now() + r.expires_in * 1000 - 60000 });
      return r.access_token;
    } catch (e) {
      if (e instanceof InvalidGrantError) {
        await this.db.setAccountStatus(accountId, 'needs_signin');
        throw new NeedsSigninError(accountId);
      }
      throw e;
    }
  }
}
