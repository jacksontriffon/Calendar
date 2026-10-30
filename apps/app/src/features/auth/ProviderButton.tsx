import * as AppleAuthentication from 'expo-apple-authentication';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppleMark, GoogleMark } from './icons';
import type { AuthProvider } from './oauth';

interface Props {
  provider: AuthProvider;
  onPress: () => void;
  /** This provider's sign-in is running: shows "Signing in…". */
  busy?: boolean;
  /** Dimmed and inert (offline, or the other provider is signing in). */
  disabled?: boolean;
  testID?: string;
}

const SF = Platform.select({ ios: 'System', default: undefined });
const GOOGLE_FONT = Platform.select({ android: 'sans-serif-medium', default: undefined });

/**
 * "Continue with Apple" / "Continue with Google": same height and weight (52px,
 * 14px radius). iOS gets the native white Apple button; everywhere else, and
 * while signing in, a custom one that matches it. Google uses its dark-theme
 * button (#131314 fill, #8E918F outline).
 */
export function ProviderButton({ provider, onPress, busy, disabled, testID }: Props) {
  const inert = disabled || busy;

  if (provider === 'apple' && Platform.OS === 'ios' && !busy) {
    return (
      <View style={[styles.slot, { opacity: disabled ? 0.4 : 1 }]} pointerEvents={disabled ? 'none' : 'auto'}>
        <AppleAuthentication.AppleAuthenticationButton
          testID={testID}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={14}
          style={styles.native}
          onPress={onPress}
        />
      </View>
    );
  }

  const apple = provider === 'apple';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? 'Signing in' : `Continue with ${apple ? 'Apple' : 'Google'}`}
      accessibilityState={{ disabled: !!inert, busy: !!busy }}
      testID={testID}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        apple ? styles.apple : styles.google,
        { opacity: disabled ? 0.4 : pressed ? 0.88 : 1, gap: apple ? 8 : 10 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={apple ? '#000' : '#e3e3e3'} />
      ) : apple ? (
        <AppleMark size={22} color="#000" />
      ) : (
        <GoogleMark size={18} />
      )}
      <Text
        style={
          apple
            ? { fontFamily: SF, fontSize: 17, fontWeight: '600', letterSpacing: -0.4, color: '#000' }
            : { fontFamily: GOOGLE_FONT, fontSize: 15.5, fontWeight: '500', letterSpacing: 0.1, color: '#e3e3e3' }
        }
      >
        {busy ? 'Signing in…' : `Continue with ${apple ? 'Apple' : 'Google'}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { height: 52, width: '100%' },
  native: { height: 52, width: '100%' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 52,
    borderRadius: 14,
  },
  apple: { backgroundColor: '#ffffff' },
  google: { backgroundColor: '#131314', borderWidth: 1, borderColor: '#8e918f' },
});
