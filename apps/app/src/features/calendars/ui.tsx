/**
 * Shared chrome for the Calendars screens (CA 1–3): the header with a back button, section labels,
 * cards, the colour bar, the Shared pill and the toggle. Matches Settings.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACCENT, SURFACE, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { ToastHost } from '@/components/Toast';
import { Glyph } from '../visibility/glyphs';

export const goBack = (): void => {
  if (router.canGoBack()) router.back();
  else router.replace('/settings' as never);
};

export function Screen({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={styles.page}>
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <Icon name="chevronLeft" size={18} color={text(0.8)} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</AppText>
            {subtitle ? <AppText style={styles.subtitle} numberOfLines={1}>{subtitle}</AppText> : null}
          </View>
        </View>
        {children}
        {footer}
        <ToastHost bottom={insets.bottom + (footer ? 84 : 16)} />
      </View>
    </View>
  );
}

export function Label({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.labelRow}>
      <AppText style={styles.label}>{children}</AppText>
      {right}
    </View>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: object }) => <View style={[styles.card, style]}>{children}</View>;

export const Divider = () => <View style={{ height: 1, backgroundColor: white(0.06) }} />;

export function ColorBar({ color, dim }: { color: string; dim?: boolean }) {
  return <View style={[styles.bar4, { backgroundColor: color, opacity: dim ? 0.4 : 1 }]} />;
}

export function SharedPill() {
  return (
    <View style={styles.pill}>
      <AppText style={styles.pillTxt}>Shared</AppText>
    </View>
  );
}

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: white(0.12), true: ACCENT }}
      thumbColor={value ? '#17120f' : text(0.65)}
      accessibilityLabel={label}
      {...({ activeThumbColor: '#17120f' } as object)}
    />
  );
}

export function GoogleBadge({ size = 34 }: { size?: number }) {
  return (
    <View style={[styles.gBadge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Icon name="google" size={size * 0.52} color="#171615" strokeWidth={0} />
    </View>
  );
}

/** A row that goes somewhere: round glyph, title, subtitle, chevron. */
export function NavRow({ icon, title, sub, onPress, subColor, badge }: {
  icon: ReactNode; title: string; sub?: string; onPress: () => void; subColor?: string; badge?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.navRow}>
      <View style={styles.navIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText style={styles.navTitle} numberOfLines={1}>{title}</AppText>
        {sub ? <AppText style={[styles.navSub, subColor ? { color: subColor } : null]} numberOfLines={2}>{sub}</AppText> : null}
      </View>
      {badge}
      <Icon name="chevronRight" size={15} color={text(0.35)} />
    </Pressable>
  );
}

export function PlainButton({ label, onPress, icon, disabled, danger }: { label: string; onPress: () => void; icon?: ReactNode; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.btn, danger && styles.btnDanger, disabled && { opacity: 0.5 }]}
    >
      {icon}
      <AppText style={[styles.btnTxt, danger && { color: '#e8745f' }]}>{label}</AppText>
    </Pressable>
  );
}

export function Banner({ text: msg, tone = 'muted', action }: { text: string; tone?: 'muted' | 'error'; action?: { label: string; run: () => void } }) {
  return (
    <View style={[styles.banner, tone === 'error' && { borderColor: 'rgba(232,116,95,0.3)' }]}>
      <Glyph name={tone === 'error' ? 'warning' : 'cloudOff'} size={14} color={tone === 'error' ? '#f0b3a4' : text(0.5)} strokeWidth={2} />
      <AppText style={[styles.bannerTxt, tone === 'error' && { color: '#f0b3a4' }]}>{msg}</AppText>
      {action ? (
        <Pressable onPress={action.run} accessibilityRole="button"><AppText style={{ fontSize: 12.5, color: ACCENT }}>{action.label}</AppText></Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#100f0e', alignItems: 'center' },
  page: { flex: 1, width: '100%', maxWidth: 480, backgroundColor: SURFACE.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: white(0.07), backgroundColor: '#1b1a18' },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: white(0.2) },
  title: { fontSize: 20, fontWeight: '600', letterSpacing: -0.4, lineHeight: 24 },
  subtitle: { fontSize: 12, color: text(0.45), marginTop: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 8, marginHorizontal: 14, minHeight: 28 },
  label: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34) },
  card: { marginHorizontal: 14, backgroundColor: SURFACE.sheet, borderRadius: 14, borderWidth: 1, borderColor: white(0.07), overflow: 'hidden' },
  bar4: { width: 4, height: 28, borderRadius: 2 },
  pill: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 99, borderWidth: 1, borderColor: white(0.16) },
  pillTxt: { fontSize: 10.5, color: text(0.55) },
  gBadge: { backgroundColor: '#f3efe8', alignItems: 'center', justifyContent: 'center' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  navIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.07) },
  navTitle: { fontSize: 15, fontWeight: '500', letterSpacing: -0.2 },
  navSub: { fontSize: 12, lineHeight: 16, color: text(0.45), marginTop: 1 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: white(0.07), borderWidth: 1, borderColor: white(0.12) },
  btnDanger: { backgroundColor: 'rgba(232,116,95,0.11)', borderColor: 'rgba(232,116,95,0.24)' },
  btnTxt: { fontSize: 13, fontWeight: '500' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 14, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: white(0.1), backgroundColor: white(0.03) },
  bannerTxt: { flex: 1, fontSize: 12.5, lineHeight: 17, color: text(0.6) },
});
