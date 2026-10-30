/**
 * App entry (package.json "main"). It is `expo-router/entry` plus the two
 * things that must be registered when the JS bundle loads, before any UI:
 *  - the Android widget task handler (`widgets/register.android.ts`), and
 *  - the widget background-refresh task (`defineTask` cannot live in a component).
 * Both are no-ops on web.
 */
import './widgets/register';
import './src/features/widget/background';
import 'expo-router/entry';
