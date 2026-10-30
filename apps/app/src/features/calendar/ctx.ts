import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import type { DragMode } from './gesture-math';

/**
 * What event blocks share with the grid: the animated hour height and drag
 * state (UI-thread shared values), and the JS callbacks the gesture
 * worklets schedule back onto the React thread. The value is created once and
 * never changes identity, so blocks don't re-render because of it.
 */
export interface GridCtx {
  /** pixels per hour, animated while zooming */
  hh: SharedValue<number>;
  dragOn: SharedValue<boolean>;
  dragId: SharedValue<string>;
  dragStart: SharedValue<number>;
  dragEnd: SharedValue<number>;
  dragDay: SharedValue<number>;
  /** the drag moved more than a tap's wobble */
  dragMoved: SharedValue<boolean>;
  onOpen: (id: string) => void;
  onToggleDone: (id: string) => void;
  onDragStart: (id: string, mode: DragMode) => void;
  onDragLive: (start: number, end: number, dayIdx: number) => void;
  onDragEnd: (id: string, mode: DragMode, start: number, end: number, dayIdx: number, moved: boolean) => void;
  onDragCancel: () => void;
}

export const GridContext = createContext<GridCtx | null>(null);

export function useGridCtx(): GridCtx {
  const c = useContext(GridContext);
  if (!c) throw new Error('GridContext missing');
  return c;
}
