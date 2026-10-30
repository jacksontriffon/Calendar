import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { text, white, type Visibility } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { showToast } from '@/components/toast';
import { getCalendarsStore, useCategoryDefaults, useGoogleAccounts } from '../calendars/data';
import { publishableCalendars } from '../calendars/view';
import { SectionLabel, VisibilitySegments } from './parts';

/**
 * Default visibility of a category (EV 06): "New events in this category are" Private or Public, and for
 * Public the Google calendars they go to (`categories.default_visibility` / `default_targets`). It applies to
 * new events only: changing an event's category later doesn't change its visibility, and a calendar that is
 * disconnected drops off the default (a database trigger). Phone calendars can't be defaults.
 */
export function CategoryDefault({ name, eventCount }: { name: string; eventCount: number }) {
  const d = useCategoryDefaults(name);
  const { views } = useGoogleAccounts();
  const [want, setWant] = useState<Visibility | null>(null);
  const [adding, setAdding] = useState(false);
  if (!d) return null;

  const groups = publishableCalendars(views);
  const all = groups.flatMap((g) => g.calendars.map((c) => ({ c, email: g.account.email })));
  const shown: Visibility = want ?? d.visibility;
  const picked = d.targets.map((id) => all.find((x) => x.c.id === id)).filter((x): x is (typeof all)[number] => !!x);
  const free = all.filter((x) => !d.targets.includes(x.c.id));

  const save = (patch: { default_visibility?: Visibility; default_targets?: string[] }) => {
    getCalendarsStore().setCategoryDefault(d.id, patch).catch(() => showToast({ label: 'Couldn’t save that change.' }));
  };

  const setVis = (v: Visibility) => {
    if (v === 'private') {
      setWant(null);
      setAdding(false);
      save({ default_visibility: 'private' });
      return;
    }
    if (d.targets.length) {
      setWant(null);
      save({ default_visibility: 'public' });
    } else {
      // Public needs somewhere to go: wait for a calendar before saving
      setWant('public');
      setAdding(true);
    }
  };

  const add = (id: string) => {
    setAdding(false);
    setWant(null);
    save({ default_visibility: 'public', default_targets: [...d.targets, id] });
  };
  const remove = (id: string) => {
    const next = d.targets.filter((x) => x !== id);
    save(next.length ? { default_targets: next } : { default_targets: next, default_visibility: 'private' });
  };

  return (
    <View style={styles.box} testID="category-default">
      <SectionLabel>New events in this category are</SectionLabel>
      <View style={{ marginTop: 8 }}>
        <VisibilitySegments value={shown} onChange={setVis} />
      </View>
      {shown === 'public' ? (
        <View style={{ marginTop: 12 }}>
          <SectionLabel>Public on</SectionLabel>
          <View style={styles.chips}>
            {picked.map(({ c, email }) => (
              <View key={c.id} style={styles.chip}>
                <AppText style={styles.chipTxt} numberOfLines={1}>Google {'·'} {c.name}</AppText>
                <Pressable onPress={() => remove(c.id)} accessibilityRole="button" accessibilityLabel={'Remove ' + c.name + ' from ' + email} hitSlop={6}>
                  <AppText style={styles.chipX}>{'×'}</AppText>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setAdding((a) => !a)} accessibilityRole="button" style={styles.add} disabled={!free.length}>
              <AppText style={[styles.chipTxt, { color: text(free.length ? 0.55 : 0.25) }]}>+ Add</AppText>
            </Pressable>
          </View>
          {adding && free.length ? (
            <View style={styles.pick}>
              {free.map(({ c, email }) => (
                <Pressable key={c.id} onPress={() => add(c.id)} accessibilityRole="button" style={styles.pickRow}>
                  <AppText style={{ fontSize: 13 }} numberOfLines={1}>{c.name}</AppText>
                  <AppText style={{ fontSize: 11.5, color: text(0.4) }} numberOfLines={1}>{email}</AppText>
                </Pressable>
              ))}
            </View>
          ) : null}
          {!all.length ? <AppText style={styles.note}>Connect Google and turn on Can publish to for a calendar to use it here.</AppText> : null}
        </View>
      ) : null}
      <AppText style={styles.note}>
        Applies to new events only. The {eventCount} {name} {eventCount === 1 ? 'event' : 'events'} you have now don{'’'}t change, and you can change any event later.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: white(0.07) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 9,
    backgroundColor: 'rgba(207,123,88,0.14)', borderWidth: 1, borderColor: 'rgba(207,123,88,0.4)', maxWidth: '100%',
  },
  chipTxt: { fontSize: 12, color: text(0.85) },
  chipX: { fontSize: 14, color: text(0.6) },
  add: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderStyle: 'dashed', borderColor: white(0.2) },
  pick: { marginTop: 8, borderRadius: 11, backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.08), overflow: 'hidden' },
  pickRow: { paddingVertical: 10, paddingHorizontal: 12, gap: 1, borderBottomWidth: 1, borderBottomColor: white(0.06) },
  note: { fontSize: 11.5, lineHeight: 16, color: text(0.38), marginTop: 12 },
});
