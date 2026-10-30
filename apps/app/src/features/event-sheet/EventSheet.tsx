import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import {
  PICKER, SURFACE, addCat, deleteCat, deleteEvent, fmtDur, hm, hueFor, key, minsIn, paint, renameCat, text, white, workedMins,
  DANGER, ACCENT, dnum, type CalendarData, type ProtoEvent,
} from '@calendar/core';

import { AppInput, AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Sheet, useSheetClose } from '@/components/Sheet';
import { getStore, useCalendarData, useSeries } from '@/store';
import { removeSomeoneElsesEvent } from '../calendars/actions';
import { useGoogleEventMeta, useGoogleAccounts } from '../calendars/data';
import { calendarColor } from '../calendars/view';
import { initials } from '@/features/auth/initials';
import { CategoryDefault } from '../visibility/CategoryDefault';
import { persistChoice } from '../visibility/persist';
import { VisibilityRow } from '../visibility/VisibilityRow';
import type { PickerState } from '../visibility/state';
import { commitUndoable } from '../history/commit';
import { startTimer, useTimer } from '../timer/store';
import {
  allDayLabel, allDayRange, applyDraft, commitDraft, dayName, emptyDraft, isDirty, repeatLabel, retimePatch, seriesCount,
  sheetLabel, timeText, type Draft,
} from './model';

/** The event sheet route body: a bottom sheet over the calendar. */
export function EventSheet({ id }: { id: string }) {
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return (
    <Sheet onClosed={goBack} testID="event-sheet">
      <SheetBody id={id} />
    </Sheet>
  );
}

function SheetBody({ id }: { id: string }) {
  const close = useSheetClose();
  const data = useCalendarData();
  const [base] = useState<CalendarData>(data);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const settled = useRef(false);
  const targetsRef = useRef<{ before: PickerState; after: PickerState } | null>(null);
  const onTargets = useCallback((after: PickerState, before: PickerState) => {
    targetsRef.current = { before: targetsRef.current?.before ?? before, after };
  }, []);

  const view = useMemo(() => applyDraft(data, id, draft), [data, id, draft]);
  const ev = view.events.find((e) => e.id === id);

  /* commit the session's edits once (close, back button, unmount) */
  const flush = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    const d = draftRef.current;
    const store = getStore();
    const live = store.getState().data;
    if (isDirty(d)) {
      const next = commitDraft(live, id, d);
      commitUndoable(next, sheetLabel(base, applyDraft(live, id, d), id, d), 'edit');
    }
    // targets are saved after the event itself (the RPC needs the event row), even when only they changed
    const t = targetsRef.current;
    if (t) {
      const me = live.events.find((e) => e.id === id);
      const seriesEventIds = me?.seriesId ? live.events.filter((e) => e.seriesId === me.seriesId && e.day > me.day).map((e) => e.id) : [];
      persistChoice({ eventId: id, before: t.before, after: t.after, isSeries: !!me?.seriesId, seriesEventIds });
    }
  }, [id, base]);
  useEffect(() => () => flush(), [flush]);

  const patch = useCallback((p: Partial<ProtoEvent>) => setDraft((d) => ({ ...d, patch: { ...d.patch, ...p } })), []);
  const catOp = useCallback((op: (x: CalendarData) => CalendarData) => setDraft((d) => ({ ...d, catOps: [...d.catOps, op] })), []);

  if (!ev) {
    return (
      <View style={{ paddingVertical: 24 }}>
        <AppText style={{ color: text(0.6) }}>This event no longer exists.</AppText>
      </View>
    );
  }
  if (ev.isMine === false || ev.source === 'google') return <ReadOnly ev={ev} close={close} />;

  return (
    <EditBody
      ev={ev}
      view={view}
      patch={patch}
      catOp={catOp}
      onTargets={onTargets}
      onClose={() => { flush(); close(); }}
      onDelete={() => {
        settled.current = true;
        const live = getStore().getState().data;
        const e = live.events.find((x) => x.id === id);
        commitUndoable(deleteEvent(live, id), 'Deleted · ' + (e ? e.title : 'event'), 'delete');
        close();
      }}
      onTimer={() => { flush(); startTimer(id); close(); }}
    />
  );
}

