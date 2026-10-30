import { Pressable, StyleSheet } from 'react-native';
import { SURFACE, SWATCH, mixOklab } from '@calendar/core';

import { AppText } from './AppText';

interface Props {
  /** display name or email, reduced to two letters */
  name?: string | null;
  size?: number;
  onPress?: () => void;
}

const initialsOf = (name?: string | null): string => {
  const parts = String(name || '').replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '··';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
};

/**
 * Header avatar: filled hue, dark ink, two letters, 36px, opens Settings.
 * Placeholder until src/features/auth provides the real one; the merge swaps it.
 */
export function HeaderAvatar({ name, size = 36, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      style={({ pressed }) => [
        styles.root,
        { width: size, height: size, borderRadius: size / 2, transform: [{ scale: pressed ? 0.93 : 1 }] },
      ]}
    >
      <AppText style={{ color: SURFACE.onAccent, fontSize: size * 0.36, fontWeight: '600', letterSpacing: 0.3 }}>
        {initialsOf(name)}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: mixOklab(SWATCH[28], 72, SURFACE.bg), alignItems: 'center', justifyContent: 'center' },
});
