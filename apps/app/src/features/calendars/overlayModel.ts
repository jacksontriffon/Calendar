/**
 * The pure part of the calendar view's overlay: what an event block shows beyond the synced event
 * (EV 04 marks and the imported-event colour). See ./overlay.ts for the hooks.
 */
import type { Paint, ProtoEvent } from '@calendar/core';
import type { EventTarget, GoogleCalendar } from '@calendar/db';

import { initials as initialsOf } from '@/features/auth/initials';
import { paintFromHex, normalizeHex } from './colors';
import type { GoogleEventMeta } from './hidden';
import type { TargetOp } from './store';
import { activeGoogleTargets } from './view';

/** The public glyph's state on a block (EV 4.3): synced = plain, pending = dashed and dimmed, failed = coral dot. */
export type GlyphState = 'synced' | 'pending' | 'failed';

export interface EventOverlay {
  /** colours for an imported event with no category; null = use the category's */
  paint: Paint | null;
  /** 5px dot bottom left: the calendar this event lives on, when it isn't My calendar */
  dotColor: string | null;
  /** two letters for someone else's event */
  initials: string | null;
  /** places a public event is published to */
  publicCount: number;
  glyph: GlyphState;
}

export const NO_OVERLAY: EventOverlay = { paint: null, dotColor: null, initials: null, publicCount: 0, glyph: 'synced' };

type CalendarColor = Pick<GoogleCalendar, 'id' | 'color'>;

export function deriveOverlay(
  ev: Pick<ProtoEvent, 'source' | 'isMine' | 'visibility' | 'cat'>,
  meta: GoogleEventMeta | null | undefined,
  calendars: readonly CalendarColor[],
  targets: readonly EventTarget[] | undefined,
  op?: Pick<TargetOp, 'state'> | null,
): EventOverlay {
  const out: EventOverlay = { ...NO_OVERLAY };
  if (ev.source === 'google') {
    const cal = meta?.calendarId ? calendars.find((c) => c.id === meta.calendarId) : undefined;
    const color = normalizeHex(cal?.color);
    out.dotColor = color;
    if (!ev.cat) out.paint = paintFromHex(color);
    if (ev.isMine === false) out.initials = meta?.organizerEmail ? initialsOf(meta.organizerEmail) : null;
  } else if (ev.isMine === false) {
    out.initials = meta?.organizerEmail ? initialsOf(meta.organizerEmail) : null;
  }
  if (ev.visibility === 'public' && ev.source !== 'google') {
    const live = [...activeGoogleTargets(targets), ...(targets ?? []).filter((t) => t.kind === 'device' && !t.remove_requested)];
    out.publicCount = live.length;
    if (live.some((t) => t.status === 'failed') || op?.state === 'failed') out.glyph = 'failed';
    else if (live.some((t) => t.status !== 'synced') || op?.state === 'pending' || op?.state === 'queued') out.glyph = 'pending';
  }
  return out;
}
