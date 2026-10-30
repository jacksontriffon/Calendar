/**
 * Publish: app events -> Google, driven by `event_targets` rows of kind `google`.
 *
 * One call handles one `publish:{event_id}` message. Per Google calendar the event is targeted at:
 *
 *  - public + live + target present: create the Google event, or patch it when the fingerprint
 *    (title, times, all-day span, recurrence, time zone) changed; unchanged and already `synced` is a no-op;
 *  - private, soft-deleted or `remove_requested` (the target was unticked): delete the Google copy.
 *    A target of a private/deleted event stays as a `pending` row with no external id; an unticked one
 *    is deleted after its copy is gone.
 *
 * PRIVACY INVARIANT: a private event is never sent to Google. Every create/patch goes through
 * `buildGoogleEvent`, which refuses (PrivateEventError) anything that is not a live, public, app-owned
 * event, and the event is re-read from the database immediately before the write, so a visibility
 * change that lands mid-run wins.
 *
 * Weekly series are published as ONE Google event per calendar, with an RRULE, starting at the
 * series' first targeted occurrence; all occurrence rows share its `external_id` and fingerprint.
 * Limitation: edits to a single occurrence (moved, retitled, deleted, made private) are not sent;
 * only whole-series changes are (the anchor occurrence's title and time, the weekdays and the end
 * date). Ending or privatising a series removes the Google event.
 *
 * An existing target with an `external_id` (for example one written by legacy-import, with the old
 * sync's fingerprint) is always PATCHED, never re-created: the copy is matched by that id, so no
 * duplicate appears.
 *
 * Creating is crash-safe: the new Google event id is written to the target BEFORE the create call and
 * sent as the event's id, so a retry after a crash patches the event instead of duplicating it.
 */
import { GoogleApiError } from './api.ts';
import type { SyncDeps } from './deps.ts';
import { canWrite } from './mapping.ts';
import {
  assertPublishable, buildGoogleEvent, fingerprintOf, newGoogleEventId, PrivateEventError, rruleFor,
} from './publish_map.ts';
import type { BuildOpts, GoogleEventBody } from './publish_map.ts';
import { NeedsSigninError } from './tokens.ts';
import { safeTz } from './tz.ts';
import type { AppEvent, CalendarRow, SeriesInfo, TargetPatch, TargetRow } from './types.ts';

export interface PublishResult {
  /** Google calls: events created / patched / deleted */
  created: number;
  patched: number;
  deleted: number;
  /** units that needed nothing */
  unchanged: number;
  /** units that ended `failed` */
  failed: number;
  /** a failure that is worth retrying later: leave the queue message un-acked */
  retry: boolean;
}

interface Row { ev: AppEvent; t: TargetRow }

const MSG_SIGNIN = 'Google needs you to sign in again';
const MSG_NO_PUBLISH = 'This calendar is not set to publish';

const wanted = (r: Row): boolean =>
  r.ev.visibility === 'public' && !r.ev.deleted_at && r.ev.source === 'app' && !r.t.remove_requested;

const brief = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** PATCH merges nested objects, so switching between all-day and timed needs the other fields nulled. */
const forPatch = (b: GoogleEventBody): object => ({
  ...b,
  start: { date: null, dateTime: null, timeZone: null, ...b.start },
  end: { date: null, dateTime: null, timeZone: null, ...b.end },
});