interface EditProps {
  ev: ProtoEvent;
  view: CalendarData;
  patch: (p: Partial<ProtoEvent>) => void;
  catOp: (op: (x: CalendarData) => CalendarData) => void;
  onTargets: (after: PickerState, before: PickerState) => void;
  onClose: () => void;
  onDelete: () => void;
  onTimer: () => void;
}

function EditBody({ ev, view, patch, catOp, onTargets, onDelete, onTimer }: EditProps) {
  const timer = useTimer();
  const series = useSeries();
  const [startTxt, setStartTxt] = useState(timeText(ev.start));
  const [endTxt, setEndTxt] = useState(timeText(ev.end));
  const [hueOpen, setHueOpen] = useState(false);
  const [editCat, setEditCat] = useState<string | null>(null);
  const [catDraft, setCatDraft] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newDraft, setNewDraft] = useState('');
  const P = paint(hueFor(view.cats, ev.cat ?? ''));
  const names = Object.keys(view.cats);
  const rep = repeatLabel(series, view.events, ev);
  const worked = !ev.allDay && (ev.pauses?.length || (timer.tm && timer.tm.id === ev.id))
    ? fmtDur(workedMins(ev, timer.tm && timer.tm.id === ev.id ? minsIn(ev.day, timer.tmNow) : null, { tm: timer.tm, tmNow: timer.tmNow }))
    : '';

  const onTime = (which: 'start' | 'end', v: string) => {
    if (which === 'start') setStartTxt(v); else setEndTxt(v);
    const p = retimePatch(ev, which, v);
    if (p) patch(p);
  };
  const syncTimes = () => { setStartTxt(timeText(ev.start)); setEndTxt(timeText(ev.end)); };

  const [clock] = useState(() => {
    const n = new Date();
    return { todayK: key(n), nowM: n.getHours() * 60 + n.getMinutes() };
  });
  const { todayK, nowM } = clock;
  const next = view.events.filter((e) => !e.allDay && e.day === todayK && e.start > nowM).sort((a, b) => a.start - b.start)[0];
  const canTime = !ev.allDay && ev.day === todayK && ((ev.start <= nowM && ev.end > nowM) || (!!next && next.id === ev.id));
  const mine = !!timer.tm && timer.tm.id === ev.id;

  const commitCatEdit = (name: string) => {
    const t = catDraft.trim();
    setEditCat(null);
    if (!t || t === name) return;
    catOp((d) => renameCat(d, name, t));
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 640 }}>
      <View style={styles.head}>
        <Pressable
          onPress={() => ev.cat && setHueOpen((o) => !o)}
          accessibilityLabel="Change colour"
          style={[styles.swatch, { backgroundColor: P.edge }, hueOpen && styles.swatchOn]}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <AppInput
            value={ev.title}
            onChangeText={(v) => patch({ title: v })}
            placeholder="Event name"
            multiline
            style={styles.titleInput}
            accessibilityLabel="Event name"
          />
          {ev.allDay ? (
            <View style={styles.allDayRow}>
              <AppText style={styles.meta}>{allDayLabel(ev.days || 1)}</AppText>
              <AppText style={[styles.meta, { color: text(0.34), fontSize: 12 }]}>{allDayRange(ev)}</AppText>
              <Pressable style={styles.spanBtn} accessibilityLabel="One day shorter" onPress={() => patch({ days: Math.max(1, (ev.days || 1) - 1) })}>
                <AppText style={styles.spanTxt}>{'−'}</AppText>
              </Pressable>
              <Pressable style={styles.spanBtn} accessibilityLabel="One day longer" onPress={() => patch({ days: Math.min(60, (ev.days || 1) + 1) })}>
                <AppText style={styles.spanTxt}>+</AppText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.timeRow}>
              <AppInput
                value={startTxt} onChangeText={(v) => onTime('start', v)} onBlur={syncTimes}
                keyboardType="numbers-and-punctuation" placeholder="09:00" style={[styles.time, { width: 44 }]} accessibilityLabel="Start time"
              />
              <AppText style={{ color: text(0.32), fontSize: 12.5 }}>{'–'}</AppText>
              <AppInput
                value={endTxt} onChangeText={(v) => onTime('end', v)} onBlur={syncTimes}
                keyboardType="numbers-and-punctuation" placeholder="10:00" style={[styles.time, { width: 48 }]} accessibilityLabel="End time"
              />
              <AppText style={{ color: text(0.38), fontSize: 12, marginLeft: 3 }}>{dayName(ev)}</AppText>
            </View>
          )}
          {worked ? <AppText style={styles.meta}>Tracked time: {worked}</AppText> : null}
        </View>
        <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete event" style={styles.trash}>
          <Icon name="trash" size={16} color={DANGER} />
        </Pressable>
      </View>

      {ev.allDay ? null : (
        <Pressable
          onPress={() => patch({ done: !ev.done })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!ev.done }}
          style={[styles.doneRow, ev.done && { borderColor: P.line, backgroundColor: P.fill }]}
        >
          <Icon name="check" size={13} color={ev.done ? P.ink : text(0.4)} strokeWidth={2.2} />
          <AppText style={[styles.doneTxt, ev.done && { color: P.ink }]}>{ev.done ? 'Done' : 'Mark done'}</AppText>
        </Pressable>
      )}

      <View style={styles.chips}>
        {names.map((n) => {
          const CP = paint(hueFor(view.cats, n));
          const on = ev.cat === n;
          if (editCat === n) {
            return (
              <View key={n} style={styles.chipEdit}>
                <AppInput
                  autoFocus value={catDraft} onChangeText={setCatDraft} onBlur={() => commitCatEdit(n)}
                  onSubmitEditing={() => commitCatEdit(n)} accessibilityLabel="Rename category" style={{ width: 72, fontSize: 11.5 }}
                />
                <Pressable
                  accessibilityLabel="Delete category"
                  onPress={() => {
                    setEditCat(null);
                    catOp((d) => deleteCat(d, n).data);
                    if (ev.cat === n) patch({ cat: deleteCat(view, n).moveTo });
                  }}
                  style={styles.chipX}
                >
                  <AppText style={{ color: text(0.5), fontSize: 13 }}>{'×'}</AppText>
                </Pressable>
              </View>
            );
          }
          return (
            <Pressable
              key={n}
              onPress={() => {
                if (on) { setEditCat(n); setCatDraft(n); setHueOpen(true); return; }
                patch({ cat: n });
              }}
              style={[styles.chip, on && { backgroundColor: CP.fill, borderColor: CP.line }]}
            >
              <AppText style={[styles.chipTxt, on && { color: CP.ink }]}>{n}</AppText>
            </Pressable>
          );
        })}
        {newOpen ? (
          <View style={[styles.chipEdit, { borderColor: white(0.14) }]}>
            <AppInput
              autoFocus value={newDraft} onChangeText={setNewDraft} placeholder="Category" accessibilityLabel="New category"
              style={{ width: 78, fontSize: 11.5 }}
              onSubmitEditing={() => addNew()}
            />
            <Pressable onPress={() => addNew()} style={[styles.addBtn, !!newDraft.trim() && { backgroundColor: ACCENT }]}>
              <AppText style={{ fontSize: 11.5, fontWeight: '600', color: newDraft.trim() ? '#17150f' : text(0.4) }}>Add</AppText>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => { setNewOpen(true); setNewDraft(''); }} style={styles.chipNew}>
            <AppText style={[styles.chipTxt, { color: text(0.55) }]}>+ Create</AppText>
          </Pressable>
        )}
      </View>

      {hueOpen && ev.cat ? (
        <View style={styles.huePanel}>
          <AppText style={styles.hueLbl}>Colour {'·'} {ev.cat}</AppText>
          <View style={styles.swatches}>
            {PICKER.map((h, i) => {
              const sp = paint(h);
              const on = paint(hueFor(view.cats, ev.cat ?? '')).edge === sp.edge;
              return (
                <Pressable
                  key={h}
                  accessibilityLabel={'Colour ' + (i + 1)}
                  onPress={() => { const c = ev.cat as string; catOp((d) => ({ ...d, cats: { ...d.cats, [c]: h } })); }}
                  style={[styles.dot, { backgroundColor: sp.edge }, on && { borderWidth: 2, borderColor: SURFACE.sheet, outlineColor: sp.edge, shadowColor: sp.edge, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } }]}
                />
              );
            })}
          </View>
          <CategoryDefault name={ev.cat} eventCount={view.events.filter((e) => e.cat === ev.cat).length} />
        </View>
      ) : null}

      {rep ? (
        <View style={styles.rowLine}>
          <AppText style={styles.rowLbl}>Repeats</AppText>
          <AppText style={styles.rowVal}>{rep} {'·'} {seriesCount(view.events, ev)} events</AppText>
        </View>
      ) : null}

      <VisibilityRow
        eventId={ev.id}
        eventTitle={ev.title}
        when={dnum(ev.day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + timeText(ev.start)}
        visibility={ev.visibility ?? 'private'}
        isSeries={!!ev.seriesId}
        onApply={(after, before) => {
          patch({ visibility: after.visibility });
          onTargets(after, before);
        }}
      />

      {canTime ? (
        <Pressable onPress={onTimer} accessibilityRole="button" style={[styles.timerBtn, { backgroundColor: P.fill, borderColor: P.line }]}>
          <Icon name="play" size={12} color={P.ink} />
          <AppText style={{ fontSize: 14, fontWeight: '600', color: P.ink }}>
            {mine ? 'Open timer' : timer.tm ? 'Switch timer to this event' : 'Start timer'}
          </AppText>
        </Pressable>
      ) : null}
    </ScrollView>
  );

  function addNew() {
    const typed = newDraft.trim();
    if (!typed) return;
    const r = Math.random();
    const res = addCat(view, typed, { eventId: ev.id, random: () => r });
    setNewOpen(false);
    setNewDraft('');
    if (!res.name) return;
    catOp((d) => addCat(d, typed, { eventId: null, random: () => r }).data);
    patch({ cat: res.name });
  }
}

