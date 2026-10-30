import * as SecureStore from 'expo-secure-store';

import { secureStorage } from './secureStorage';

// In-memory stand-in for the Keychain / Keystore.
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

beforeEach(() => mockStore.clear());

describe('secureStorage', () => {
  it('round-trips a value larger than one SecureStore entry', async () => {
    const value = 'x'.repeat(5000);
    await secureStorage.setItem('sb-session', value);
    expect(await secureStorage.getItem('sb-session')).toBe(value);
    expect(mockStore.size).toBeGreaterThan(2); // chunks + count
    for (const [, v] of mockStore) expect(v.length).toBeLessThanOrEqual(1800);
  });

  it('returns null for a missing key and removes all chunks', async () => {
    expect(await secureStorage.getItem('missing')).toBeNull();
    await secureStorage.setItem('k', 'y'.repeat(4000));
    await secureStorage.removeItem('k');
    expect(await secureStorage.getItem('k')).toBeNull();
    expect(mockStore.size).toBe(0);
  });

  it('overwriting with a shorter value leaves no stale chunks', async () => {
    await secureStorage.setItem('k', 'a'.repeat(4000));
    await secureStorage.setItem('k', 'short');
    expect(await secureStorage.getItem('k')).toBe('short');
    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    expect(mockStore.size).toBe(2);
  });

  it('sanitises keys SecureStore would reject', async () => {
    await secureStorage.setItem('sb:abc/def', 'v');
    expect([...mockStore.keys()].every((k) => /^[\w.-]+$/.test(k))).toBe(true);
    expect(await secureStorage.getItem('sb:abc/def')).toBe('v');
  });
});