export async function publishEvent(deps: SyncDeps, userId: string, eventId: string): Promise<PublishResult> {
  const { db } = deps;
  const res: PublishResult = { created: 0, patched: 0, deleted: 0, unchanged: 0, failed: 0, retry: false };

  const ev = await db.getEvent(userId, eventId);
  if (!ev) return res; // hard-deleted: its targets went with it
  if (ev.source !== 'app') return res; // imported events are never published

  const events = ev.series_id ? await db.listSeriesEvents(userId, ev.series_id) : [ev];
  if (!events.some((e) => e.id === ev.id)) events.push(ev);
  const byId = new Map(events.map((e) => [e.id, e]));
  const targets = await db.listGoogleTargets(events.map((e) => e.id));
  if (!targets.length) return res;

  const series = ev.series_id ? await db.getSeries(ev.series_id) : null;
  const tz = safeTz(await db.getTz(userId));

  const perCalendar = new Map<string, Row[]>();
  for (const t of targets) {
    const e = byId.get(t.event_id);
    if (!e) continue;
    const list = perCalendar.get(t.google_calendar_id) ?? [];
    list.push({ ev: e, t });
    perCalendar.set(t.google_calendar_id, list);
  }

  for (const [calendarId, rows] of perCalendar) {
    const cal = await db.getCalendar(calendarId);
    if (!cal) continue;
    try {
      await publishUnit(deps, { cal, rows, series, tz, userId }, res);
    } catch (e) {
      if (e instanceof PrivateEventError) {
        // Visibility changed under us: a newer publish job is already queued by the events trigger.
        deps.log('publish skipped: ' + e.message);
        continue;
      }
      const signin = e instanceof NeedsSigninError;
      const transient = e instanceof GoogleApiError && e.transient;
      const msg = signin ? MSG_SIGNIN : brief(e);
      for (const r of rows) {
        if (r.t.status !== 'failed' || r.t.error !== msg) {
          if (wanted(r) || r.t.remove_requested || r.t.external_id) await db.updateTarget(r.t.id, { status: 'failed', error: msg });
        }
      }
      res.failed++;
      if (!signin && (transient || !(e instanceof GoogleApiError))) res.retry = true;
      if (!signin && !transient && e instanceof GoogleApiError) deps.log('publish failed: ' + msg, { calendarId });
      if (!signin && !(e instanceof GoogleApiError)) deps.log('publish error', msg);
    }
  }
  return res;
}

interface Unit {
  cal: CalendarRow;
  rows: Row[];
  series: SeriesInfo | null;
  tz: string;
  userId: string;
}

