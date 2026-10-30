/**
 * Welcome / sign-in (OA 1). The intro animation plays once per install
 * (persisted flag) on one Reanimated clock, 0 -> 9700 ms; with reduced motion,
 * or on any later visit, the end state shows at once. Sign-in is required:
 * there is no "Not now". Apple and Google, Google first on Android.
 */
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Easing, useAnimatedReaction, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { ProviderButton } from '@/features/auth/ProviderButton';
import { providerOrder, signInErrorMessage, type AuthProvider } from '@/features/auth/providers';
import { useSession } from '@/features/auth/session';
import { InlineError, OfflinePill } from '@/features/auth/ui';
import { env } from '@/lib/env';
import { fontFamily } from '@/lib/fonts';
import { FLAGS, getFlag, setFlag } from '@/lib/localFlags';
import { useOnline } from '@/lib/useOnline';

import { ArrivingButton, Composer, DayCard, Tagline, ThinkingPill } from './WelcomeScene';
import { T, TOTAL_MS } from './timeline';

type Mode = 'pending' | 'play' | 'static';

/** Decides play vs end-state, and runs the clock. */
function useWelcomeClock() {
  const t = useSharedValue(0);
  const [mode, setMode] = useState<Mode>('pending');
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [played, reduce] = await Promise.all([
        getFlag(FLAGS.welcomePlayed),
        AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      ]);
      if (cancelled) return;
      if (played === '1' || reduce) {
        t.set(TOTAL_MS);
        setLive(true);
        setMode('static');
      } else {
        setMode('play');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (mode !== 'play') return;
    const done = () => void setFlag(FLAGS.welcomePlayed, '1');
    t.set(
      withTiming(TOTAL_MS, { duration: TOTAL_MS, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(done);
      }),
    );
  }, [mode, t]);

  // Buttons are inert until they have arrived.
  useAnimatedReaction(
    () => t.value >= T.buttonsStart,
    (now, prev) => {
      if (now && !prev) scheduleOnRN(setLive, true);
    },
  );

  return { t, mode, live };
}

export function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const { signIn, signingIn } = useSession();
  const { t, mode, live } = useWelcomeClock();
  const [error, setError] = useState<string | null>(null);

  const order = useMemo(() => providerOrder(Platform.OS), []);

  const run = async (provider: AuthProvider) => {
    if (signingIn) return;
    setError(null);
    const result = await signIn(provider);
    if (!result.ok) setError(signInErrorMessage(provider, result.reason));
    // On success the session provider flips and the root layout leaves (auth).
  };

  if (mode === 'pending') return <View style={styles.root} />;

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]} testID="welcome-screen">
      <View
        style={styles.scene}
        accessible={false}
        accessibilityLabel="Animation, plays once: a typed note becomes a scheduled day, then the sign-in buttons appear"
      >
        <Tagline t={t} />

        <View style={styles.cardRegion}>
          <ThinkingPill t={t} />
          <DayCard t={t} />
        </View>

        <View style={styles.slot}>
          <Composer t={t} />
          <View style={styles.buttons} pointerEvents={live ? 'box-none' : 'none'}>
            {!online ? <OfflinePill /> : null}
            {error ? <InlineError testID="welcome-error">{error}</InlineError> : null}
            {order.map((p, i) => (
              <ArrivingButton key={p} t={t} index={i}>
                <ProviderButton
                  provider={p}
                  testID={`welcome-${p}`}
                  busy={signingIn === p}
                  disabled={!online || (signingIn !== null && signingIn !== p)}
                  onPress={() => void run(p)}
                />
              </ArrivingButton>
            ))}
            <ArrivingButton t={t} index={order.length - 1}>
              <Text style={styles.terms}>
                By continuing you agree to the{' '}
                <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(env.termsUrl)}>
                  Terms
                </Text>{' '}
                and{' '}
                <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(env.privacyUrl)}>
                  Privacy Policy
                </Text>
                .
              </Text>
            </ArrivingButton>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#171615' },
  scene: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  cardRegion: { flex: 1, paddingVertical: 20, paddingHorizontal: 22 },
  slot: { height: 214, marginTop: 'auto' },
  buttons: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingBottom: 14, gap: 10 },
  terms: {
    textAlign: 'center',
    fontFamily: fontFamily('serif', 400),
    fontSize: 11.5,
    lineHeight: 16,
    color: 'rgba(243,239,232,0.4)',
    paddingTop: 4,
    paddingHorizontal: 10,
  },
  link: { color: 'rgba(243,239,232,0.65)', textDecorationLine: 'underline' },
});
