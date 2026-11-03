import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { HIDE_SCOPES, HIDE_SCOPE_LABEL, type HideScope } from '@/lib/hideScope';

/**
 * The Remove control of someone else's event. A one-off event is removed on the first tap. A repeating
 * one asks how much of the series first: this event, this and the following events, or all events.
 * `renderTrigger` draws the sheet's own quiet Remove button.
 */
export function RemoveScopeChooser({
  repeating,
  onRemove,
  renderTrigger,
}: {
  repeating: boolean;
  onRemove: (scope: HideScope) => void;
  renderTrigger: (press: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!repeating) return <>{renderTrigger(() => onRemove('this'))}</>;
  if (!open) return <>{renderTrigger(() => setOpen(true))}</>;
  return (
    <View style={styles.box} testID="remove-scope">
      <AppText style={styles.title}>Remove a repeating event</AppText>
      {HIDE_SCOPES.map((scope) => (
        <Pressable
          key={scope}
          onPress={() => onRemove(scope)}
          accessibilityRole="button"
          accessibilityLabel={'Remove: ' + HIDE_SCOPE_LABEL[scope]}
          testID={'remove-scope-' + scope}
          style={styles.option}
        >
          <AppText style={styles.optionTxt}>{HIDE_SCOPE_LABEL[scope]}</AppText>
        </Pressable>
      ))}
      <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Cancel" testID="remove-scope-cancel" style={styles.cancel}>
        <AppText style={{ fontSize: 13, color: text(0.5) }}>Cancel</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 10, padding: 12, gap: 8, borderRadius: 12, backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.1) },
  title: { fontSize: 12.5, color: text(0.5), textAlign: 'center', marginBottom: 2 },
  option: { alignItems: 'center', paddingVertical: 11, borderRadius: 10, backgroundColor: white(0.06), borderWidth: 1, borderColor: white(0.1) },
  optionTxt: { fontSize: 14, fontWeight: '500', color: text(0.85) },
  cancel: { alignItems: 'center', paddingVertical: 6 },
});
