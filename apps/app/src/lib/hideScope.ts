/**
 * What "Remove" on a repeating event of someone else's covers. Imported events (Google or phone) can't
 * be edited here, so Remove only hides them in this app; the scope says how much of the series goes.
 *
 *  - `this`       just the occurrence you opened
 *  - `following`  this occurrence and every later one
 *  - `all`        every occurrence, past and future
 */
export type HideScope = 'this' | 'following' | 'all';

export const HIDE_SCOPES: readonly HideScope[] = ['this', 'following', 'all'];

export const HIDE_SCOPE_LABEL: Record<HideScope, string> = {
  this: 'This event',
  following: 'This and following events',
  all: 'All events',
};

/** Undo-toast text after removing `title` with `scope`. */
export const hiddenToastLabel = (title: string, scope: HideScope): string =>
  (scope === 'this' ? 'Removed' : scope === 'following' ? 'Removed this and following' : 'Removed all') + ' · ' + title;
