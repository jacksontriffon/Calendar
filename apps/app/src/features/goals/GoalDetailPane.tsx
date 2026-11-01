import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  DANGER, PICKER, adjustModeFor, goalRate, goalStats, leftShortLabel, niceDate, paceOf, paint, snapHue, text, white,
  type NowCtx, type ProtoGoal,
} from '@calendar/core';

import { AppInput, AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useCalendarData } from '@/store';
import { PacePill } from './PacePill';
import { goalLines, parseDeadline, splitDeadline, type GoalDraft } from './model';

interface Props {
  /** the stored goal with the draft applied, so the numbers follow the edits */
  view: ProtoGoal;
  draft: GoalDraft;
  ctx: NowCtx;
  onDraft: (p: Partial<GoalDraft>) => void;
  onDelete: () => void;
  onAdjust: (mode: 'reduce' | 'stretch') => void;
}

/** Goal detail, drilled into the goals sheet under the filtered graph: identity row, progress and the scope button. */
export function GoalDetailPane({ view, draft, ctx, onDraft, onDelete, onAdjust }: Props) {
  const data = useCalendarData();
  const [dateEdit, setDateEdit] = useState<{ d: string; m: string; y: string } | null>(null);
  const [hueOpen, setHueOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  const P = paint(view.hue);
  const s = goalStats(view, data.events, ctx);
  const pace = paceOf(view, data.events, ctx);
  const L = goalLines(view, s, ctx.today);
  const cur = snapHue(draft.hue);
  const hasTarget = !!view.hours;
  const exp = hasTarget ? Math.min(1, s.expected / view.hours) : 0;
  const adjMode = adjustModeFor(s.delta, goalRate(view, ctx.today).target, s.active);

  const commitDate = (f: { d: string; m: string; y: string }) => {
    const k = parseDeadline(f.d, f.m, f.y, ctx.today);
    if (k) onDraft({ deadline: k });
    setDateEdit(null);
  };

  return (
    <View style={styles.pane}>
      {menu ? <Pressable style={styles.menuScrim} onPress={() => setMenu(false)} accessibilityLabel="Close menu" /> : null}
      <View style={styles.head}>
        <Pressable
          onPress={() => setHueOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel="Change colour"
          style={[styles.swatch, { backgroundColor: P.edge }, hueOpen && styles.swatchOn]}
        />
        <View style={styles.names}>
          <AppInput
            value={draft.title}
            onChangeText={(v) => onDraft({ title: v })}
            placeholder="Goal name"
            style={styles.title}
            accessibilityLabel="Goal name"
          />
          <AppInput
            value={draft.outcome}
            onChangeText={(v) => onDraft({ outcome: v })}
            placeholder="Add the result you're after"
            multiline
            style={styles.outcome}
            accessibilityLabel="Outcome"
          />
        </View>
        <View style={styles.tools}>
          {dateEdit ? (
            <View style={styles.dateEdit}>
              {(['d', 'm', 'y'] as const).map((k, i) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <AppInput
                    autoFocus={i === 0}
                    value={dateEdit[k]}
                    onChangeText={(v) => setDateEdit({ ...dateEdit, [k]: v.replace(/\D/g, '').slice(0, k === 'y' ? 4 : 2) })}
                    onSubmitEditing={() => commitDate(dateEdit)}
                    onBlur={() => { if (k === 'y') commitDate(dateEdit); }}
                    keyboardType="number-pad"
                    style={[styles.dateField, { width: k === 'y' ? 40 : 24 }]}
                    placeholder={k === 'd' ? 'DD' : k === 'm' ? 'MM' : 'YYYY'}
                    accessibilityLabel={'Deadline ' + (k === 'd' ? 'day' : k === 'm' ? 'month' : 'year')}
                  />
                  {k !== 'y' ? <AppText style={{ color: text(0.3) }}>/</AppText> : null}
                </View>
              ))}
            </View>
          ) : (
            <Pressable
              onPress={() => setDateEdit(splitDeadline(draft.deadline))}
              accessibilityRole="button"
              accessibilityLabel="Change deadline date"
              style={({ pressed }) => [styles.dateChip, pressed && { backgroundColor: white(0.05) }]}
            >
              <AppText style={styles.dateTxt}>{draft.deadline ? 'by ' + niceDate(draft.deadline) : 'Set a date'}</AppText>
            </Pressable>
          )}
          <View style={styles.menuWrap}>
            <Pressable
              onPress={() => setMenu((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel="More options"
              accessibilityState={{ expanded: menu }}
              style={({ pressed }) => [styles.more, pressed && { backgroundColor: white(0.06) }]}
            >
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Circle cx={12} cy={5} r={1.8} fill={text(0.55)} />
                <Circle cx={12} cy={12} r={1.8} fill={text(0.55)} />
                <Circle cx={12} cy={19} r={1.8} fill={text(0.55)} />
              </Svg>
            </Pressable>
            {menu ? (
              <View style={styles.menu} accessibilityRole="menu">
                <Pressable
                  onPress={() => { setMenu(false); onDelete(); }}
                  accessibilityRole="menuitem"
                  testID="goal-delete"
                  style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: 'rgba(255,90,75,0.12)' }]}
                >
                  <Icon name="trash" size={14} color={DANGER} strokeWidth={2} />
                  <AppText style={styles.menuTxt}>Delete goal</AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {hueOpen ? (
        <View style={styles.swatches}>
          {PICKER.map((h, i) => (
            <Pressable
              key={h}
              onPress={() => onDraft({ hue: h })}
              accessibilityRole="button"
              accessibilityLabel={'Colour ' + (i + 1)}
              style={[styles.dot, { backgroundColor: paint(h).edge }, cur === h && styles.dotOn]}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.progress}>
        <View style={styles.doneRow}>
          <View style={styles.doneLeft}>
            <AppText style={styles.done}>{L.done}</AppText>
            <AppText style={styles.of}>of</AppText>
            <AppInput
              value={draft.hours}
              onChangeText={(v) => onDraft({ hours: v.replace(/[^\d.]/g, '') })}
              keyboardType="decimal-pad"
              style={[styles.hours, { width: Math.max(26, draft.hours.length * 8 + 10) }]}
              accessibilityLabel="Target hours"
            />
            <AppText style={styles.of}>hours</AppText>
          </View>
          <AppText style={styles.pct}>{hasTarget ? Math.round(s.pct * 100) + '%' : '—'}</AppText>
        </View>
        <View style={styles.track}>
          {hasTarget && s.active ? <View style={[styles.mark, { width: `${exp * 100}%` }]} /> : null}
          <View style={[styles.fill, { width: `${s.pct * 100}%`, backgroundColor: P.edge, minWidth: s.pct > 0 ? 8 : 0 }]} />
        </View>
        <View style={styles.paceRow}>
          <PacePill pace={pace} />
          {L.expected ? <AppText style={styles.muted}>{L.expected}</AppText> : null}
          <AppText style={[styles.muted, { marginLeft: 'auto' }]}>{leftShortLabel(s, ctx.today)}</AppText>
        </View>
      </View>

      {adjMode ? (
        <Pressable
          onPress={() => onAdjust(adjMode)}
          accessibilityRole="button"
          testID="goal-adjust"
          style={({ pressed }) => [styles.adjust, pressed && { backgroundColor: white(0.05), transform: [{ scale: 0.99 }] }]}
        >
          <AppText style={styles.adjustTxt}>{adjMode === 'reduce' ? 'Reduce scope' : 'Add stretch goal'}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { gap: 14, paddingTop: 6, paddingHorizontal: 2, paddingBottom: 4 },
  menuScrim: { position: 'absolute', left: -20, right: -20, top: -20, bottom: -20, zIndex: 80 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, zIndex: 81 },
  swatch: { width: 10, minHeight: 38, alignSelf: 'stretch', borderRadius: 5, marginVertical: 2 },
  swatchOn: { borderWidth: 3, borderColor: white(0.16) },
  names: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 17, fontWeight: '650' as never, letterSpacing: -0.3, color: '#f6f2ec', paddingVertical: 2 },
  outcome: { fontSize: 13, lineHeight: 18, color: text(0.62), paddingVertical: 2 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  dateChip: { height: 30, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: white(0.1) },
  dateTxt: { fontSize: 13, fontWeight: '550' as never, color: text(0.55) },
  dateEdit: {
    height: 30, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 9, borderWidth: 1,
    borderColor: white(0.22), backgroundColor: white(0.06),
  },
  dateField: { fontSize: 13, fontWeight: '550' as never, textAlign: 'center', fontVariant: ['tabular-nums'] },
  menuWrap: { position: 'relative' },
  more: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  menu: {
    position: 'absolute', top: 34, right: 0, minWidth: 150, padding: 5, borderRadius: 12, backgroundColor: '#2a2725',
    borderWidth: 1, borderColor: white(0.09), elevation: 8, zIndex: 82,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  menuTxt: { fontSize: 13, fontWeight: '550' as never, color: '#ff6b5e' },
  swatches: { flexDirection: 'row', gap: 7 },
  dot: { flex: 1, maxWidth: 24, aspectRatio: 1, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  dotOn: { borderColor: 'rgba(243,239,232,0.85)' },
  progress: { gap: 9, paddingHorizontal: 2 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  doneLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  done: { fontSize: 24, lineHeight: 28, fontWeight: '650' as never, letterSpacing: -0.5, color: '#f6f2ec', fontVariant: ['tabular-nums'] },
  of: { fontSize: 13, color: text(0.5) },
  hours: { fontSize: 13, fontWeight: '600', color: '#f3efe8', paddingHorizontal: 3, borderRadius: 6, fontVariant: ['tabular-nums'] },
  pct: { fontSize: 15, fontWeight: '650' as never, letterSpacing: -0.2, color: '#f3efe8', fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: white(0.08), overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  mark: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: white(0.1) },
  paceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  muted: { fontSize: 12, color: text(0.45) },
  adjust: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: white(0.09) },
  adjustTxt: { fontSize: 13, fontWeight: '540' as never, color: text(0.62) },
});
