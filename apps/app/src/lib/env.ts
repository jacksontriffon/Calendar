/**
 * Build-time configuration read from `EXPO_PUBLIC_*` variables. They must be
 * referenced as literal `process.env.EXPO_PUBLIC_*` so Metro inlines them.
 * See apps/app/.env.example for what each one is.
 */
export const env = {
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL || 'https://www.claude-calendar.com/terms',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@claude-calendar.com',
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL || 'https://www.claude-calendar.com/privacy',
} as const;

/** Redirect used by Supabase OAuth on native (see lib/deepLinks.ts). Must be on Supabase's redirect allow-list. */
export const NATIVE_AUTH_REDIRECT = 'aicalendar://auth/callback';
