/**
 * Shared building blocks for the entry and account screens (Welcome, setup,
 * import, Account, delete, the re-sign-in sheet), so they match the Design
 * Spec's OA frames: 22px side gutters, 52px / 14px-radius buttons, 16px-radius
 * cards with hairline-separated rows, 10.5px tracked eyebrows.
 */
import { ACCENT, DANGER_SOFT, SURFACE, TEXT, text, white } from '@calendar/core';
import {
  Fragment,
  Children,
  useEffect,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { asFontKind, fontFamily, type FontKind } from '@/lib/fonts';
import { usePrefs } from '@/store';

import { Icon, type IconName } from './icons';

export const ui = {
  bg: SURFACE.bg,
  sheet: SURFACE.sheet,
  heading: '#f6f2ec',
  text: TEXT,
  muted: text(0.6),
  soft: text(0.45),
  faint: text(0.34),
  accent: ACCENT,
  onAccent: '#17120f',
  card: white(0.045),
  field: white(0.055),
  fieldEdge: white(0.1),
  hairline: white(0.06),
  destructive: '#ff6b5e',
  errorInk: DANGER_SOFT,
} as const;

/** The typeface chosen in Settings (`prefs.font`); serif until the store has one. */
export function useFontKind(): FontKind {
  return asFontKind(usePrefs().font);
}

/** `fontFamily` for a plain RN style (TextInput, etc.). */
export function asFontStyle(kind: FontKind, weight: number = 400): TextStyle {
  return { fontFamily: fontFamily(kind, weight) };
}

interface AppTextProps extends TextProps {
  size?: number;
  weight?: number;
  color?: string;
  lineHeight?: number;
  letterSpacing?: number;
  align?: TextStyle['textAlign'];
  /** Use a fixed face instead of the user's choice (e.g. Welcome is always the default serif). */
  kind?: FontKind;
}

/** Text in the app typeface. React Native picks weight by family, so `fontWeight` stays normal. */
export function AppText({ size = 14, weight = 400, color = ui.text, lineHeight, letterSpacing, align, kind, style, ...rest }: AppTextProps) {
  const chosen = useFontKind();
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fontFamily(kind ?? chosen, weight),
          fontSize: size,
          color,
          lineHeight,
          letterSpacing,
          textAlign: align,
        },
        style,
      ]}
    />
  );
}

/** Tracked small-caps label ("TIME ZONE", "SIGN-IN"). */
export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <AppText size={10.5} letterSpacing={1.1} color={ui.faint} style={[{ textTransform: 'uppercase' }, style]}>
      {children}
    </AppText>
  );
}

export function Title({ children, size = 26, align }: { children: ReactNode; size?: number; align?: TextStyle['textAlign'] }) {
  return (
    <AppText
      accessibilityRole="header"
      size={size}
      lineHeight={size === 26 ? 31 : Math.round(size * 1.2)}
      weight={600}
      letterSpacing={-0.5}
      color={ui.heading}
      align={align}
    >
      {children}
    </AppText>
  );
}

export function Body({ children, align, style }: { children: ReactNode; align?: TextStyle['textAlign']; style?: StyleProp<TextStyle> }) {
  return (
    <AppText size={14.5} lineHeight={21} color={ui.muted} align={align} style={style}>
      {children}
    </AppText>
  );
}

export function Caption({ children, align, style }: { children: ReactNode; align?: TextStyle['textAlign']; style?: StyleProp<TextStyle> }) {
  return (
    <AppText size={11.5} lineHeight={16} color={text(0.4)} align={align} style={style}>
      {children}
    </AppText>
  );
}

/* ---------- buttons ---------- */

export type ButtonVariant = 'accent' | 'light' | 'ghost' | 'danger';

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  accent: { bg: ACCENT, fg: ui.onAccent },
  light: { bg: TEXT, fg: SURFACE.bg },
  ghost: { bg: white(0.08), fg: TEXT, border: white(0.12) },
  danger: { bg: ui.destructive, fg: '#1a0d0b' },
};

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** 52px full-width button (the spec's `Continue` / `Open my calendar` / `Sign out`). */
export function Button({ label, onPress, variant = 'accent', disabled, loading, testID, style }: ButtonProps) {
  const colors = BUTTON_COLORS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border ?? 'transparent',
          borderWidth: colors.border ? 1 : 0,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.fg} /> : null}
      <AppText size={15.5} weight={600} color={colors.fg}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Small pill button: `Connect`, `Use`, `Sync now`, `Edit name`. */
