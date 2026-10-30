import { useEffect, useId, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { ACCENT, SURFACE, text, white } from '@calendar/core';

import { undoEntry } from '@/features/history/commit';
import { dismissSyncConflict, useSyncConflict } from '@/store';
import { AppText } from './AppText';
import { Icon } from './Icon';
import {
  dismissToast, registerHost, showToast, subscribeHosts, topHost, useToastItem,
} from './toast';

interface Props {
  /** distance from the bottom edge, to sit above the composer */
  bottom?: number;
}

/** Renders the current toast (label, dismiss ×, optional Undo). The latest mounted host wins. */
export function ToastHost({ bottom = 0 }: Props) {
  const toast = useToastItem();
  const me = useId();
  useEffect(() => registerHost(me), [me]);
  const top = useSyncExternalStore(subscribeHosts, topHost, topHost);
  const { conflict } = useSyncConflict();
  const isTop = top === me;
  /* OA 05: a remote change replaced a local edit. Show it as an Undo toast (the conflict's own undo puts the edit back). */
  useEffect(() => {
    if (!isTop || !conflict) return;
    showToast({
      label: 'Updated from another device \u00b7 ' + conflict.label,
      action: { label: 'Undo', run: conflict.undo },
    });
    dismissSyncConflict(conflict.id);
  }, [isTop, conflict]);
  if (!toast || top !== me) return null;

  const onUndo = () => {
    dismissToast();
    if (toast.action) toast.action.run();
    else if (toast.undoId) undoEntry(toast.undoId);
  };
  const hasAction = !!(toast.undoId || toast.action);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <Animated.View
        key={toast.id}
        entering={FadeInDown.duration(300)}
        exiting={FadeOut.duration(250)}
        style={[styles.pill, { paddingRight: hasAction ? 12 : 13 }]}
        accessibilityLiveRegion="polite"
      >
        <Pressable onPress={dismissToast} accessibilityLabel="Dismiss" style={styles.close} hitSlop={8}>
          <Icon name="close" size={12} color={text(0.45)} strokeWidth={2.2} />
        </Pressable>
        <AppText style={styles.label} numberOfLines={2}>{toast.label}</AppText>
        {hasAction ? (
          <Pressable onPress={onUndo} accessibilityRole="button" hitSlop={8}>
            <AppText style={styles.undo}>{toast.action?.label ?? 'Undo'}</AppText>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 70 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 340,
    backgroundColor: SURFACE.toast, borderWidth: 1, borderColor: white(0.1), borderRadius: 11,
    paddingVertical: 7, paddingLeft: 6,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 13, shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  close: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  label: { fontSize: 12, lineHeight: 16, color: text(0.82), flexShrink: 1 },
  undo: { fontSize: 12, fontWeight: '600', color: ACCENT, marginLeft: 6, textDecorationLine: 'underline' },
});
