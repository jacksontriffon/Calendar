import { router } from 'expo-router';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DANGER_SOFT, SURFACE, text, white, type Visibility } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { ConfirmDialog } from '@/features/auth/ConfirmDialog';
import { connectGoogle } from '../calendars/actions';
import { CANCELLED_MESSAGE } from '../calendars/connect';
import { Glyph, Spinner } from './glyphs';
import type { PickGroup, PickOption } from './groups';
import { setConnectReturn } from './connectReturn';
import { leavesMessage } from './payload';
import { Checkbox, RetryButton, StatusTag, VisibilitySegments } from './parts';
import { retryGoogleTargets } from './persist';
import { canFinish, initPicker, pickerReducer, selectedCount, type PickerState } from './state';
import { countStatuses, publicTitle, summaryLine } from './status';
import { useVisibilityData } from './useVisibility';

export interface PickerProps {
  open: boolean;
  eventId: string;
  eventTitle: string;
  /** "Sat 31 Oct, 11:00" */
  when: string;
  isSeries: boolean;
  /** the event's visibility as saved (what the row said before the picker opened) */
  savedVisibility: Visibility;
  /** the choice so far (the row's override, or what is saved) */
  value: PickerState;
  /** calendars to tick as the picker opens (the one a Connect Google flow just added) */
  tick?: { google?: string[] };
  onDone: (next: PickerState) => void;
  onClose: () => void;
}

/** The Visibility picker (EV 02): Private or Public, and for Public a checklist of calendars by source. */
export function VisibilityPicker(p: PickerProps) {
  return (
    <Modal visible={p.open} transparent animationType="slide" onRequestClose={p.onClose} statusBarTranslucent>
      {p.open ? <PickerBody {...p} /> : null}
    </Modal>
  );
}

