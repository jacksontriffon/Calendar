'use no memo';
/**
 * The Android widget layouts: the iOS designs (Design Spec WG 1, 2, 4, 6) at
 * 2x2 (Small), 4x2 (Medium) and 4x4 (Large). Pure functions of the widget
 * model, no hooks (react-native-android-widget evaluates them directly).
 *
 * No coloured text: ink is white on dark and black on light, at the spec's
 * opacities; hues appear only on event bars and goal rings. The "+", the now
 * line and the check are ink too (open question 7). Text uses the system face
 * (custom fonts do not reach RemoteViews).
 */
import { FlexWidget, SvgWidget, TextWidget, type HexColor } from 'react-native-android-widget';

import { composeUrl } from '../src/features/widget/links';
import type { GoalModel, Item, RowModel, WidgetModel } from '../src/features/widget/model';
import { ink } from '../src/features/widget/tokens';
import type { Palette, WidgetTokens } from '../src/features/widget/types';
import { calendarSvg, checkSvg, cloudOffSvg, globeSvg, lockSvg, plusSvg, ringSvg } from './svg';

/** The launcher sets the real radius on Android 12+; 28dp is the spec's value and the fallback. */
export const SYSTEM_RADIUS_DP = 28;

interface Ctx {
  p: Palette;
  tokens: WidgetTokens;
  /** layout paddings and row height differ a little by size */
  small?: boolean;
}

const swatch = (c: Ctx, hue: number): HexColor => (c.tokens.swatch[String(hue)] ?? c.tokens.swatch['1000'] ?? '#b0aea5') as HexColor;
const solid = (hex: string): HexColor => hex as HexColor;
const open = (uri: string) => ({ clickAction: 'OPEN_URI' as const, clickActionData: { uri } });

type TextProps = { text: string; size: number; alpha?: number; weight?: '400' | '500' | '600' | '700'; flex?: number; width?: number; lines?: number; align?: 'left' | 'center' };
function T({ c, text, size, alpha = 1, weight = '400', flex, width, lines = 1, align }: TextProps & { c: Ctx }) {
  return (
    <TextWidget
      text={text}
      maxLines={lines}
      truncate="END"
      style={{ fontSize: size, fontWeight: weight, color: ink(c.p, alpha), ...(align ? { textAlign: align } : {}), ...(width ? { width } : {}), ...(flex ? { flex } : {}) }}
    />
  );
}

/* ---------- header ---------- */

function Header({ m, c, plusSize = 30 }: { m: WidgetModel; c: Ctx; plusSize?: number }) {
  return (
    <FlexWidget style={{ width: 'match_parent', height: 34, flexDirection: 'row', alignItems: 'center' }} {...open(m.url)}>
      <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
        <T c={c} text={m.header.title} size={19} weight="600" />
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          {m.header.stale ? (
            <SvgWidget svg={cloudOffSvg(c.tokens.amber, 11)} style={{ width: 11, height: 11, marginRight: 5 }} />
          ) : null}
          {m.header.dot ? <FlexWidget style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ink(c.p, 1), marginRight: 5 }} /> : null}
          <T c={c} text={m.header.sub} size={11} alpha={c.p.secondary} />
        </FlexWidget>
      </FlexWidget>
      {m.header.showPlus ? (
        <FlexWidget
          style={{ width: plusSize, height: plusSize, borderRadius: plusSize / 2, backgroundColor: ink(c.p, 1), alignItems: 'center', justifyContent: 'center' }}
          {...open(composeUrl())}
          accessibilityLabel="Add a note"
        >
          <SvgWidget svg={plusSvg(c.p.bg, 13)} style={{ width: 13, height: 13 }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/* ---------- rows ---------- */

function Check({ row, c }: { row: RowModel; c: Ctx }) {
  if (!row.check) return null;
  // A 40dp tap target around the 20dp circle. A done row has no action left.
  const circle = row.done ? (
    <FlexWidget style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: ink(c.p, 1), alignItems: 'center', justifyContent: 'center' }}>
      <SvgWidget svg={checkSvg(c.p.bg, 11)} style={{ width: 11, height: 11 }} />
    </FlexWidget>
  ) : (
    <FlexWidget style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: ink(c.p, c.p.checkRing) }} />
  );
  return (
    <FlexWidget
      style={{ width: 40, height: 25, alignItems: 'center', justifyContent: 'center' }}
      {...(row.done ? {} : { clickAction: 'MARK_DONE', clickActionData: { id: row.id } })}
      accessibilityLabel={row.done ? 'Done' : 'Mark done'}
    >
      {circle}
    </FlexWidget>
  );
}

