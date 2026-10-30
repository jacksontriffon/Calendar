'use no memo';
/** Turns the stored snapshot into the light and dark widget trees for one Android widget size. */
import type { WidgetRepresentation } from 'react-native-android-widget';

import type { Layout } from '../src/features/widget/model';
import { buildModel } from '../src/features/widget/model';
import { loadForDraw } from '../src/features/widget/read';
import { DARK, LIGHT, widgetTokens } from '../src/features/widget/tokens';
import type { AndroidWidgetName, WidgetStorage } from '../src/features/widget/types';
import { WidgetView } from './views';

/** Fixed sizes (open question 8): 2x2, 4x2, 4x4. */
export const LAYOUT_OF: Record<AndroidWidgetName, Layout> = {
  CalendarSmall: 'small',
  CalendarMedium: 'medium',
  CalendarLarge: 'large',
};

export function renderAndroidWidget(name: AndroidWidgetName, storage: Pick<WidgetStorage, 'get'>, nowMs: number = Date.now()): WidgetRepresentation {
  const { snapshot, ops } = loadForDraw(storage);
  const model = buildModel(snapshot, nowMs, LAYOUT_OF[name], { platform: 'android', ops });
  const tokens = snapshot?.tokens ?? widgetTokens();
  const light = snapshot?.tokens.light ?? LIGHT;
  const dark = snapshot?.tokens.dark ?? DARK;
  return {
    light: <WidgetView m={model} p={light} tokens={tokens} />,
    dark: <WidgetView m={model} p={dark} tokens={tokens} />,
  };
}
