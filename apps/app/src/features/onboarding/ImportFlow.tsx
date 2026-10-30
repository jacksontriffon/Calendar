/**
 * Import from the web app (OA 3). After sign-in the app asks the server to
 * copy the old web calendar (`legacy-import`). Most accounts have none, and
 * for them this screen shows nothing at all: the call returns `{status:'none'}`
 * and the user moves straight on. The "Bringing over your calendar…" screen
 * only appears if the call takes longer than a moment.
 *
 * Runs once per user: the result is recorded in `profiles.prefs.legacyImport`.
 */
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useSession } from '@/features/auth/session';
import {
  AppText,
  Body,
  Button,
  Caption,
  Card,
  Footer,
  Hero,
  InlineError,
  OfflinePill,
  Page,
  ProgressBar,
  TextButton,
  Title,
  ui,
} from '@/features/auth/ui';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { detectTimeZone } from '@/lib/tz';
import { useOnline } from '@/lib/useOnline';

import { failureDetail, parseLegacyImport, summarizeCounts, type ImportCounts } from './legacyImport';

type Phase = 'running' | 'waiting' | 'done' | 'error';

/** How long the call may take before the "Bringing over…" screen replaces the blank one. */
const SHOW_AFTER_MS = 700;

interface Failure {
  ref?: string;
  stage?: string;
}

/** The function's JSON error body (`{ref, stage}`), if it sent one. */
async function readErrorBody(error: unknown): Promise<Failure> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as Record<string, unknown>;
      return {
        ref: typeof body.ref === 'string' ? body.ref : undefined,
        stage: typeof body.stage === 'string' ? body.stage : undefined,
      };
    } catch {
      return {};
    }
  }
  return {};
}

