import { Redirect, type Href } from 'expo-router';

import { useSession } from '@/features/auth/session';
import { decideEntryStage } from '@/features/onboarding/entry';

/**
 * Unmatched URLs land here, which includes `/` itself while the (app) group
 * is guarded off (signed out, importing, in setup). Send the user to the
 * screen they are allowed on; in the app, a link to a screen that doesn't
 * exist (yet) falls back to the calendar.
 */
export default function NotFound() {
  const { status, profile, profileState } = useSession();
  const stage = decideEntryStage({ status, profileState, profile });
  const href: Href =
    status === 'signedOut'
      ? '/welcome'
      : stage === 'import'
        ? '/import'
        : stage === 'onboarding' || stage === 'loading' || stage === 'error'
          ? '/onboarding'
          : '/';
  return <Redirect href={href} />;
}
