/**
 * Which events Claude (or the offline parser) just created or changed, and where to scroll.
 *
 * The composer publishes this after applying a reply. The calendar grid does not consume it yet:
 * TODO(calendar): pulse the blocks in `ids` for ~3 s and scroll the grid to `focusMin` when `seq`
 * changes (`useAiHighlight()`); until then it is exposed and unused.
 */
import { useSyncExternalStore } from 'react';

export interface AiHighlight {
  /** ids of the created and updated events */
  ids: string[];
  /** earliest start minute among them, to scroll to; null when there is none */
  focusMin: number | null;
  /** increments with every reply so consumers can react to a repeat of the same ids */
  seq: number;
}

let state: AiHighlight = { ids: [], focusMin: null, seq: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export const getAiHighlight = (): AiHighlight => state;
export const subscribeAiHighlight = (l: () => void): (() => void) => {
  subs.add(l);
  return () => {
    subs.delete(l);
  };
};
export const useAiHighlight = (): AiHighlight => useSyncExternalStore(subscribeAiHighlight, getAiHighlight, getAiHighlight);

export function setAiHighlight(ids: string[], focusMin: number | null): void {
  state = { ids, focusMin, seq: state.seq + 1 };
  emit();
}