function PickerBody({ eventId, eventTitle, when, isSeries, savedVisibility, value, tick, onDone, onClose }: PickerProps) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const data = useVisibilityData(eventId, savedVisibility);
  const [state, dispatch] = useReducer(pickerReducer, value, (v) => (tick?.google ? pickerReducer(initPicker(v), { type: 'tick', source: 'google', ids: tick.google }) : initPicker(v)));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const options = useMemo(() => data.groups.flatMap((g) => g.options), [data.groups]);
  const nameOf = useCallback((id: string) => options.find((o) => o.id === id)?.name ?? null, [options]);
  const nothingToPublish = data.load === 'ready' && data.groups.length === 0;
  const loading = data.load === 'idle' || data.load === 'loading';
  const failed = data.load === 'error';

  const picked = useMemo(() => new Set([...state.google, ...state.device]), [state.google, state.device]);
  const statuses = useMemo(() => options.filter((o) => picked.has(o.id)).map((o) => o.status), [options, picked]);
  const counts = useMemo(() => ({ ...countStatuses(statuses), total: selectedCount(state) }), [statuses, state]);

  const setVisibility = (v: Visibility) => {
    // EV 3.3: making a repeating event private is the riskier way round; name what it leaves first
    if (v === 'private' && isSeries && savedVisibility === 'public' && data.saved.google.length + data.saved.device.length > 0) {
      setConfirm(true);
      return;
    }
    dispatch({ type: 'visibility', visibility: v });
  };

  const leaving = useMemo(
    () => [...data.saved.google, ...data.saved.device].map(nameOf).filter((n): n is string => !!n),
    [data.saved, nameOf],
  );

  const goManage = (g: PickGroup) => {
    onClose();
    router.push((g.source === 'google' ? `/settings/calendars/account/${g.accountId}` : '/settings/calendars/phone') as never);
  };

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    const r = await connectGoogle();
    setBusy(false);
    if (r.kind === 'connected') {
      setConnectReturn({ eventId, accountId: r.accountId });
      onClose();
      router.push((r.accountId ? `/settings/calendars/choose/${r.accountId}?from=picker` : '/settings/calendars') as never);
    } else if (r.kind === 'cancelled') setNotice(CANCELLED_MESSAGE);
    else if (r.kind === 'error') setNotice(r.message);
  };

  const usePhone = () => {
    onClose();
    router.push('/settings/calendars/phone' as never);
  };

  const done = canFinish(state) && !loading;
  const title = state.visibility === 'public' ? (nothingToPublish && !selectedCount(state) ? 'Nowhere to publish yet.' : publicTitle(counts.total)) : 'Private';
  const sub =
    state.visibility === 'private'
      ? 'Only you'
      : nothingToPublish && !selectedCount(state)
        ? 'Connect a calendar first.'
        : loading
          ? ''
          : selectedCount(state) === 0
            ? 'Pick at least one calendar.'
            : summaryLine(counts);

  return (
    <View style={styles.root} testID="visibility-picker">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.panel, { maxHeight: winH - 46 }]}>
        <View style={styles.head}>
          <View style={styles.grab} />
          <View style={styles.headRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText style={styles.title} accessibilityRole="header">Visibility</AppText>
              <AppText style={styles.subtitle} numberOfLines={1}>{eventTitle}{eventTitle ? ' · ' : ''}{when}</AppText>
            </View>
            {!data.online ? (
              <View style={styles.offline} testID="offline-pill">
                <Glyph name="cloudOff" size={12} color={text(0.7)} strokeWidth={2} />
                <AppText style={styles.offlineTxt}>Offline</AppText>
              </View>
            ) : null}
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Icon name="close" size={13} color={text(0.6)} strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>

        <View style={{ marginHorizontal: 18 }}>
          <VisibilitySegments value={state.visibility} onChange={setVisibility} testID="picker-segments" />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 14 }} showsVerticalScrollIndicator={false}>
          {state.visibility === 'private' ? (
            <AppText style={styles.privNote}>Only you can see this event. It stays in this app and isn{'’'}t sent to Google or your phone.</AppText>
          ) : failed ? (
            <Empty
              title="Couldn't load your calendars"
              body={data.error || 'Check your connection and try again.'}
              action={<Pill label="Try again" onPress={() => void data.refresh()} primary />}
            />
          ) : loading ? (
            <Skeleton />
          ) : nothingToPublish && !selectedCount(state) ? (
            <Empty
              title="Nowhere to publish yet"
              body="Public events need a calendar to go to. Add one to get started."
              action={
                <View style={{ gap: 10, alignSelf: 'stretch' }}>
                  <Pill label={busy ? 'Connecting…' : 'Connect Google'} onPress={connect} primary google disabled={busy || !data.online} />
                  {data.deviceAvailable ? <Pill label={'Use this phone’s calendars'} onPress={usePhone} phone /> : null}
                  {notice ? <AppText style={styles.notice}>{notice}</AppText> : null}
                  {!data.online ? <AppText style={styles.notice}>Connect Google when you{'’'}re back online.</AppText> : null}
                </View>
              }
            />
          ) : (
            <>
              {data.groups.map((g) => (
                <Group
                  key={g.key}
                  group={g}
                  picked={picked}
                  onToggle={(o) => dispatch({ type: 'toggle', source: g.source, id: o.id })}
                  onManage={() => goManage(g)}
                  onRetry={() => retryGoogleTargets(eventId, data.saved.google, isSeries)}
                />
              ))}
              {selectedCount(state) === 0 ? (
                <View style={{ marginTop: 14, gap: 2 }}>
                  <AppText style={styles.hint}>Pick at least one calendar.</AppText>
                  <AppText style={styles.hint}>Or switch back to Private.</AppText>
                </View>
              ) : null}
              {isSeries ? <AppText style={[styles.hint, { marginTop: 14 }]}>Applies to this and all future events in the series.</AppText> : null}
            </>
          )}
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText style={styles.footTitle} numberOfLines={1}>{title}</AppText>
            {sub ? <AppText style={styles.footSub} numberOfLines={1}>{sub}</AppText> : null}
          </View>
          <Pressable
            onPress={() => {
              if (!done) return;
              onDone(state);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityState={{ disabled: !done }}
            style={[styles.doneBtn, !done && { opacity: 0.35 }]}
            testID="picker-done"
          >
            <AppText style={styles.doneTxt}>Done</AppText>
          </Pressable>
        </View>
      </View>
      <ConfirmDialog
        visible={confirm}
        title="Make private?"
        message={leavesMessage(eventTitle || 'This event', leaving) || 'Making it private removes it from the calendars it is on, for this and all future events.'}
        confirmLabel="Make private"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          dispatch({ type: 'visibility', visibility: 'private' });
        }}
      />
    </View>
  );
}

