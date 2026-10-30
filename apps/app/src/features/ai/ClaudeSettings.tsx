import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { ACCENT, DANGER, MODELS, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { useOnline } from '@/lib/useOnline';
import { getStore, usePrefs } from '@/store';
import { useNow } from '../calendar/useNow';
import { runCheckInNow } from '../checkin/CheckInHost';
import { currentUsage, describeUsage, modelLabel, useUsageState } from './usage';
import { refreshUsage } from './usageRemote';

/**
 * Settings, "Claude parsing" (Design Spec OA 06). The server holds the Anthropic key and picks the
 * model, so there is no key, proxy or model picker: the app shows which model answered, the
 * on/off switch, the ask and check-in toggles and this month's usage.
 */
export function ClaudeSettings() {
  const prefs = usePrefs();
  const ai = prefs.ai;
  const online = useOnline();
  const now = useNow();
  const u = useUsageState();

  useEffect(() => {
    void refreshUsage();
  }, []);

  const usage = currentUsage(u.usage, now.todayKey);
  const view = describeUsage({ on: ai.on, online, usage, model: u.model });
  const name = modelLabel(u.model);
  const desc = (MODELS.find((m) => m.id && u.model?.startsWith(m.id)) ?? MODELS[0]).desc;
  const skeleton = u.loading && !u.usage;
  const limit = view.status === 'limit';

  const setAi = (patch: Partial<typeof ai>) => getStore().setPrefs({ ai: { ...ai, ...patch } });

  return (
    <View style={styles.root} testID="claude-settings">
      <View style={styles.head}>
        <AppText style={styles.label} accessibilityRole="header">Claude parsing</AppText>
        <Switch
          value={ai.on}
          onValueChange={(v) => setAi({ on: v, model: v ? (ai.model === 'offline' ? 'haiku' : ai.model) : 'offline' })}
          trackColor={{ false: white(0.12), true: ACCENT }}
          thumbColor={ai.on ? '#17120f' : text(0.65)}
          accessibilityLabel="Claude parsing"
          testID="claude-switch"
        />
      </View>
      <AppText style={styles.status} testID="claude-status">{view.headline}</AppText>

      <View style={[styles.card, styles.modelRow, !ai.on && styles.dim]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText style={styles.cardTitle}>Model</AppText>
          <AppText style={styles.cardSub}>{desc}</AppText>
        </View>
        <AppText style={styles.modelName} testID="claude-model">{name}</AppText>
      </View>

      <View style={styles.usage} testID="claude-usage">
        {skeleton ? (
          <>
            <View style={[styles.bone, { width: '46%', height: 13 }]} />
            <View style={styles.bar} />
            <View style={[styles.bone, { width: '78%', height: 10 }]} />
          </>
        ) : (
          <>
            <View style={styles.usageTop}>
              <AppText style={styles.usageLabel}>
                Notes this month: <AppText style={[styles.usageNum, limit && { color: DANGER }]}>{view.count}</AppText>
              </AppText>
              <AppText style={styles.usageDetail}>{view.detail}</AppText>
            </View>
            {view.percent != null ? (
              <View style={styles.bar}>
                <View style={[styles.fill, { width: `${view.percent}%`, backgroundColor: limit ? DANGER : ACCENT }]} />
              </View>
            ) : null}
            <AppText style={styles.small}>{view.note}</AppText>
          </>
        )}
      </View>

      <ToggleRow
        title="Ask before scheduling"
        value={ai.on && ai.ask}
        disabled={!ai.on}
        onChange={(v) => setAi({ ask: v })}
      />
      <AppText style={[styles.small, !ai.on && styles.dim]}>
        {ai.on
          ? name + ' asks up to two multiple-choice questions when the day, the event it should change, or a clash is genuinely unclear.'
          : 'The offline parser never asks — it always makes its own call.'}
      </AppText>

      <ToggleRow
        title="Check in when I return"
        value={ai.checkin}
        onChange={(v) => setAi({ checkin: v })}
        extra={(
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/');
              setTimeout(runCheckInNow, 320);
            }}
            accessibilityRole="button"
            style={styles.runNow}
            testID="checkin-run-now"
          >
            <AppText style={styles.runNowTxt}>Run now</AppText>
          </Pressable>
        )}
      />
      <AppText style={styles.small}>
        After a few hours away, opening the calendar onto an empty stretch starts a short check-in. Close it with the {'×'} and it waits before asking again.
      </AppText>

      <View style={[styles.skills]}>
        <AppText style={styles.rowTitle}>Skills</AppText>
      </View>
      <AppText style={styles.small}>Scheduler, goal-adjust, check-in and verifier skills run on our servers. Nothing to set up.</AppText>
    </View>
  );
}

function ToggleRow({ title, value, onChange, disabled, extra }: {
  title: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; extra?: ReactNode;
}) {
  return (
    <View style={[styles.toggle, disabled && styles.dim]}>
      <View style={styles.toggleLeft}>
        <AppText style={styles.rowTitle}>{title}</AppText>
        {extra}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: white(0.12), true: ACCENT }}
        thumbColor={value ? '#17120f' : text(0.65)}
        accessibilityLabel={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginHorizontal: 20, marginTop: 24, gap: 9 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34) },
  status: { fontSize: 11.5, lineHeight: 16, color: text(0.4) },
  card: { paddingVertical: 13, paddingHorizontal: 15, borderRadius: 16, backgroundColor: white(0.045), marginTop: 4 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 13.5, color: text(0.62) },
  cardSub: { fontSize: 11.5, lineHeight: 16, color: text(0.4) },
  modelName: { fontSize: 13.5, fontWeight: '600', color: '#f3efe8' },
  usage: { marginTop: 2, padding: 13, paddingTop: 12, borderRadius: 12, backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.08), gap: 9 },
  usageTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  usageLabel: { fontSize: 13, fontWeight: '500', color: '#f3efe8', flexShrink: 1 },
  usageNum: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  usageDetail: { fontSize: 11.5, color: text(0.4), textAlign: 'right', flexShrink: 1 },
  bar: { height: 4, borderRadius: 2, backgroundColor: white(0.08), overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  bone: { borderRadius: 4, backgroundColor: white(0.08) },
  small: { fontSize: 11, lineHeight: 16, color: text(0.33) },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  rowTitle: { fontSize: 13, color: text(0.6), fontWeight: '500' },
  runNow: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: white(0.06) },
  runNowTxt: { fontSize: 11, color: text(0.55) },
  skills: { marginTop: 8 },
  dim: { opacity: 0.5 },
});