async function publishUnit(deps: SyncDeps, u: Unit, res: PublishResult): Promise<void> {
  const { db, api, tokens } = deps;
  const { cal, rows, tz } = u;
  const members = rows.filter(wanted);
  const stamp = () => new Date(deps.now()).toISOString();

  // ---- nothing should be on Google: delete the copy (once) and tidy the rows ----
  if (!members.length) {
    const ids = [...new Set(rows.map((r) => r.t.external_id).filter((x): x is string => !!x))];
    if (ids.length) {
      if (!canWrite(cal.access_role)) throw new GoogleApiError(403, MSG_NO_PUBLISH, 'forbidden');
      const account = await db.getAccount(cal.account_id);
      if (!account || account.status !== 'ok') throw new NeedsSigninError(cal.account_id);
      const token = await tokens.get(account.id);
      for (const id of ids) {
        await api.deleteEvent(token, cal.google_id, id);
        res.deleted++;
      }
    }
    for (const r of rows) {
      if (r.t.remove_requested) await db.deleteTarget(r.t.id);
      else if (r.t.external_id || r.t.fingerprint || r.t.status !== 'pending' || r.t.error) {
        await db.updateTarget(r.t.id, { external_id: null, fingerprint: null, status: 'pending', error: null });
      }
    }
    if (!ids.length) res.unchanged++;
    return;
  }

  // ---- something should be on Google ----
  if (!cal.can_publish) {
    for (const r of members) {
      if (r.t.status !== 'failed' || r.t.error !== MSG_NO_PUBLISH) await db.updateTarget(r.t.id, { status: 'failed', error: MSG_NO_PUBLISH });
    }
    res.failed++;
    return;
  }
  const account = await db.getAccount(cal.account_id);
  if (!account || account.status !== 'ok') throw new NeedsSigninError(cal.account_id);

  members.sort((a, b) => a.ev.day.localeCompare(b.ev.day) || a.ev.start_min - b.ev.start_min);
  let anchor = members[0];
  const opts = (e: AppEvent): BuildOpts => ({
    tz,
    rrule: u.series ? rruleFor(u.series, { firstDay: e.day, allDay: e.all_day, tz }) : undefined,
  });
  let o = opts(anchor.ev);
  let fp = await fingerprintOf(anchor.ev, o);

  // the Google event we already have for this unit, if any (series rows share one id)
  const holder = members.find((r) => r.t.external_id === anchor.t.external_id && r.t.external_id) ?? members.find((r) => r.t.external_id) ?? rows.find((r) => r.t.external_id);
  const master = holder?.t.external_id ?? null;
  const upToDate = !!holder && holder.t.fingerprint === fp && holder.t.status === 'synced' && members.includes(holder);

  let id = master;
  if (!upToDate) {
    // Re-read the anchor right before writing: it may have gone private or been deleted meanwhile.
    const fresh = await db.getEvent(u.userId, anchor.ev.id);
    if (!fresh) throw new PrivateEventError(anchor.ev.id, 'it no longer exists');
    assertPublishable(fresh);
    if (JSON.stringify([fresh.title, fresh.day, fresh.start_min, fresh.end_min, fresh.all_day, fresh.days]) !==
        JSON.stringify([anchor.ev.title, anchor.ev.day, anchor.ev.start_min, anchor.ev.end_min, anchor.ev.all_day, anchor.ev.days])) {
      anchor = { ev: fresh, t: anchor.t };
      o = opts(fresh);
      fp = await fingerprintOf(fresh, o);
    }
    const body = buildGoogleEvent(anchor.ev, o);
    const token = await tokens.get(account.id);
    id = await writeCopy(deps, { token, calendar: cal, anchorTarget: anchor.t, id: master, body });
    if (master && id === master) res.patched++;
    else res.created++;
    // If an import saw our copy before its target was recorded (legacy-import links events to their
    // old Google copies after inserting them), drop that stale imported row.
    await db.softDeleteImported(cal.id, [id]);
  } else {
    res.unchanged++;
  }

  const now = stamp();
  for (const r of rows) {
    if (members.includes(r)) {
      if (r.t.external_id !== id || r.t.fingerprint !== fp || r.t.status !== 'synced' || r.t.error) {
        const patch: TargetPatch = { external_id: id, fingerprint: fp, status: 'synced', error: null, synced_at: now };
        await db.updateTarget(r.t.id, patch);
      }
    } else if (r.t.remove_requested) {
      await db.deleteTarget(r.t.id);
    } else if (r.t.external_id || r.t.fingerprint) {
      await db.updateTarget(r.t.id, { external_id: null, fingerprint: null, status: 'pending', error: null });
    }
  }
}

/** Creates or patches the Google copy and returns its id (it can change if the old one was deleted on Google). */
async function writeCopy(
  deps: SyncDeps,
  o: { token: string; calendar: CalendarRow; anchorTarget: TargetRow; id: string | null; body: GoogleEventBody },
): Promise<string> {
  const { api, db } = deps;
  const gid = o.calendar.google_id;

  if (o.id) {
    const p = await api.patchEvent(o.token, gid, o.id, forPatch(o.body));
    if (!p.gone) return o.id;
    if (p.gone === 404) {
      // never created (we crashed after writing the id) -> create it under that id
      const r = await api.insertEvent(o.token, gid, { id: o.id, ...o.body });
      if (!r.conflict) return o.id;
      const again = await api.patchEvent(o.token, gid, o.id, forPatch(o.body));
      if (!again.gone) return o.id;
    }
    // 410: the copy was deleted on Google; its id can't be reused. Fall through to a new one.
  }

  for (let i = 0; i < 3; i++) {
    const nid = newGoogleEventId();
    // write-ahead: if we crash after Google creates it, the retry patches instead of duplicating
    await db.updateTarget(o.anchorTarget.id, { external_id: nid, status: 'pending', error: null });
    const r = await api.insertEvent(o.token, gid, { id: nid, ...o.body });
    if (!r.conflict) return nid;
    const p = await api.patchEvent(o.token, gid, nid, forPatch(o.body));
    if (!p.gone) return nid;
  }
  throw new Error('could not create the Google event');
}