function Marks({ row, c }: { row: RowModel; c: Ctx }) {
  return (
    <>
      {row.owner ? (
        <FlexWidget style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: ink(c.p, c.p.button), alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
          <TextWidget text={row.owner} style={{ fontSize: 8, fontWeight: '600', color: ink(c.p, 1) }} />
        </FlexWidget>
      ) : null}
      {row.vis === 'private' && !row.owner ? (
        <SvgWidget svg={lockSvg(c.p.ink, 11, c.p.secondary)} style={{ width: 11, height: 11, marginLeft: 4 }} />
      ) : null}
      {row.vis === 'public' ? <SvgWidget svg={globeSvg(c.p.ink, 11, c.p.tertiary)} style={{ width: 11, height: 11, marginLeft: 4 }} /> : null}
    </>
  );
}

function EventRow({ row, c, h = 25 }: { row: RowModel; c: Ctx; h?: number }) {
  return (
    <FlexWidget style={{ width: 'match_parent', height: h, flexDirection: 'row', alignItems: 'center' }}>
      <FlexWidget
        style={{ flex: 1, height: h, flexDirection: 'row', alignItems: 'center' }}
        {...open(row.url)}
      >
        <FlexWidget style={{ width: 3, height: h - 6, borderRadius: 2, backgroundColor: swatch(c, row.hue) }} />
        <FlexWidget style={{ width: 52, paddingLeft: 8 }}>
          <T c={c} text={row.time} size={10.5} alpha={row.done ? c.p.secondary * 0.5 : c.p.secondary} />
        </FlexWidget>
        <T c={c} text={row.title} size={13} weight="600" flex={1} alpha={row.done ? 0.5 : 1} />
        <Marks row={row} c={c} />
      </FlexWidget>
      <Check row={row} c={c} />
    </FlexWidget>
  );
}

function NowLine({ time, c }: { time: string; c: Ctx }) {
  return (
    <FlexWidget style={{ width: 'match_parent', height: 12, flexDirection: 'row', alignItems: 'center' }}>
      <FlexWidget style={{ width: 3 }} />
      <FlexWidget style={{ width: 52, paddingLeft: 8 }}>
        <T c={c} text={time} size={9.5} weight="700" />
      </FlexWidget>
      <FlexWidget style={{ flex: 1, height: 1.5, backgroundColor: ink(c.p, 1) }} />
    </FlexWidget>
  );
}

function Progress({ value, c }: { value: number; c: Ctx }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <FlexWidget style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: ink(c.p, c.p.button), flexDirection: 'row' }}>
      <FlexWidget style={{ flex: Math.max(1, pct), height: 3, borderRadius: 2, backgroundColor: ink(c.p, 0.75) }} />
      <FlexWidget style={{ flex: Math.max(1, 100 - pct), height: 3 }} />
    </FlexWidget>
  );
}