export function SmallButton({ label, onPress, disabled, testID }: { label: string; onPress?: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.smallButton, { opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
    >
      <AppText size={12.5} color={ui.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Quiet text link ("Skip", "Not now", "Back to account"). */
export function TextButton({ label, onPress, color = text(0.55), size = 14, testID }: { label: string; onPress?: () => void; color?: string; size?: number; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" testID={testID} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 6 })}>
      <AppText size={size} color={color}>
        {label}
      </AppText>
    </Pressable>
  );
}

/* ---------- cards and rows ---------- */

/** Rounded card whose children are separated by hairlines. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, style]}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={styles.divider} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

interface RowProps {
  title: string;
  subtitle?: string;
  /** A glyph in the 34px rounded box on the left. */
  icon?: IconName;
  iconColor?: string;
  iconBg?: string;
  /** Replaces the icon box (brand marks). */
  leading?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
}

/** Card row: 34px icon box, 13px title, 11.5px subtitle, optional trailing control. */
export function Row({ title, subtitle, icon, iconColor = text(0.7), iconBg = white(0.07), leading, right, onPress, testID }: RowProps) {
  const content = (
    <View style={styles.row}>
      {leading ?? (icon ? (
        <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={18} color={iconColor} />
        </View>
      ) : null)}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <AppText size={13} weight={500}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText size={11.5} lineHeight={16} color={ui.soft}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" testID={testID} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {content}
    </Pressable>
  );
}

/** Inline error box (OA 1.4): coral tint, warning glyph. */
export function InlineError({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View accessibilityRole="alert" testID={testID} style={styles.inlineError}>
      <View style={{ marginTop: 1 }}>
        <Icon name="warning" size={16} color={ui.errorInk} />
      </View>
      <AppText size={12.5} lineHeight={17} color={ui.errorInk} style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

/** The pill that sits above the buttons when offline. */
export function OfflinePill({ label = 'Offline · connect to sign in' }: { label?: string }) {
  return (
    <View style={styles.pillWrap}>
      <View style={styles.offlinePill}>
        <Icon name="cloudOff" size={14} color={text(0.82)} />
        <AppText size={12.5} weight={500} color={text(0.82)}>
          {label}
        </AppText>
      </View>
    </View>
  );
}

/* ---------- progress ---------- */

/** Progress bar. With no `value` it is indeterminate (a bar sliding across). */
export function ProgressBar({ value }: { value?: number }) {
  const x = useSharedValue(0);
  const indeterminate = value === undefined;
  useEffect(() => {
    if (!indeterminate) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, false);
    return () => cancelAnimation(x);
  }, [indeterminate, x]);
  const slide = useAnimatedStyle(() => ({ left: `${-35 + x.value * 135}%` }));
  return (
    <View style={styles.track} accessibilityRole="progressbar">
      {indeterminate ? (
        <Animated.View style={[styles.fillSlide, slide]} />
      ) : (
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, value))}%` }]} />
      )}
    </View>
  );
}

/* ---------- page chrome ---------- */

/** Round 40px back button + centred 17px title (Account and the delete steps). */
export function ScreenHeader({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.backButton}>
          <Icon name="chevronLeft" size={20} color={text(0.6)} />
        </Pressable>
      ) : (
        <View style={{ width: 40 }} />
      )}
      <AppText size={17} weight={600} letterSpacing={-0.2} align="center" style={{ flex: 1 }} accessibilityRole="header">
        {title}
      </AppText>
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/** Full-screen container with safe-area padding. */
export function Page({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: ui.bg, paddingTop: insets.top, paddingBottom: insets.bottom }, style]}>{children}</View>
  );
}

/** Bottom action bar: 22px gutters, 12px above, 14px below. */
export function Footer({ children }: { children: ReactNode }) {
  return <View style={styles.footer}>{children}</View>;
}

/** The round 72px hero icon on the status screens (import, deleting, goodbye). */
export function Hero({ icon, tone = 'accent' }: { icon: IconName; tone?: 'accent' | 'solid' | 'danger' }) {
  const solid = tone === 'solid';
  const danger = tone === 'danger';
  const color = solid ? ui.onAccent : danger ? ui.destructive : ACCENT;
  return (
    <View
      style={[
        styles.hero,
        solid
          ? { backgroundColor: ACCENT, boxShadow: '0 0 0 8px rgba(207,123,88,0.14)' }
          : danger
            ? { backgroundColor: 'rgba(255,107,94,0.1)', borderWidth: 1, borderColor: 'rgba(255,107,94,0.3)' }
            : { backgroundColor: 'rgba(207,123,88,0.12)', borderWidth: 1, borderColor: 'rgba(207,123,88,0.3)' },
      ]}
    >
      <Icon name={icon} size={solid ? 34 : 30} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    width: '100%',
    height: 52,
    borderRadius: 14,
  },
  smallButton: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: white(0.09),
    borderWidth: 1,
    borderColor: white(0.12),
  },
  card: { borderRadius: 16, overflow: 'hidden', backgroundColor: ui.card },
  divider: { height: 1, backgroundColor: ui.hairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 13 },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(232,116,95,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,116,95,0.3)',
  },
  pillWrap: { alignItems: 'center' },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(34,31,29,0.96)',
    borderWidth: 1,
    borderColor: white(0.12),
  },
  track: { height: 6, borderRadius: 3, backgroundColor: white(0.08), overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: ACCENT },
  fillSlide: { position: 'absolute', top: 0, bottom: 0, width: '35%', borderRadius: 3, backgroundColor: ACCENT },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6, minHeight: 54 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.055) },
  footer: { gap: 10, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 14 },
  hero: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 22 },
});
