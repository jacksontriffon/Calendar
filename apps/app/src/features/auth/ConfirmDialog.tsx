import { white } from '@calendar/core';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText, ui } from './ui';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Colour the confirm action as destructive. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A centred two-button alert (sign out, final delete). Built from a Modal
 * rather than `Alert.alert`, which does nothing on web.
 */
export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', destructive, onConfirm, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog} testID="confirm-dialog">
          <AppText size={17} lineHeight={22} weight={600} align="center" accessibilityRole="header">
            {title}
          </AppText>
          <AppText size={13.5} lineHeight={19} color={ui.muted} align="center" style={{ marginTop: 6 }}>
            {message}
          </AppText>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" testID="confirm-cancel" onPress={onCancel} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}>
              <AppText size={15.5} color={ui.text}>
                {cancelLabel}
              </AppText>
            </Pressable>
            <View style={styles.sep} />
            <Pressable accessibilityRole="button" testID="confirm-ok" onPress={onConfirm} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}>
              <AppText size={15.5} weight={600} color={destructive ? ui.destructive : ui.accent}>
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, backgroundColor: 'rgba(10,9,9,0.6)' },
  dialog: {
    width: '100%',
    maxWidth: 320,
    paddingTop: 20,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#2a2725',
    borderWidth: 1,
    borderColor: white(0.09),
  },
  actions: { flexDirection: 'row', marginTop: 18, borderTopWidth: 1, borderColor: white(0.09) },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  sep: { width: 1, backgroundColor: white(0.09) },
});
