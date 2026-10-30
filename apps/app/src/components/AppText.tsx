import { StyleSheet, Text, TextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import type { ComponentRef, Ref } from 'react';
import { TEXT, text } from '@calendar/core';

import { useStoreState } from '@/store';
import { typeface } from './fonts';

/** The `prefs.font` value (serif / sans / mono). */
export const useFontPref = (): string => useStoreState((s) => s.prefs.font);

interface AppTextProps extends TextProps {
  /** use the display face (Newsreader with the serif setting) for large titles */
  display?: boolean;
}

/** Text in the app's typeface (prefs.font, weight snapped to a loaded file) and primary text colour. */
export function AppText({ style, display, ...rest }: AppTextProps) {
  const font = useFontPref();
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  return <Text {...rest} style={[{ color: TEXT }, style, typeface(font, flat, display)]} />;
}

/** Text input in the app's typeface, on the dark surfaces. */
export function AppInput({ style, ref, ...rest }: TextInputProps & { ref?: Ref<ComponentRef<typeof TextInput>> }) {
  const font = useFontPref();
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  return (
    <TextInput
      placeholderTextColor={text(0.3)}
      selectionColor="#cf7b58"
      {...rest}
      ref={ref}
      style={[{ color: TEXT, padding: 0 }, style, typeface(font, flat)]}
    />
  );
}
