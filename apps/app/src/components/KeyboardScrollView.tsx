import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ComponentProps, type ComponentRef } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { revealOffset } from '@/lib/keyboard-math';
import { useKeyboardLift } from '@/lib/useKeyboardLift';

const REVEAL_PAD = 16;

/** Asks the surrounding `KeyboardScrollView` to bring the focused field into view. `AppInput` calls it on focus. */
const RevealCtx = createContext<() => void>(() => {});
export const useRevealOnFocus = (): (() => void) => useContext(RevealCtx);

type Props = ComponentProps<typeof ScrollView> & {
  /**
   * The scroll view runs under the keyboard (a full-screen list) rather than ending above it (a
   * sheet that already rises with the keyboard): then it also needs room below its content, and
   * the keyboard does not count as visible space.
   */
  underKeyboard?: boolean;
};

/**
 * A ScrollView that keeps the focused text field visible: on focus, when the keyboard opens or the
 * scroll view is resized above it, and as a multi-line field grows. It scrolls only when the field
 * is not already fully in view.
 */
export function KeyboardScrollView({
  underKeyboard, onLayout, onScroll, onContentSizeChange, contentContainerStyle, ...rest
}: Props) {
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const viewport = useRef(0);
  const { height: kb } = useKeyboardLift();
  const cover = underKeyboard ? kb : 0;
  const coverRef = useRef(cover);
  coverRef.current = cover;

  const reveal = useCallback(() => {
    if (Platform.OS === 'web') return;
    const input = TextInput.State.currentlyFocusedInput?.();
    const inner = ref.current?.getInnerViewRef?.();
    if (!input || !inner) return;
    input.measureLayout(
      inner as never,
      (_x, y, _w, h) => {
        const to = revealOffset({
          fieldY: y, fieldH: h, offset: offset.current, viewportH: viewport.current - coverRef.current, pad: REVEAL_PAD,
        });
        if (to !== null) ref.current?.scrollTo({ y: to, animated: true });
      },
      () => {}, // the focused field is not inside this scroll view
    );
  }, []);

  /* the keyboard moved under a full-screen list: the content grew by its height, which re-runs reveal via onContentSizeChange */
  useEffect(() => {
    if (underKeyboard) reveal();
  }, [underKeyboard, kb, reveal]);

  const ctx = useMemo(() => () => requestAnimationFrame(reveal), [reveal]);

  return (
    <RevealCtx.Provider value={ctx}>
      <ScrollView
        {...rest}
        ref={ref}
        scrollEventThrottle={rest.scrollEventThrottle ?? 16}
        contentContainerStyle={cover > 0 ? withExtraBottom(contentContainerStyle, cover) : contentContainerStyle}
        onLayout={(e: LayoutChangeEvent) => {
          viewport.current = e.nativeEvent.layout.height;
          onLayout?.(e);
          reveal();
        }}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
        onContentSizeChange={(w, h) => {
          onContentSizeChange?.(w, h);
          reveal();
        }}
      />
    </RevealCtx.Provider>
  );
}

/** The content container style with `extra` more padding at the bottom. */
function withExtraBottom(style: Props['contentContainerStyle'], extra: number): ViewStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const base = typeof flat.paddingBottom === 'number' ? flat.paddingBottom : typeof flat.padding === 'number' ? flat.padding : 0;
  return { ...flat, paddingBottom: base + extra };
}
