import { Text, TextInput, type TextInputProps, type TextProps } from 'react-native';
import { TEXT, text } from '@calendar/core';

import { useStoreState } from '@/store';
import { fontFamilyFor } from './fonts';

/** The font family for the current `prefs.font`. */
export const useFontFamily = (): string | undefined => fontFamilyFor(useStoreState((s) => s.prefs.font));

/** Text in the app's typeface (prefs.font) and primary text colour. */
export function AppText({ style, ...rest }: TextProps) {
  const family = useFontFamily();
  return <Text {...rest} style={[{ color: TEXT, fontFamily: family }, style]} />;
}

/** Text input in the app's typeface, on the dark surfaces. */
export function AppInput({ style, ...rest }: TextInputProps) {
  const family = useFontFamily();
  return (
    <TextInput
      placeholderTextColor={text(0.3)}
      selectionColor="#cf7b58"
      {...rest}
      style={[{ color: TEXT, fontFamily: family, padding: 0 }, style]}
    />
  );
}
