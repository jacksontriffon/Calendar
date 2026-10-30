/**
 * The iOS home-screen widget (WidgetKit extension, SwiftUI), generated into the
 * Xcode project by @bacons/apple-targets on `expo prebuild`. Every file in this
 * folder is part of the target. The App Group is mirrored from
 * `ios.entitlements` in app.config.ts.
 *
 * iOS 17 is the floor: interactive widgets (the check button runs an App
 * Intent) and `containerBackground` need it.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'CalendarWidget',
  displayName: 'Calendar',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
  // Placeholder and empty-state background before the first timeline loads.
  colors: {
    $widgetBackground: { color: '#f6f3ee', darkColor: '#1b1a18' },
  },
});
