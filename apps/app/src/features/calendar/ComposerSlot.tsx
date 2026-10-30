import { StyleSheet, View } from 'react-native';
import { white, text } from '@calendar/core';

import { AppText } from '@/components/AppText';

/**
 * The bottom composer bar.
 *
 * TODO(phase 4): the AI composer (note -> ai-schedule, ask flow, thinking
 * pill, goal conversation) replaces this component. It is an empty,
 * non-interactive bar for now so the layout, insets and overlay stack are
 * final. Keep the outer size (min height 44, radius 20) when swapping it.
 */
export function ComposerSlot({ hint = 'Summarise your day…' }: { hint?: string }) {
  return (
    <View style={styles.bar} accessibilityLabel="Composer (coming soon)" testID="composer-slot">
      <AppText style={styles.hint} numberOfLines={1}>{hint}</AppText>
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
  hint: { flex: 1, fontSize: 16, color: text(0.32) },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: white(0.08) },
});
