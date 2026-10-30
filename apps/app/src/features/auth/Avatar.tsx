import { SURFACE, mixOklab } from '@calendar/core';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { initials } from './initials';
import { AppText } from './ui';
import { useSession } from './session';

/** Filled hue at 72% over the app background, dark ink: the spec's avatar. */
const AVATAR_BG = mixOklab('#d97757', 72, SURFACE.bg);

interface AvatarProps {
  /** Full name, or an email (initials come from its local part). */
  name?: string | null;
  /** 38 (account), 36 (header), 16 (initials on a block), 56 / 76 on setup / Account. */
  size?: number;
  /** Swatch to fill with instead of the default coral. */
  color?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Round two-letter avatar. With `onPress` it is a button (the calendar header opens Settings with it). */
export function Avatar({ name, size = 36, color, onPress, accessibilityLabel, testID, style }: AvatarProps) {
  const body = (
    <View
      testID={onPress ? undefined : testID}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color ? mixOklab(color, 72, SURFACE.bg) : AVATAR_BG,
        },
        style,
      ]}
    >
      <AppText size={Math.max(7, Math.round(size * 0.385))} weight={600} letterSpacing={0.3} color={SURFACE.bg} style={{ includeFontPadding: false }}>
        {initials(name)}
      </AppText>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? 'Open Settings'} testID={testID} onPress={onPress} hitSlop={6}>
      {body}
    </Pressable>
  );
}

/** The signed-in user's avatar (display name from their profile, else their email). */
export function UserAvatar(props: Omit<AvatarProps, 'name'>) {
  const { displayName, email } = useSession();
  return <Avatar {...props} name={displayName ?? email} />;
}
