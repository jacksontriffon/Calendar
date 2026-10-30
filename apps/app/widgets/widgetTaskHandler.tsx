'use no memo';
/**
 * The headless task Android runs for every widget event (added, update,
 * resize, click). It runs in the app's JS runtime but without any UI, so it
 * only touches the shared storage:
 *   MARK_DONE  queue the check (the app applies it on its next run) and redraw
 *              the row dimmed with the goal ring moved, without opening the app
 *   REFRESH    the offline banner's Retry: apply the queue, pull, redraw
 * OPEN_URI taps never reach here; the system opens the deep link.
 */
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { appendDoneOp } from '../src/features/widget/queue';
import { widgetStorage } from '../src/features/widget/storage';
import { ANDROID_WIDGETS, type AndroidWidgetName } from '../src/features/widget/types';
import { renderAndroidWidget } from './render';

const isWidget = (n: string): n is AndroidWidgetName => (ANDROID_WIDGETS as readonly string[]).includes(n);

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const name = props.widgetInfo.widgetName;
  if (!isWidget(name)) return;
  const draw = () => props.renderWidget(renderAndroidWidget(name, widgetStorage));

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      draw();
      return;
    case 'WIDGET_CLICK': {
      if (props.clickAction === 'MARK_DONE') {
        const id = props.clickActionData?.id;
        if (typeof id === 'string' && id) appendDoneOp(widgetStorage, id, new Date());
        draw();
        // Other sizes on the home screen show the same row: redraw them too.
        void widgetStorage.reload();
        return;
      }
      if (props.clickAction === 'REFRESH') {
        try {
          const { refreshNow } = await import('../src/features/widget/runtime');
          await refreshNow();
        } catch {
          // offline: keep the old data and the stale line
        }
        draw();
      }
      return;
    }
    default:
      return;
  }
}
