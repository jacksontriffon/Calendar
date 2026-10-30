/**
 * What the goodbye screen needs after the session is gone. Held in memory
 * (not in the URL) and lost on reload, in which case Goodbye is generic.
 */
let info: { name: string | null } = { name: null };

export const setGoodbyeInfo = (next: { name: string | null }): void => {
  info = next;
};

export const getGoodbyeInfo = (): { name: string | null } => info;

/** "Sam Rivera" -> "Sam" */
export const firstName = (name: string | null | undefined): string | null => {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n || null;
};
