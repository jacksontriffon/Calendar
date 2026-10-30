/**
 * iOS: the snapshot lives in the App Group's UserDefaults, which the WidgetKit
 * extension (`targets/widget`) reads. This uses `ExtensionStorage` from
 * `@bacons/apple-targets`, the library that already builds the extension, so no
 * native module of our own is needed:
 *   set / get / remove  -> UserDefaults(suiteName: APP_GROUP)
 *   reloadWidget(kind)  -> WidgetCenter.shared.reloadTimelines(ofKind:)
 * Values are JSON strings. The App Group id must match `ios.entitlements` in
 * app.config.ts (the extension mirrors it) and `Shared.group` in Snapshot.swift.
 */
import { ExtensionStorage } from '@bacons/apple-targets';

import { APP_GROUP, IOS_WIDGET_KIND, type WidgetStorage } from './types';

const group = new ExtensionStorage(APP_GROUP);

export const widgetStorage: WidgetStorage = {
  get: (k) => group.get(k) ?? null,
  set: (k, v) => group.set(k, v),
  remove: (k) => group.remove(k),
  reload: () => ExtensionStorage.reloadWidget(IOS_WIDGET_KIND),
};

export const widgetsSupported = true;
