/**
 * Small pieces shared by the picker, the event sheet's row and the category default: the
 * Private | Public segmented control, the checkbox, per-target status, source glyphs.
 * Styles follow the Design Spec frames (EV 02).
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { ACCENT, DANGER, DANGER_SOFT, SURFACE, oklchToHex, text, white, type Visibility } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Glyph, Spinner } from './glyphs';
import { STATUS_LABEL, type UiStatus } from './status';

export const SYNCED_GREEN = oklchToHex(0.76, 0.13, 150);

/** Private | Public (EV 2.1): 40px tall, Public carries the globe. */
export function VisibilitySegments({ value, onChange, testID }: { value: Visibility; onChange: (v: Visibility) => void; testID?: string }) {
  return (
    <View style={styles.seg} accessibilityRole="radiogroup" testID={testID}>
      {(['private', 'public'] as Visibility[]).map((v) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={v === 'private' ? 'Private' : 'Public'}
            style={[styles.segBtn, on && styles.segOn]}
          >
            <Icon name={v === 'private' ? 'lock' : 'globe'} size={14} color={on ? '#f3efe8' : text(0.42)} strokeWidth={1.9} />
            <AppText style={[styles.segTxt, on && { color: '#f3efe8' }]}>{v === 'private' ? 'Private' : 'Public'}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The 22px rounded checkbox: filled accent with a check, or a hairline outline. */
export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.box, checked ? { backgroundColor: ACCENT } : styles.boxOff]}>
      {checked ? <Icon name="check" size={14} color={SURFACE.bg} strokeWidth={2.8} /> : null}
    </View>
  );
}

/** "Synced" (green tick), "Pending" (accent spinner), "Queued" (cloud-off, muted). Failed is a Retry button elsewhere. */
export function StatusTag({ status }: { status: UiStatus }) {
  if (status === 'failed') return null;
  return (
    <View style={styles.tag} testID={'status-' + status}>
      {status === 'synced' ? <Icon name="check" size={13} color={SYNCED_GREEN} strokeWidth={2.4} /> : null}
      {status === 'pending' ? <Spinner size={12} /> : null}
      {status === 'queued' ? <Glyph name="cloudOff" size={13} color={text(0.45)} strokeWidth={2} /> : null}
      <AppText style={[styles.tagTxt, status === 'pending' && { color: text(0.6) }]}>{STATUS_LABEL[status]}</AppText>
    </View>
  );
}

export function RetryButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Retry" style={styles.retry}>
      <AppText style={styles.retryTxt}>Retry</AppText>
    </Pressable>
  );
}

/** Overlapping 20px circles: "G" for Google, a phone for this phone (EV 1.2). */
export function SourceGlyphs({ google, device }: { google: boolean; device: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {google ? (
        <View style={styles.srcDot}>
          <AppText style={{ fontSize: 10.5, fontWeight: '700', color: '#f3efe8', lineHeight: 13 }}>G</AppText>
        </View>
      ) : null}
      {device ? (
        <View style={[styles.srcDot, google && { marginLeft: -8 }]}>
          <Icon name="phone" size={11} color={text(0.8)} strokeWidth={2} />
        </View>
      ) : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <AppText style={styles.label}>{children}</AppText>;
}

export const danger = { text: DANGER, soft: DANGER_SOFT };

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', padding: 2, gap: 2, backgroundColor: white(0.055), borderRadius: 9 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 40, borderRadius: 7 },
  segOn: { backgroundColor: white(0.11) },
  segTxt: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1, color: text(0.42) },
  box: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  boxOff: { borderWidth: 1.5, borderColor: white(0.26) },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tagTxt: { fontSize: 11.5, color: text(0.45) },
  retry: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 9, backgroundColor: 'rgba(232,116,95,0.11)', borderWidth: 1, borderColor: 'rgba(232,116,95,0.24)' },
  retryTxt: { fontSize: 12, color: DANGER },
  srcDot: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3a3633',
    borderWidth: 2, borderColor: '#292624',
  },
  label: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34) },
});
