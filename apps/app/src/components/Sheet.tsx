import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing, runOnUI, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { SURFACE, white } from '@calendar/core';

const OPEN_EASE = Easing.bezier(0.2, 0.86, 0.24, 1);
const CLOSE_EASE = Easing.bezier(0.4, 0, 1, 1);

const SheetCtx = createContext<{ close: () => void }>({ close: () => {} });
/** Close the surrounding sheet with its exit animation. */
export const useSheetClose = (): (() => void) => useContext(SheetCtx).close;

interface Props {
  /** called after the exit animation (navigate back / unmount) */
  onClosed: () => void;
  children: ReactNode;
  /** 0..1 of the window height; the panel grows to its content up to this */
  maxHeightFraction?: number;
  testID?: string;
}

/**
 * Bottom sheet with the prototype's overlay, slide-in/out and a drag-down
 * handle. Used for the event sheet, goal detail and the goals list.
 */
export function Sheet({ onClosed, children, maxHeightFraction = 0.9, testID }: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [panelH, setPanelH] = useState(Math.round(winH * 0.7));
  const p = useSharedValue(0);
  const drag = useSharedValue(0);
  const closing = useSharedValue(false);

  useEffect(() => {
    p.set(withTiming(1, { duration: 300, easing: OPEN_EASE }));
  }, [p]);

  const finish = useCallback(() => onClosed(), [onClosed]);
  const close = useCallback(() => {
    runOnUI(() => {
      'worklet';
      if (closing.value) return;
      closing.set(true);
      p.set(withTiming(0, { duration: 230, easing: CLOSE_EASE }, (done) => {
        if (done) scheduleOnRN(finish);
      }));
    })();
  }, [closing, p, finish]);

  const pan = usePanGesture({
    activeOffsetY: [-4, 4],
    onUpdate: (e) => {
      'worklet';
      drag.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      if (drag.value > 90 || e.velocityY > 900) {
        closing.set(true);
        p.set(withTiming(0, { duration: 200, easing: CLOSE_EASE }, (done) => {
          if (done) scheduleOnRN(finish);
        }));
      } else drag.set(withTiming(0, { duration: 180 }));
    },
  });

  const backdrop = useAnimatedStyle(() => ({ opacity: p.value }));
  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - p.value) * panelH + drag.value }],
  }));
  const ctx = useMemo(() => ({ close }), [close]);

  return (
    <SheetCtx.Provider value={ctx}>
      <View style={[StyleSheet.absoluteFill, { zIndex: 60 }]} pointerEvents="box-none" testID={testID}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        </Animated.View>
        <View style={styles.bottom} pointerEvents="box-none">
          <Animated.View
            onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
            style={[
              styles.panel,
              { maxHeight: winH * maxHeightFraction, paddingBottom: insets.bottom + 22 },
              panel,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View style={styles.handleHit} accessibilityLabel="Drag down to close">
                <View style={styles.handle} />
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </View>
      </View>
    </SheetCtx.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10,9,9,0.55)' },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    backgroundColor: SURFACE.sheet,
    borderTopWidth: 1,
    borderTopColor: white(0.09),
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 -20px 50px rgba(0,0,0,.45)' } : { elevation: 24 }),
  },
  handleHit: { alignItems: 'center', paddingTop: 8, paddingBottom: 8, marginHorizontal: -18 },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: white(0.16) },
});
