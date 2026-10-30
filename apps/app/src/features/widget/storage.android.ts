/**
 * Android: the widget's draw task runs inside the app's own JS runtime
 * (react-native-android-widget's headless task), so the snapshot can live in
 * the same MMKV device store the app uses; no separate storage is needed.
 * `reload` asks the library to redraw every widget size.
 */
import { requestWidgetUpdate } from 'react-native-android-widget';

import { getDeviceKv } from '@/lib/deviceKv';

import { renderAndroidWidget } from '../../../widgets/render';
import { ANDROID_WIDGETS, type WidgetStorage } from './types';

const kv = getDeviceKv;

export const widgetStorage: WidgetStorage = {
  get: (k) => kv().getString(k) ?? null,
  set: (k, v) => kv().set(k, v),
  remove: (k) => kv().remove(k),
  async reload() {
    await Promise.all(
      ANDROID_WIDGETS.map((widgetName) =>
        requestWidgetUpdate({
          widgetName,
          renderWidget: () => renderAndroidWidget(widgetName, widgetStorage),
        }).catch(() => undefined),
      ),
    );
  },
};

export const widgetsSupported = true;
