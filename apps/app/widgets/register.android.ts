/** Android: register the widget task handler when the bundle loads (it must exist before any widget event). */
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './widgetTaskHandler';

registerWidgetTaskHandler(widgetTaskHandler);