export function ImportFlow() {
  const { profile, saveEntryPrefs, saveProfile } = useSession();
  const online = useOnline();

  const [phase, setPhase] = useState<Phase>('running');
  const [visible, setVisible] = useState(false);
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [lastSaved, setLastSaved] = useState<string | undefined>();
  const [failure, setFailure] = useState<Failure>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const { data, error } = await supabase.functions.invoke('legacy-import');
      if (error) {
        if (error instanceof FunctionsFetchError) {
          // No connection: wait and resume on its own (OA 3.5), rather than error.
          setPhase('waiting');
          return;
        }
        setFailure(await readErrorBody(error));
        setPhase('error');
        return;
      }
      const outcome = parseLegacyImport(data);
      if (outcome.kind === 'none') {
        try {
          await saveEntryPrefs({ legacyImport: { status: 'none', at: new Date().toISOString() } });
          // The gate moves on by itself (setup, or the calendar).
        } catch {
          setSaveError(true);
          setPhase('error');
        }
        return;
      }
      if (outcome.kind === 'error') {
        setFailure({ ref: outcome.ref, stage: outcome.stage });
        setPhase('error');
        return;
      }
      setCounts(outcome.counts);
      setLastSaved(outcome.lastSaved);
      setPhase('done');
    } catch {
      setPhase('waiting');
    } finally {
      running.current = false;
    }
  }, [saveEntryPrefs]);

  useEffect(() => {
    const id = setTimeout(() => void run(), 0);
    return () => clearTimeout(id);
  }, [run]);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  // Paused offline: pick up again when the connection returns, and probe every
  // few seconds in case the platform can't report connectivity.
  const resume = useCallback(() => {
    setPhase('running');
    void run();
  }, [run]);
  const prevOnline = useRef(online);
  useEffect(() => {
    const cameBack = online && !prevOnline.current;
    prevOnline.current = online;
    if (phase !== 'waiting') return;
    if (cameBack) {
      resume();
      return;
    }
    const t = setTimeout(resume, 5000);
    return () => clearTimeout(t);
  }, [phase, online, resume]);

  const finishImported = async () => {
    setBusy(true);
    setSaveError(false);
    try {
      // Returning users skip setup: name and time zone come with the data.
      await saveEntryPrefs({
        legacyImport: { status: 'imported', at: new Date().toISOString(), counts: counts ? { ...counts } : undefined },
        onboarded: true,
      });
      if (profile?.tz === 'UTC') {
        const tz = detectTimeZone();
        if (tz !== 'UTC') await saveProfile({ tz }).catch(() => undefined);
      }
    } catch {
      setSaveError(true);
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await saveEntryPrefs({ legacyImport: { status: 'skipped', at: new Date().toISOString() } });
    } catch {
      setSaveError(true);
      setBusy(false);
    }
  };

  const retry = () => {
    setFailure({});
    setSaveError(false);
    resume();
  };

  // Silent while it is quick, and always silent for accounts with nothing to import.
  if (!visible && phase === 'running') return <Page>{null}</Page>;

  if (phase === 'done' && counts) {
    return (
      <Page>
        <View style={styles.center}>
          <Hero icon="check" tone="solid" />
          <Title size={24} align="center">
            You’re all set
          </Title>
          <Body align="center" style={{ marginTop: 8 }}>
            {summarizeCounts(counts)}
          </Body>
          <View style={styles.stats}>
            <Stat n={counts.events} label="events" />
            <View style={styles.statDivider} />
            <Stat n={counts.goals} label="goals" />
            <View style={styles.statDivider} />
            <Stat n={counts.categories} label="categories" />
          </View>
          <Caption align="center" style={{ marginTop: 14 }}>
            {lastSaved ? `Last saved on the web ${lastSaved}. ` : ''}Your web History stays in that browser.
          </Caption>
          {saveError ? (
            <View style={{ marginTop: 16 }}>
              <InlineError>Couldn’t save that. Check your connection and try again.</InlineError>
            </View>
          ) : null}
        </View>
        <Footer>
          <Button label="Open my calendar" testID="import-open" onPress={() => void finishImported()} loading={busy} />
        </Footer>
      </Page>
    );
  }

  if (phase === 'error') {
    return (
      <Page>
        <View style={styles.center}>
          <Hero icon="warning" tone="danger" />
          <Title size={24} align="center">
            Couldn’t bring your calendar over
          </Title>
          <Body align="center" style={{ marginTop: 8 }}>
            {saveError ? 'Check your connection and try again.' : failureDetail(failure.stage)}
          </Body>
          {failure.ref ? (
            <Caption align="center" style={{ marginTop: 14 }}>
              IMP · ref {failure.ref}
            </Caption>
          ) : null}
        </View>
        <Footer>
          <Button label="Try again" testID="import-retry" onPress={retry} />
          <Button
            label="Contact support"
            variant="ghost"
            onPress={() =>
              void Linking.openURL(
                `mailto:${env.supportEmail}?subject=${encodeURIComponent('Calendar import problem')}${failure.ref ? `&body=${encodeURIComponent(`Reference: ${failure.ref}`)}` : ''}`,
              )
            }
          />
          <View style={{ alignItems: 'center' }}>
            <TextButton label="Not now · retry later in Settings › Connected accounts" testID="import-skip" onPress={() => void skip()} size={12} color="rgba(243,239,232,0.4)" />
          </View>
        </Footer>
      </Page>
    );
  }

  const waiting = phase === 'waiting';
  return (
    <Page>
      <View style={styles.center}>
        <Hero icon="download" />
        <Title size={24} align="center">
          Bringing over your calendar…
        </Title>
        <Body align="center" style={{ marginTop: 8 }}>
          {waiting ? 'Paused until you’re back online.' : 'This only happens once. Keep the app open.'}
        </Body>
        <View style={{ marginTop: 28 }}>
          <ProgressBar />
        </View>
        <View style={styles.progressLabel}>
          <AppText size={11.5} color="rgba(243,239,232,0.4)">
            {waiting ? 'Waiting for a connection' : 'Copying from your web calendar'}
          </AppText>
        </View>
        <View style={{ marginTop: 22 }}>
          <Card>
            {['Events', 'Goals', 'Categories', 'Settings'].map((label) => (
              <View key={label} style={styles.pendingRow}>
                <View style={styles.pendingDot} />
                <AppText size={14.5} color="rgba(243,239,232,0.4)" style={{ flex: 1 }}>
                  {label}
                </AppText>
              </View>
            ))}
          </Card>
        </View>
        <Caption align="center" style={{ marginTop: 14 }}>
          Your web calendar isn’t changed.
        </Caption>
      </View>
      {waiting ? (
        <Footer>
          <OfflinePill label="Offline · import will resume" />
        </Footer>
      ) : null}
    </Page>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <AppText size={30} lineHeight={34} weight={600} letterSpacing={-0.6} color={ui.heading} align="center">
        {n}
      </AppText>
      <AppText size={12} color="rgba(243,239,232,0.5)" align="center" style={{ marginTop: 2 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 22 },
  progressLabel: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 12 },
  pendingDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)' },
  stats: { flexDirection: 'row', marginTop: 28, borderRadius: 16, overflow: 'hidden', backgroundColor: ui.card },
  stat: { flex: 1, paddingVertical: 16, paddingHorizontal: 6 },
  statDivider: { width: 1, backgroundColor: ui.hairline },
});
