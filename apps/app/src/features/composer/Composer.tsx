import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputKeyPressEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { router } from 'expo-router';
import { ACCENT, DANGER_SOFT, text, white } from '@calendar/core';

import { AppInput, AppText } from '@/components/AppText';
import { usePrefs } from '@/store';
import { modelLabel, useUsageState } from '../ai/usage';
import { useSession } from '../auth/session';
import { composer, setProfileTimeZone, useComposer } from './instance';
import { setComposerHeight } from './layout';

const THINK_BORDER = 'rgba(207,123,88,0.45)';
const MAX_INPUT_H = 104;

interface Props {
  hint?: string;
  /** changes (a deep link `?compose=1`) to focus the input */
  focusToken?: string;
}

/**
 * The note composer (bottom bar): a growing text input, the model label and the send button. The
 * border warms up while Claude is thinking and the bar gives a small pulse on every send. While a
 * question sheet is open the input takes a typed answer instead of a note.
 */
export function Composer({ hint = 'Summarise your day…', focusToken }: Props) {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const c = useComposer();
  const prefs = usePrefs();
  const { model } = useUsageState();
  const { profile } = useSession();
  const [h, setH] = useState(0);

  useEffect(() => {
    setProfileTimeZone(profile?.tz);
  }, [profile?.tz]);

  useEffect(() => {
    if (focusToken) ref.current?.focus();
  }, [focusToken]);

  const thinking = c.phase === 'thinking';
  const asking = !!c.ask;
  const ready = !!c.draft.trim() && !thinking;

  /* the border and the send pulse */
  const heat = useSharedValue(0);
  useEffect(() => {
    heat.set(withTiming(thinking ? 1 : 0, { duration: 300 }));
  }, [thinking, heat]);
  const border = useAnimatedStyle(() => ({ opacity: heat.value }));
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!c.seq) return;
    pulse.set(withSequence(
      withTiming(0.98, { duration: 125, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 375, easing: Easing.out(Easing.quad) }),
    ));
  }, [c.seq, pulse]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const onKeyPress = (e: TextInputKeyPressEvent) => {
    if (Platform.OS !== 'web') return;
    const ne = e.nativeEvent as typeof e.nativeEvent & { shiftKey?: boolean };
    if (ne.key === 'Enter' && !ne.shiftKey) {
      (e as unknown as { preventDefault?: () => void }).preventDefault?.();
      composer.send();
    }
  };

  const offline = !prefs.ai.on;
  const pillLabel = offline ? 'Offline' : modelLabel(model);
  const sub = !offline && c.fellBack ? 'offline' : '';

  return (
    <Animated.View style={[styles.bar, bar]} testID="composer-slot" onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
      <Animated.View pointerEvents="none" style={[styles.heat, border]} />
      <View style={styles.col}>
        <AppInput
          ref={ref}
          value={c.draft}
          onChangeText={composer.setDraft}
          onKeyPress={onKeyPress}
          onContentSizeChange={(e) => setH(Math.min(MAX_INPUT_H, Math.ceil(e.nativeEvent.contentSize.height)))}
          onSubmitEditing={() => composer.send()}
          submitBehavior="submit"
          multiline
          placeholder={asking ? 'Or type your own answer…' : hint}
          returnKeyType="send"
          autoCapitalize="sentences"
          autoCorrect={false}
          style={[styles.input, h ? { height: Math.max(31, h + 10) } : null]}
          accessibilityLabel="Composer"
          testID="composer-input"
        />
        <View style={styles.row}>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel={offline ? 'Claude parsing is off' : 'Claude parsing: ' + pillLabel}
            style={({ pressed }) => [styles.pill, pressed && { transform: [{ scale: 0.96 }] }]}
            testID="composer-model"
          >
            <AppText style={styles.pillTxt}>{pillLabel}</AppText>
            {sub ? <AppText style={styles.pillSub}>{sub}</AppText> : null}
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => composer.send()}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel={asking ? 'Send answer' : 'Send'}
            style={[styles.send, { backgroundColor: ready ? ACCENT : white(0.08) }]}
            testID="composer-send"
          >
            <AppText style={[styles.sendArrow, { color: ready ? '#17120f' : text(0.3) }]}>{'↑'}</AppText>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6, minHeight: 44, borderRadius: 20,
    backgroundColor: '#232120', borderWidth: 1, borderColor: white(0.1),
    paddingTop: 3, paddingBottom: 3, paddingLeft: 10, paddingRight: 4,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 17, shadowOffset: { width: 0, height: 10 }, elevation: 10,
  },
  heat: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: 20, borderWidth: 1, borderColor: THINK_BORDER },
  col: { flex: 1, minWidth: 0, gap: 4 },
  input: { fontSize: 16, lineHeight: 21, paddingTop: 7, paddingBottom: 3, paddingLeft: 4, paddingRight: 2, minHeight: 31, maxHeight: MAX_INPUT_H, color: text(0.95) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999,
    backgroundColor: white(0.055), borderWidth: 1, borderColor: white(0.07),
  },
  pillTxt: { fontSize: 12.5, fontWeight: '600', letterSpacing: -0.1, color: text(0.72) },
  pillSub: { fontSize: 12.5, fontWeight: '500', color: DANGER_SOFT },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sendArrow: { fontSize: 15, lineHeight: 18, fontWeight: '600' },
});
