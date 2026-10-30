import * as SecureStore from 'expo-secure-store';

/**
 * SecureStore-backed key/value storage for the Supabase session.
 *
 * SecureStore values are limited (about 2 KB on Android) and a Supabase session
 * (access + refresh token + user) is larger, so a value is split into chunks
 * stored under `<key>.<n>` plus a `<key>.count` entry. Keys are sanitised
 * because SecureStore only allows alphanumerics, `.`, `-` and `_`.
 */
const CHUNK_SIZE = 1800;

const safeKey = (key: string) => key.replace(/[^\w.-]/g, '_');
const countKey = (key: string) => `${safeKey(key)}.count`;
const chunkKey = (key: string, index: number) => `${safeKey(key)}.${index}`;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const rawCount = await SecureStore.getItemAsync(countKey(key));
    if (rawCount === null) return null;
    const count = Number.parseInt(rawCount, 10);
    if (!Number.isInteger(count) || count < 0) return null;

    const chunks: string[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
      if (chunk === null) return null; // torn write: treat as signed out
      chunks.push(chunk);
    }
    return chunks.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear first so a shorter value never leaves stale trailing chunks.
    await secureStorage.removeItem(key);
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(countKey(key), String(count));
  },

  async removeItem(key: string): Promise<void> {
    const rawCount = await SecureStore.getItemAsync(countKey(key));
    const count = rawCount === null ? 0 : Number.parseInt(rawCount, 10) || 0;
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
