/**
 * The mark-done queue (Design Spec WG 5, "Check taps").
 *
 * A check tapped on a widget does not open the app. The widget appends
 * `{op:'done', ev, at}` to `KEYS.ops` and redraws the row dimmed; the app
 * drains the queue when it next runs (launch, foreground, background refresh)
 * and applies each op through the store's `commit`, so it syncs and shows in
 * History like any other edit.
 *
 * Each key has exactly one writer, so the app and the extension never race on
 * a read-modify-write across processes:
 *   KEYS.ops  written by the widget (iOS App Intent, Android MARK_DONE task)
 *   KEYS.ack  written by the app: the `opKey`s it has applied
 * The widget prunes acknowledged and week-old ops from the queue when it next
 * appends. A done op is idempotent, so applying one twice is harmless.
 */
import { editEvent, type CalendarData, type HistoryKind } from '@calendar/core';

import type { DeviceKv } from '@/lib/deviceKv';

import { isOthers, opKey } from './snapshot';
import { APP_KEYS, KEYS, OP_MAX_AGE_MS, type DoneOp, type WidgetStorage } from './types';

const APPLIED_MAX = 200;

const parseArray = (raw: string | null | undefined): unknown[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function readOps(storage: Pick<WidgetStorage, 'get'>): DoneOp[] {
  return parseArray(storage.get(KEYS.ops)).filter(
    (o): o is DoneOp =>
      !!o && typeof o === 'object' && (o as DoneOp).op === 'done' && typeof (o as DoneOp).ev === 'string' && typeof (o as DoneOp).at === 'string',
  );
}

export function readAck(storage: Pick<WidgetStorage, 'get'>): string[] {
  return parseArray(storage.get(KEYS.ack)).filter((k): k is string => typeof k === 'string');
}

/**
 * Queue a check (the Android MARK_DONE handler, and tests; the iOS widget does
 * the same in Swift). Drops acknowledged and week-old ops first.
 */
export function appendDoneOp(storage: WidgetStorage, evId: string, now: Date): DoneOp {
  const ack = new Set(readAck(storage));
  const keep = readOps(storage).filter((o) => !ack.has(opKey(o)) && now.getTime() - Date.parse(o.at) < OP_MAX_AGE_MS);
  const op: DoneOp = { op: 'done', ev: evId, at: now.toISOString() };
  storage.set(KEYS.ops, JSON.stringify([...keep, op]));
  return op;
}

export interface DrainResult {
  /** events marked done */
  applied: number;
  /** ops dropped: event gone, already done, or someone else's */
  skipped: number;
  /** ops kept for later: the event has not arrived from the server yet */
  pending: number;
}

/** The slice of the calendar store the queue needs: the app's `getStore()`, or a headless engine adapter. */
export interface DrainStore {
  getState(): { data: CalendarData };
  commit(next: CalendarData, label: string, kind?: HistoryKind): void;
}

export interface DrainDeps {
  storage: WidgetStorage;
  /** the app side of the device KV (remembers which ops were applied) */
  kv: DeviceKv;
  store: DrainStore;
  now: Date;
}

/**
 * Apply queued checks to the store. Call it only once the signed-in user's
 * store is installed (the sync layer is ready), or events will not be found.
 * An op whose event is missing stays pending for a week, in case the event
 * has not synced down yet.
 */
export function drainDoneOps({ storage, kv, store, now }: DrainDeps): DrainResult {
  const ops = readOps(storage);
  const result: DrainResult = { applied: 0, skipped: 0, pending: 0 };
  if (!ops.length) return result;

  let applied: string[] = parseArray(kv.getString(APP_KEYS.applied)).filter((k): k is string => typeof k === 'string');
  const seen = new Set(applied);
  const todo = ops.filter((o) => !seen.has(opKey(o)));
  if (!todo.length) return result;

  for (const op of todo) {
    const k = opKey(op);
    const data: CalendarData = store.getState().data;
    const ev = data.events.find((e) => e.id === op.ev);
    if (!ev) {
      if (now.getTime() - Date.parse(op.at) >= OP_MAX_AGE_MS) {
        seen.add(k);
        applied.push(k);
        result.skipped++;
      } else {
        result.pending++;
      }
      continue;
    }
    if (ev.done || isOthers(ev)) {
      result.skipped++;
    } else {
      store.commit(editEvent(data, ev.id, { done: true }), 'Done · ' + ev.title, 'edit');
      result.applied++;
    }
    seen.add(k);
    applied.push(k);
  }

  applied = applied.slice(-APPLIED_MAX);
  kv.set(APP_KEYS.applied, JSON.stringify(applied));
  // Acknowledge what the queue currently holds that has been applied, so the widget can prune it.
  const appliedSet = new Set(applied);
  storage.set(KEYS.ack, JSON.stringify(ops.map(opKey).filter((k) => appliedSet.has(k))));
  return result;
}