function Group({ group, picked, onToggle, onManage, onRetry }: {
  group: PickGroup;
  picked: ReadonlySet<string>;
  onToggle: (o: PickOption) => void;
  onManage: () => void;
  onRetry: () => void;
}) {
  return (
    <View testID={'group-' + group.source}>
      <View style={styles.groupHead}>
        <AppText style={styles.groupLabel} numberOfLines={1}>
          {group.source === 'google' ? 'Google' : 'On this phone'}
          {group.label ? <AppText style={styles.groupEmail}>{' · ' + group.label}</AppText> : null}
        </AppText>
        <Pressable onPress={onManage} accessibilityRole="button" accessibilityLabel={'Manage ' + (group.label || 'phone calendars')} style={styles.manage}>
          <AppText style={styles.manageTxt}>Manage</AppText>
        </Pressable>
      </View>
      <View style={styles.card}>
        {group.options.map((o, i) => {
          const on = picked.has(o.id);
          const status = on ? o.status : null;
          return (
            <View key={o.id} style={[styles.opt, i < group.options.length - 1 && styles.optDivider]}>
              <Pressable
                onPress={() => onToggle(o)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={o.name}
                style={styles.optMain}
              >
                <Checkbox checked={on} />
                <View style={[styles.bar, { backgroundColor: o.color }]} />
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <AppText style={styles.optName} numberOfLines={1}>{o.name}</AppText>
                  {status === 'failed' ? (
                    <AppText style={[styles.optSub, { color: DANGER_SOFT }]} numberOfLines={1}>Failed {'·'} {o.failure}</AppText>
                  ) : (
                    <AppText style={styles.optSub} numberOfLines={1}>{o.subtitle}</AppText>
                  )}
                </View>
              </Pressable>
              {status === 'failed' ? <RetryButton onPress={onRetry} /> : status ? <StatusTag status={status} /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Skeleton() {
  const row = (last: boolean) => (
    <View style={[styles.opt, !last && styles.optDivider]}>
      <View style={[styles.skel, { width: 22, height: 22, borderRadius: 7 }]} />
      <View style={[styles.skel, { width: 4, height: 28, borderRadius: 2 }]} />
      <View style={{ gap: 6 }}>
        <View style={[styles.skel, { width: 96, height: 9 }]} />
        <View style={[styles.skel, { width: 150, height: 7 }]} />
      </View>
    </View>
  );
  return (
    <View testID="picker-loading">
      <View style={styles.groupHead}>
        <AppText style={styles.groupLabel}>Google</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Spinner size={12} />
          <AppText style={styles.hint}>Loading</AppText>
        </View>
      </View>
      <View style={styles.card}>{row(false)}{row(true)}</View>
    </View>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Icon name="globe" size={22} color={text(0.7)} strokeWidth={1.6} /></View>
      <AppText style={styles.emptyTitle}>{title}</AppText>
      <AppText style={styles.emptyBody}>{body}</AppText>
      <View style={{ alignSelf: 'stretch', marginTop: 22 }}>{action}</View>
    </View>
  );
}

function Pill({ label, onPress, primary, google, phone, disabled }: { label: string; onPress: () => void; primary?: boolean; google?: boolean; phone?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.pill, primary ? { backgroundColor: '#f3efe8' } : { backgroundColor: white(0.08) }, disabled && { opacity: 0.5 }]}
    >
      {google ? <Icon name="google" size={16} color="#171615" strokeWidth={0} /> : null}
      {phone ? <Icon name="phone" size={15} color={text(0.85)} strokeWidth={1.8} /> : null}
      <AppText style={[styles.pillTxt, { color: primary ? SURFACE.bg : text(0.9) }]}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,9,9,0.55)', alignItems: 'center' },
  panel: {
    width: '100%', maxWidth: 480, backgroundColor: SURFACE.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderTopColor: white(0.09), overflow: 'hidden',
  },
  head: { paddingTop: 8, paddingHorizontal: 18, paddingBottom: 14 },
  grab: { width: 34, height: 4, borderRadius: 3, backgroundColor: white(0.16), alignSelf: 'center', marginBottom: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, lineHeight: 22 },
  subtitle: { fontSize: 12.5, lineHeight: 16, color: text(0.5), marginTop: 2 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.06) },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 99, borderWidth: 1, borderColor: white(0.14) },
  offlineTxt: { fontSize: 11, color: text(0.7) },
  scroll: { flexShrink: 1 },
  privNote: { fontSize: 12.5, lineHeight: 18, color: text(0.5), marginTop: 14 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, marginBottom: 8, minHeight: 28 },
  groupLabel: { flex: 1, fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34) },
  groupEmail: { textTransform: 'none', letterSpacing: 0.1, fontSize: 11.5, color: text(0.5) },
  manage: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: white(0.06) },
  manageTxt: { fontSize: 11.5, color: text(0.55) },
  card: { borderRadius: 14, backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.08), overflow: 'hidden' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 46, paddingRight: 12 },
  optDivider: { borderBottomWidth: 1, borderBottomColor: white(0.07) },
  optMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: 12, minHeight: 46 },
  bar: { width: 4, height: 28, borderRadius: 2 },
  optName: { fontSize: 14, lineHeight: 17, fontWeight: '500', letterSpacing: -0.1 },
  optSub: { fontSize: 11.5, lineHeight: 15, color: text(0.45) },
  hint: { fontSize: 12, lineHeight: 17, color: text(0.4) },
  skel: { backgroundColor: white(0.07), borderRadius: 5 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: white(0.07), backgroundColor: SURFACE.sheet },
  footTitle: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  footSub: { fontSize: 11.5, lineHeight: 15, color: text(0.45) },
  doneBtn: { minWidth: 112, minHeight: 46, paddingHorizontal: 24, borderRadius: 12, backgroundColor: '#f3efe8', alignItems: 'center', justifyContent: 'center' },
  doneTxt: { fontSize: 14.5, fontWeight: '500', color: SURFACE.bg },
  empty: { alignItems: 'center', paddingTop: 30, paddingBottom: 10 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: white(0.06), alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: '600', marginTop: 16, letterSpacing: -0.1 },
  emptyBody: { fontSize: 13, lineHeight: 19, color: text(0.5), textAlign: 'center', marginTop: 6, maxWidth: 270 },
  notice: { fontSize: 12, lineHeight: 17, color: DANGER_SOFT, textAlign: 'center' },
  pill: { minHeight: 46, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  pillTxt: { fontSize: 14, fontWeight: '500' },
});
