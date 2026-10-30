/** A tiny in-memory store for the queue tests: `getState().data` plus a `commit` that records its label. */
import { DEFAULT_PREFS, type CalendarData, type HistoryKind, type Prefs } from '@calendar/core';

export { DEFAULT_PREFS };

export interface MemoryStoreLike {
  getState(): { data: CalendarData; prefs: Prefs };
  commit(next: CalendarData, label: string, kind?: HistoryKind): void;
  commits: { label: string; kind: HistoryKind | undefined }[];
}

export function createMemoryStoreLike(initial: CalendarData): MemoryStoreLike {
  let data = initial;
  const commits: MemoryStoreLike['commits'] = [];
  return {
    getState: () => ({ data, prefs: DEFAULT_PREFS }),
    commit(next, label, kind) {
      data = next;
      commits.push({ label, kind });
    },
    commits,
  };
}
