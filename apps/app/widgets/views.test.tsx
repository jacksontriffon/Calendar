/**
 * Smoke tests for the Android layouts: build every size, light and dark, for a
 * normal day, an empty day and signed out, through the library's own tree
 * builder, and check the actions the spec lists (WG 5b) and the colour rule.
 */
// The library's own tree builder (not exported from its index, and untyped at this path).
// @ts-expect-error TS7016
import { buildWidgetTree as build } from 'react-native-android-widget/lib/commonjs/api/build-widget-tree';

import { cats, data, goals, NOW, snapshotAt } from '../src/features/widget/fixtures';
import { buildModel, type Layout } from '../src/features/widget/model';
import { DARK, LIGHT, widgetTokens } from '../src/features/widget/tokens';
import { WidgetView } from './views';

const buildWidgetTree = build as (el: React.JSX.Element) => unknown;

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: Node[];
}

const walk = (n: Node | string, f: (n: Node) => void) => {
  if (typeof n === 'string') return;
  f(n);
  (n.children ?? []).forEach((c) => walk(c, f));
};

const tree = (layout: Layout, snap = snapshotAt(), now = NOW.getTime(), dark = false): Node => {
  const m = buildModel(snap, now, layout, { platform: 'android' });
  return buildWidgetTree(<WidgetView m={m} p={dark ? DARK : LIGHT} tokens={widgetTokens()} />) as unknown as Node;
};

const collect = (root: Node) => {
  const actions: { action: string; data: Record<string, unknown> }[] = [];
  const texts: string[] = [];
  const textColors = new Set<string>();
  walk(root, (n) => {
    const p = n.props as { clickAction?: string; clickActionData?: Record<string, unknown>; text?: string; color?: string };
    if (p.clickAction) actions.push({ action: p.clickAction, data: p.clickActionData ?? {} });
    if (n.type === 'TextWidget') {
      texts.push(String(p.text));
      if (p.color) textColors.add(p.color);
    }
  });
  return { actions, texts, textColors };
};

describe('Android widget layouts', () => {
  it('builds every size in light and dark', () => {
    for (const layout of ['small', 'medium', 'large'] as const) {
      for (const dark of [false, true]) {
        expect(tree(layout, snapshotAt(), NOW.getTime(), dark).type).toBe('LinearLayoutWidget');
      }
    }
  });

  it('4x4: row links, MARK_DONE on goal sessions, goal links, the one "+", and the day link', () => {
    const { actions, texts } = collect(tree('large'));
    const uris = actions.filter((a) => a.action === 'OPEN_URI').map((a) => a.data.uri);
    expect(uris).toContain('aicalendar://event/e3');
    expect(uris).toContain('aicalendar://goal/g2');
    expect(uris).toContain('aicalendar://day/2026-10-30');
    expect(uris.filter((u) => u === 'aicalendar://compose')).toHaveLength(1);
    expect(actions.filter((a) => a.action === 'MARK_DONE').map((a) => a.data.id).sort()).toEqual(['e4', 'e7', 'e8']);
    expect(texts).toContain('Fri 30 Oct');
  });

  it('empty day: "Add a note" replaces the "+", still one compose target', () => {
    const sunday = new Date(2026, 10, 1, 11, 48);
    const snap = snapshotAt(sunday, { data: { events: [], cats, goals } });
    for (const layout of ['medium', 'large'] as const) {
      const { actions, texts } = collect(tree(layout, snap, sunday.getTime()));
      expect(texts).toContain('Nothing scheduled');
      expect(texts).toContain('Add a note');
      expect(actions.filter((a) => a.data.uri === 'aicalendar://compose')).toHaveLength(1);
    }
  });

  it('signed out: the whole widget opens sign-in', () => {
    for (const layout of ['small', 'medium', 'large'] as const) {
      const m = buildModel(null, NOW.getTime(), layout, { platform: 'android' });
      const t = buildWidgetTree(<WidgetView m={m} p={DARK} tokens={widgetTokens()} />) as unknown as Node;
      const { actions, texts } = collect(t);
      expect(actions[0]).toEqual({ action: 'OPEN_URI', data: { uri: 'aicalendar://signin' } });
      expect(texts).toContain('Sign in to see your day');
    }
  });

  it('stale 4x4 shows the offline banner with a REFRESH button', () => {
    const { actions, texts } = collect(tree('large', snapshotAt(), NOW.getTime() + 3 * 3600000));
    expect(texts).toContain('Updated 3h ago');
    expect(texts).toContain('Can’t refresh. Showing 3h old data.');
    expect(actions.some((a) => a.action === 'REFRESH')).toBe(true);
  });

  it('text is never coloured: ink only, white on dark and black on light', () => {
    for (const dark of [false, true]) {
      const { textColors } = collect(tree('large', snapshotAt(), NOW.getTime(), dark));
      // Android colour strings are #AARRGGBB; every text colour is white or black at some alpha.
      for (const c of textColors) {
        expect(c.slice(3)).toBe(dark ? 'ffffff' : '000000');
      }
    }
  });

  it('uses the app’s ring: an SVG with an 18 viewBox', () => {
    let svg = '';
    walk(tree('large'), (n) => {
      const p = n.props as { svgString?: string };
      if (!svg && p.svgString?.includes('stroke-dasharray')) svg = p.svgString;
    });
    expect(svg).toContain('viewBox="0 0 18 18"');
    expect(svg).toContain('r="7.5"');
    expect(svg).toContain('stroke-width="2.5"');
    expect(svg).toContain('rotate(-90 9 9)');
  });
});

void data;