/** Copy someone else's event to My calendar as a private app event. */
export function copyToMyCalendar(ev: ProtoEvent): void {
  const store = getStore();
  const d = store.getState().data;
  const copyEv: ProtoEvent = {
    ...ev, id: store.newId(), source: 'app', isMine: true, visibility: 'private', seriesId: null, done: false, at: Date.now(),
  };
  commitUndoable({ ...d, events: d.events.concat([copyEv]) }, 'Copied \u00b7 ' + ev.title, 'edit');
}

/**
 * Someone else's event (EV 05), or any event imported from Google: read-only, with Copy to my calendar and a
 * quiet Remove that hides it in this app only (hidden_items), with an Undo toast.
 */
function ReadOnly({ ev, close }: { ev: ProtoEvent; close: () => void }) {
  const meta = useGoogleEventMeta(ev.id);
  const { calendars } = useGoogleAccounts();
  const cal = meta?.calendarId ? calendars.find((c) => c.id === meta.calendarId) : undefined;
  const color = cal ? calendarColor(cal) : text(0.4);
  const owner = ev.isMine === false ? meta?.organizerEmail ?? null : null;
  const copy = () => {
    copyToMyCalendar(ev);
    close();
  };
  const remove = () => {
    void removeSomeoneElsesEvent(ev);
    close();
  };
  const first = owner ? initials(owner) : null;
  return (
    <View testID="readonly-sheet">
      <View style={styles.head}>
        <View style={[styles.swatch, { backgroundColor: color }]} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText style={styles.titleInput}>{ev.title}</AppText>
          <AppText style={styles.meta}>{hm(ev.start)} {'\u2013'} {hm(ev.end)} {'\u00b7'} {dayName(ev)}</AppText>
        </View>
        <View style={styles.viewOnly}>
          <Icon name="eye" size={12} color={text(0.6)} />
          <AppText style={{ fontSize: 11.5, color: text(0.6) }}>View only</AppText>
        </View>
      </View>
      <View style={styles.ownerCard}>
        {first ? (
          <View style={styles.ownerAvatar}><AppText style={{ fontSize: 13, fontWeight: '700', color: '#171615' }}>{first}</AppText></View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText style={{ fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{owner ?? (ev.isMine === false ? 'Someone else' : 'You')}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
            <AppText style={styles.meta} numberOfLines={1}>On {cal ? cal.name : 'a calendar'} {'\u00b7'} Google</AppText>
          </View>
        </View>
      </View>
      <AppText style={[styles.note, { lineHeight: 17, marginTop: 12 }]}>
        {owner ? 'Only the owner can change this event. ' : 'This event comes from Google and can\u2019t be changed here. '}
        A copy is yours to edit, and stays private until you publish it.
      </AppText>
      <Pressable onPress={copy} accessibilityRole="button" style={[styles.timerBtn, { backgroundColor: '#f3efe8', borderColor: '#f3efe8', marginTop: 14 }]}>
        <Icon name="copy" size={14} color="#171615" />
        <AppText style={{ fontSize: 14, fontWeight: '600', color: '#171615' }}>Copy to my calendar</AppText>
      </Pressable>
      <Pressable onPress={remove} accessibilityRole="button" accessibilityLabel="Remove" style={styles.removeBtn}>
        <AppText style={{ fontSize: 13, color: text(0.7) }}>Remove</AppText>
      </Pressable>
      <AppText style={[styles.note, { textAlign: 'center', marginTop: 0 }]}>Hides it in this app only. The calendar it comes from doesn{'\u2019'}t change.</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  viewOnly: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 99, backgroundColor: white(0.06) },
  ownerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.08) },
  ownerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#c4758a' },
  removeBtn: { alignSelf: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 22, borderRadius: 10, backgroundColor: white(0.06), borderWidth: 1, borderColor: white(0.1) },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 4 },
  swatch: { width: 10, height: 38, borderRadius: 5, marginTop: 2 },
  swatchOn: { shadowColor: '#fff', shadowOpacity: 0.16, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, borderWidth: 3, borderColor: white(0.16) },
  titleInput: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2, color: '#f6f2ec', minHeight: 22 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: 12.5, lineHeight: 17, color: text(0.7), fontVariant: ['tabular-nums'] },
  meta: { fontSize: 12.5, lineHeight: 17, color: text(0.5), fontVariant: ['tabular-nums'] },
  allDayRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  spanBtn: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.06), borderWidth: 1, borderColor: white(0.1) },
  spanTxt: { fontSize: 14, color: text(0.7) },
  trash: {
    width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(232,116,95,0.11)', borderWidth: 1, borderColor: 'rgba(232,116,95,0.24)',
  },
  doneRow: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 9, borderWidth: 1, borderColor: 'transparent', backgroundColor: white(0.05),
  },
  doneTxt: { fontSize: 11.5, color: text(0.55) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 15 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: 'transparent', backgroundColor: white(0.05) },
  chipTxt: { fontSize: 11.5, color: text(0.55) },
  chipEdit: {
    flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingLeft: 9, paddingRight: 3, borderRadius: 9,
    backgroundColor: white(0.06), borderWidth: 1, borderColor: white(0.2),
  },
  chipX: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  chipNew: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderStyle: 'dashed', borderColor: white(0.2) },
  addBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 7, backgroundColor: white(0.07) },
  huePanel: { marginTop: 13, padding: 12, borderRadius: 13, backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.08) },
  hueLbl: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34) },
  swatches: { flexDirection: 'row', gap: 6, marginTop: 10 },
  dot: { flex: 1, maxWidth: 28, aspectRatio: 1, borderRadius: 14 },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  rowLbl: { fontSize: 13, color: text(0.6) },
  rowVal: { fontSize: 12.5, color: text(0.8) },
  seg: { flexDirection: 'row', padding: 2, gap: 2, backgroundColor: white(0.055), borderRadius: 9 },
  segBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 7 },
  segOn: { backgroundColor: white(0.11) },
  segTxt: { fontSize: 11.5, fontWeight: '600', color: text(0.42) },
  note: { fontSize: 11.5, color: text(0.38), marginTop: 6 },
  timerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 13, paddingHorizontal: 16,
    borderRadius: 13, borderWidth: 1,
  },
});
