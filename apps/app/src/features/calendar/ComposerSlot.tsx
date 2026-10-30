import { useEffect, useRef, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { white, text } from '@calendar/core';

import { AppInput } from '@/components/AppText';

/**
 * The bottom composer bar.
 *
 * TODO(phase 4): the AI composer (note -> ai-schedule, ask flow, thinking
 * pill, goal conversation) replaces this component. It is an empty bar for
 * now so the layout, insets and overlay stack are final; keep the outer size
 * (min height 44, radius 20) when swapping it. `focusToken` is the deep-link
 * hook (`aicalendar://compose` -> `/?compose=1`): focus the input when it changes.
 */
export function ComposerSlot({ hint = 'Summarise your day\u2026', focusToken }: { hint?: string; focusToken?: string }) {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (focusToken) ref.current?.focus();
  }, [focusToken]);
  return (
    <View style={styles.bar} accessibilityLabel="Composer (coming soon)" testID="composer-slot">
      <AppInput
        ref={ref}
        placeholder={hint}
        editable
        returnKeyType="send"
        style={styles.input}
        accessibilityLabel="Composer"
      />
      <View style={styles.send} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderRadius: 20,
    backgroundColor: '#232120', borderWidth: 1, borderColor: white(0.1),
    paddingVertical: 3, paddingLeft: 14, paddingRight: 4,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 17, shadowOffset: { width: 0, height: 10 }, elevation: 10,
  },
  input: { flex: 1, fontSize: 16, color: text(0.9), minHeight: 38 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: white(0.08) },
});