function Card({ item, c }: { item: Extract<Item, { kind: 'card' }>; c: Ctx }) {
  const row = item.row;
  return (
    <FlexWidget
      style={{ width: 'match_parent', height: 44, borderRadius: 10, backgroundColor: ink(c.p, c.p.subtle), flexDirection: 'column', justifyContent: 'center', paddingLeft: 8, paddingRight: 0 }}
      {...open(row.url)}
    >
      <FlexWidget style={{ width: 'match_parent', height: 25, flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ width: 3, height: 19, borderRadius: 2, backgroundColor: swatch(c, row.hue), marginRight: 6 }} />
        <T c={c} text={row.time} size={10.5} alpha={c.p.secondary} width={48} />
        <T c={c} text={row.title} size={13} weight="600" flex={1} />
        <Check row={row} c={c} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingRight: 8 }}>
        <Progress value={item.progress} c={c} />
        <FlexWidget style={{ width: 8 }} />
        <T c={c} text={item.endsIn} size={10.5} weight="500" alpha={c.p.secondary} />
      </FlexWidget>
    </FlexWidget>
  );
}

function Items({ items, more, c }: { items: Item[]; more: string | null; c: Ctx }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column', marginTop: 6 }}>
      {items.map((it, i) =>
        it.kind === 'now' ? (
          <NowLine key={`n${i}`} time={it.time} c={c} />
        ) : it.kind === 'card' ? (
          <Card key={it.row.id} item={it} c={c} />
        ) : (
          <EventRow key={it.row.id} row={it.row} c={c} />
        ),
      )}
      {more ? (
        <FlexWidget style={{ paddingTop: 3, paddingLeft: 11 }}>
          <T c={c} text={more} size={10.5} alpha={c.p.tertiary} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/* ---------- goals ---------- */

function Goal({ g, c, size = 26, dim }: { g: GoalModel; c: Ctx; size?: number; dim: boolean }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 3 }} {...open(g.url)}>
      <SvgWidget svg={ringSvg(swatch(c, g.hue), c.p.ink, c.p.track, g.ring)} style={{ width: size, height: size, marginRight: 8 }} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
          <T c={c} text={g.title} size={12} weight="600" flex={1} />
          {g.deadline ? <T c={c} text={g.deadline} size={10.5} alpha={c.p.tertiary} /> : null}
        </FlexWidget>
        {g.today ? <T c={c} text={g.today} size={12} weight="600" alpha={dim ? 0.4 : 1} /> : null}
        <T c={c} text={g.total} size={10.5} alpha={c.p.secondary} />
      </FlexWidget>
    </FlexWidget>
  );
}

function GoalsBlock({ goals, c, dim }: { goals: GoalModel[]; c: Ctx; dim: boolean }) {
  if (!goals.length) return null;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginTop: 6, paddingTop: 5, borderTopWidth: 1, borderColor: ink(c.p, c.p.hairline) }}>
      {goals.map((g) => (
        <Goal key={g.id} g={g} c={c} dim={dim} />
      ))}
    </FlexWidget>
  );
}

/* ---------- states ---------- */

