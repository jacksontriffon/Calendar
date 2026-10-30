import type { ExpoConfig } from 'expo/config';

/**
 * Bundle id / Android package are PLACEHOLDERS. The real identifier is an open
 * question in docs/expo-plan.md (section 9, item 9) and must be decided before
 * the first signed build (Apple App ID with Sign in with Apple + App Groups,
 * Google OAuth client, EAS project). Changing it later means re-creating the
 * native projects and credentials, so settle it early.
 */
const APP_ID = 'com.claudecalendar.app';

/**
 * Google sign-in (native): the iOS OAuth client's REVERSED id, which becomes an
 * Info.plist URL scheme. Set GOOGLE_IOS_URL_SCHEME (see .env.example). The
 * placeholder lets prebuild / export / doctor run without it, but iOS Google
 * sign-in will not work until the real value is set.
 */
const GOOGLE_IOS_URL_SCHEME = process.env.GOOGLE_IOS_URL_SCHEME || 'com.googleusercontent.apps.REPLACE_ME';

const config: ExpoConfig = {
  name: 'Calendar',
  slug: 'calendar',
  version: '1.0.0',
  scheme: 'aicalendar',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#171615',
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: true,
    usesAppleSignIn: true,
  },
  android: {
    package: APP_ID,
    // OA 07: Android 14+ predictive back (the screen scales as the gesture runs).
    // Edge-to-edge is the default in this SDK; screens read insets from safe-area-context.
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: '#171615',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    // Single-page output: the app is auth-gated, so there is nothing to
    // pre-render. Vercel serves index.html for every route (see phase 8).
    output: 'single',
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#171615',
        image: './assets/splash-icon.png',
        imageWidth: 120,
      },
    ],
    // Native modules that need config-plugin entries (usage strings,
    // entitlements, URL schemes).
    'expo-apple-authentication',
    ['@react-native-google-signin/google-signin', { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }],
    'expo-localization',
    [
      'expo-calendar',
      {
        calendarPermission:
          'Calendar reads your phone calendars to show them next to your own events, and adds public events to the calendars you choose.',
        remindersPermission: false,
      },
    ],
    'expo-notifications',
    'expo-background-task',
  ],
  experiments: {
    typedRoutes: true,
  },
  // EAS: no `extra.eas.projectId` / `owner` yet. Run `eas init` (manual step,
  // see README.md) to create the project and write the id here.
};

export default config;
