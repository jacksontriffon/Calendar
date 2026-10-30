/**
 * Environment access that fails clearly. Functions take an `Env` (default: `Deno.env`) so tests can
 * pass their own.
 */

export class MissingEnvError extends Error {
  constructor(public readonly names: string[]) {
    super(
      `Missing required secret${names.length > 1 ? 's' : ''}: ${names.join(', ')}. ` +
        `Set with \`supabase secrets set ${names[0]}=...\` (see supabase/README.md > Edge function secrets).`,
    );
    this.name = 'MissingEnvError';
  }
}

export interface Env {
  /** The value, or throws `MissingEnvError` when unset or empty. */
  req(name: string): string;
  /** The value, or undefined when unset or empty. */
  opt(name: string): string | undefined;
  /** An integer value, or `fallback` when unset. Throws when set to something that is not a non-negative integer. */
  int(name: string, fallback: number): number;
}

export const makeEnv = (get: (name: string) => string | undefined = (n) => Deno.env.get(n)): Env => {
  const opt = (name: string): string | undefined => {
    const v = get(name);
    return v == null || v.trim() === '' ? undefined : v.trim();
  };
  return {
    opt,
    req(name) {
      const v = opt(name);
      if (v === undefined) throw new MissingEnvError([name]);
      return v;
    },
    int(name, fallback) {
      const v = opt(name);
      if (v === undefined) return fallback;
      if (!/^\d+$/.test(v)) throw new Error(`${name} must be a non-negative integer, got "${v}"`);
      return Number(v);
    },
  };
};

/** `makeEnv()` over a plain object (for tests). */
export const envFrom = (vars: Record<string, string | undefined>): Env => makeEnv((n) => vars[n]);