function EmptyBody({ m, c }: { m: WidgetModel; c: Ctx }) {
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <FlexWidget style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: ink(c.p, c.p.subtle), alignItems: 'center', justifyContent: 'center' }}>
        <SvgWidget svg={calendarSvg(c.p.ink, 20, c.p.secondary)} style={{ width: 20, height: 20 }} />
      </FlexWidget>
      <FlexWidget style={{ height: 8 }} />
      <T c={c} text="Nothing scheduled" size={16} weight="600" align="center" />
      <FlexWidget style={{ height: 8 }} />
      <FlexWidget
        style={{ height: 30, paddingLeft: 11, paddingRight: 14, borderRadius: 15, backgroundColor: ink(c.p, c.p.button), flexDirection: 'row', alignItems: 'center' }}
        {...open(composeUrl())}
      >
        <SvgWidget svg={plusSvg(c.p.ink, 11)} style={{ width: 11, height: 11, marginRight: 6 }} />
        <TextWidget text="Add a note" style={{ fontSize: 12.5, fontWeight: '600', color: ink(c.p, 1) }} />
      </FlexWidget>
      {m.empty?.next ? (
        <FlexWidget style={{ marginTop: 4 }}>
          <T c={c} text={m.empty.next} size={11} alpha={c.p.tertiary} align="center" />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

function SignedOut({ m, c }: { m: WidgetModel; c: Ctx }) {
  const small = m.layout === 'small';
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column', alignItems: small ? 'flex-start' : 'center', justifyContent: small ? 'flex-end' : 'center' }}>
      <SvgWidget svg={calendarSvg(c.p.ink, small ? 28 : 40)} style={{ width: small ? 28 : 40, height: small ? 28 : 40 }} />
      <FlexWidget style={{ height: 8 }} />
      <T c={c} text="Sign in to see your day" size={small ? 16 : 17} weight="600" lines={2} align={small ? 'left' : 'center'} />
      <FlexWidget style={{ height: 3 }} />
      <T c={c} text={small ? 'Tap to open Calendar' : 'Your agenda and goals show here once you are signed in.'} size={small ? 11 : 12} alpha={c.p.secondary} lines={2} align={small ? 'left' : 'center'} />
      {small ? null : (
        <FlexWidget style={{ marginTop: 8, height: 32, paddingLeft: 16, paddingRight: 16, borderRadius: 16, backgroundColor: ink(c.p, c.p.button), alignItems: 'center', justifyContent: 'center' }}>
          <TextWidget text="Open Calendar" style={{ fontSize: 13, fontWeight: '600', color: ink(c.p, 1) }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function Banner({ text, c }: { text: string; c: Ctx }) {
  return (
    <FlexWidget style={{ width: 'match_parent', height: 36, marginTop: 8, paddingLeft: 12, paddingRight: 6, borderRadius: 12, backgroundColor: ink(c.p, c.p.subtle), flexDirection: 'row', alignItems: 'center' }}>
      <SvgWidget svg={cloudOffSvg(c.tokens.amber, 13)} style={{ width: 13, height: 13, marginRight: 8 }} />
      <T c={c} text={text} size={12} weight="500" flex={1} />
      <FlexWidget
        style={{ height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 13, backgroundColor: ink(c.p, c.p.button), alignItems: 'center', justifyContent: 'center' }}
        clickAction="REFRESH"
        accessibilityLabel="Retry"
      >
        <TextWidget text="Retry" style={{ fontSize: 12, fontWeight: '600', color: ink(c.p, 1) }} />
      </FlexWidget>
    </FlexWidget>
  );
}

/* ---------- small ---------- */

function SmallBody({ m, c }: { m: WidgetModel; c: Ctx }) {
  const s = m.small;
  if (!s) return null;
  if (s.kind === 'empty') {
    return (
      <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column' }}>
        <T c={c} text={s.date.toUpperCase()} size={10} alpha={c.p.secondary} />
        <FlexWidget style={{ height: 8 }} />
        <T c={c} text="Nothing scheduled" size={19} weight="700" lines={2} />
        <FlexWidget style={{ flex: 1 }} />
        <FlexWidget style={{ height: 28, paddingLeft: 9, paddingRight: 12, borderRadius: 14, backgroundColor: ink(c.p, c.p.button), flexDirection: 'row', alignItems: 'center' }}>
          <SvgWidget svg={plusSvg(c.p.ink, 10)} style={{ width: 10, height: 10, marginRight: 6 }} />
          <TextWidget text="Add a note" style={{ fontSize: 12, fontWeight: '600', color: ink(c.p, 1) }} />
        </FlexWidget>
      </FlexWidget>
    );
  }
  const now = s.kind === 'now';
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column' }}>
      <T c={c} text={now ? 'NOW' : 'NEXT'} size={10} alpha={c.p.secondary} />
      <FlexWidget style={{ height: 6 }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <T c={c} text={now ? s.minsLeft : s.when} size={26} weight="700" />
        {now ? <T c={c} text=" left" size={13} alpha={c.p.secondary} /> : null}
      </FlexWidget>
      <FlexWidget style={{ flex: 1 }} />
      {now ? (
        <FlexWidget style={{ width: 'match_parent', marginBottom: 8, flexDirection: 'row' }}>
          <Progress value={s.progress} c={c} />
        </FlexWidget>
      ) : null}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
        <FlexWidget style={{ width: 3, height: 32, borderRadius: 2, backgroundColor: swatch(c, s.hue), marginRight: 8 }} />
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <T c={c} text={s.title} size={14} weight="600" />
          <T c={c} text={s.range} size={11.5} alpha={c.p.secondary} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

/* ---------- root ---------- */

export function WidgetView({ m, p, tokens }: { m: WidgetModel; p: Palette; tokens: WidgetTokens }) {
  const c: Ctx = { p, tokens, small: m.layout === 'small' };
  const pad = m.layout === 'medium' ? 12 : 14;
  const root = { width: 'match_parent', height: 'match_parent', backgroundColor: solid(p.bg), borderRadius: SYSTEM_RADIUS_DP, padding: pad, flexDirection: 'column' } as const;

  if (m.state === 'signedOut') {
    return (
      <FlexWidget style={root} {...open(m.url)}>
        <SignedOut m={m} c={c} />
      </FlexWidget>
    );
  }

  if (m.layout === 'small') {
    return (
      <FlexWidget style={root} {...open(m.url)}>
        <SmallBody m={m} c={c} />
      </FlexWidget>
    );
  }

  const dim = m.goalsDim;
  const goals = <GoalsBlock goals={m.goals} c={c} dim={dim} />;
  const strip = m.strip ? (
    <FlexWidget style={{ marginTop: 4 }}>
      <T c={c} text={m.strip} size={10.5} alpha={c.p.tertiary} />
    </FlexWidget>
  ) : null;
  const banner = m.banner && m.layout === 'large' ? <Banner text={m.banner} c={c} /> : null;

  if (m.layout === 'medium') {
    // Left: header and rows. Right: two goals. The header "+" stays in the left column.
    return (
      <FlexWidget style={root} {...open(m.url)}>
        <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row' }}>
          <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column' }}>
            <Header m={m} c={c} plusSize={26} />
            {m.empty ? <EmptyBodyCompact c={c} /> : <Items items={m.items} more={null} c={c} />}
          </FlexWidget>
          <FlexWidget style={{ width: 12 }} />
          <FlexWidget style={{ width: 140, height: 'match_parent', flexDirection: 'column', justifyContent: 'center' }}>
            {m.goals.map((g) => (
              <Goal key={g.id} g={g} c={c} size={24} dim={dim} />
            ))}
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
    );
  }

  // Large (4x4)
  return (
    <FlexWidget style={root} {...open(m.url)}>
      <Header m={m} c={c} />
      {banner}
      {strip}
      {m.empty ? <EmptyBody m={m} c={c} /> : <Items items={m.items} more={m.more} c={c} />}
      {goals}
    </FlexWidget>
  );
}

function EmptyBodyCompact({ c }: { c: Ctx }) {
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column', justifyContent: 'center' }}>
      <T c={c} text="Nothing scheduled" size={14} weight="600" />
      <FlexWidget style={{ height: 8 }} />
      <FlexWidget
        style={{ height: 28, paddingLeft: 9, paddingRight: 12, borderRadius: 14, backgroundColor: ink(c.p, c.p.button), flexDirection: 'row', alignItems: 'center' }}
        {...open(composeUrl())}
      >
        <SvgWidget svg={plusSvg(c.p.ink, 10)} style={{ width: 10, height: 10, marginRight: 6 }} />
        <TextWidget text="Add a note" style={{ fontSize: 12, fontWeight: '600', color: ink(c.p, 1) }} />
      </FlexWidget>
    </FlexWidget>
  );
}

