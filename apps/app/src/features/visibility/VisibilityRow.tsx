import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ACCENT, DANGER_SOFT, text, white, type Visibility } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useGoogleAccounts } from '../calendars/data';
import { publishableCalendars } from '../calendars/view';
import { Glyph } from './glyphs';
import { takeConnectReturn } from './connectReturn';
import { SourceGlyphs } from './parts';
import { VisibilityPicker } from './VisibilityPicker';
import { pickerEqual, selectedCount, type PickerState } from './state';
import { worstStatus } from './status';
import { useVisibilityData } from './useVisibility';

interface Props {
  eventId: string;
  eventTitle: string;
  when: string;
  /** the event's visibility as the sheet shows it (draft included) */
  visibility: Visibility;
  isSeries: boolean;
  /** the picker's Done: the new choice, and what the event was saved as before the sheet changed anything */
  onApply: (after: PickerState, before: PickerState) => void;
}

/**
 * The Visibility row on the event sheet (EV 01): what the event is and where it goes. Tap it to open the
 * picker. The choice is applied to the sheet's draft; the sheet saves it when it closes.
 */
export function VisibilityRow({ eventId, eventTitle, when, visibility, isSeries, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState<PickerState | null>(null);
  const [tick, setTick] = useState<string[] | undefined>(undefined);
  // `visibility` includes the sheet's draft; what is saved is the baseline until the picker is used
  const [savedVis] = useState<Visibility>(visibility);
  const data = useVisibilityData(eventId, savedVis);
  const { views } = useGoogleAccounts();

  const current: PickerState = override ?? data.saved;
  const isPublic = current.visibility === 'public';
  const total = selectedCount(current);
  const worst = useMemo(() => (override ? null : worstStatus(data.counts)), [override, data.counts]);

  /* EV 2.12: back from Connect Google, reopen the picker with the new account's calendar ticked */
  useFocusEffect(
    useCallback(() => {
      const r = takeConnectReturn(eventId);
      if (!r) return;
      const groups = publishableCalendars(views);
      const g = groups.find((x) => x.account.id === r.accountId) ?? groups[groups.length - 1];
      const cal = g ? g.calendars.find((c) => c.is_primary) ?? g.calendars[0] : undefined;
      setTick(cal ? [cal.id] : undefined);
      setOverride((o) => o ?? { ...data.saved, visibility: 'public' });
      setOpen(true);
    }, [eventId, views, data.saved]),
  );

  const label = isPublic ? 'Public' : 'Private';
  const detail = isPublic ? (total ? ' · ' + total + (total === 1 ? ' calendar' : ' calendars') : ' · nowhere yet') : ' · Only you';

  return (
    <View style={{ marginTop: 15 }}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={'Visibility: ' + label + (isPublic ? ', ' + total + ' calendars' : '')}
        style={styles.row}
        testID="visibility-row"
      >
        <View style={styles.icon}>
          <Icon name={isPublic ? 'globe' : 'lock'} size={16} color={ACCENT} strokeWidth={1.8} />
        </View>
        <AppText style={styles.main} numberOfLines={1}>
          {label}
          <AppText style={styles.detail}>{detail}</AppText>
        </AppText>
        {isPublic && worst === 'failed' ? (
          <View style={styles.state}>
            <Glyph name="warning" size={13} color={DANGER_SOFT} strokeWidth={2} />
            <AppText style={[styles.stateTxt, { color: DANGER_SOFT }]}>Failed</AppText>
          </View>
        ) : isPublic && worst === 'queued' ? (
          <View style={styles.state}>
            <Glyph name="cloudOff" size={13} color={text(0.5)} strokeWidth={2} />
            <AppText style={styles.stateTxt}>Queued</AppText>
          </View>
        ) : isPublic && total ? (
          <SourceGlyphs google={current.google.length > 0} device={current.device.length > 0} />
        ) : null}
        <Icon name="chevronRight" size={15} color={text(0.3)} strokeWidth={2} />
      </Pressable>
      {isSeries ? <AppText style={styles.note}>Applies to this and all future events in the series.</AppText> : null}
      <VisibilityPicker
        open={open}
        eventId={eventId}
        eventTitle={eventTitle}
        when={when}
        isSeries={isSeries}
        savedVisibility={savedVis}
        value={current}
        tick={tick ? { google: tick } : undefined}
        onClose={() => {
          setOpen(false);
          setTick(undefined);
        }}
        onDone={(next) => {
          if (pickerEqual(next, current)) return;
          setOverride(next);
          onApply(next, data.saved);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 46, paddingLeft: 8, paddingRight: 12, borderRadius: 12,
    backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.08),
  },
  icon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(207,123,88,0.16)' },
  main: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
  detail: { color: text(0.5), fontWeight: '400' },
  state: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stateTxt: { fontSize: 11.5, color: text(0.5) },
  note: { fontSize: 11.5, color: text(0.38), marginTop: 8 },
});
