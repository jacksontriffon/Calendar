/**
 * Time-zone helpers for first-run setup (OA 2.1). `profiles.tz` is an IANA id
 * such as `America/Los_Angeles`; the UI shows "Los Angeles" and
 * "Pacific Time · GMT−7". Intl support differs between Hermes, JSC and
 * browsers, so everything here degrades to the raw id.
 */

/** Zones offered when `Intl.supportedValuesOf` is not available. Covers every populated offset. */
export const FALLBACK_ZONES: readonly string[] = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Phoenix',
  'America/Chicago', 'America/Mexico_City', 'America/New_York', 'America/Toronto', 'America/Bogota',
  'America/Halifax', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Reykjavik',
  'UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Athens',
  'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos',
  'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai',
  'Asia/Manila', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Adelaide',
  'Australia/Sydney', 'Pacific/Auckland',
];

/** The device's IANA zone, or `UTC` when it cannot be read. */
export function detectTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && isValidTimeZone(tz)) return tz;
  } catch {
    // fall through
  }
  return 'UTC';
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows, or the fallback list. The `current` zone is always included. */
export function listTimeZones(current?: string): string[] {
  let zones: string[] = [];
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof fn === 'function') zones = fn.call(Intl, 'timeZone');
  } catch {
    zones = [];
  }
  if (!zones.length) zones = [...FALLBACK_ZONES];
  if (current && !zones.includes(current)) zones = [current, ...zones];
  return zones;
}

/** `America/Argentina/Buenos_Aires` -> `Buenos Aires`; `UTC` -> `UTC`. */
export function cityName(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

/** `GMT−7`, `GMT+5:30`, `GMT` for the given zone at `date`. Uses a real minus sign, as the spec does. */
export function gmtOffsetLabel(tz: string, date: Date = new Date()): string {
  const mins = offsetMinutes(tz, date);
  if (mins === null) return '';
  if (mins === 0) return 'GMT';
  const sign = mins < 0 ? '−' : '+';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

/** Offset from UTC in minutes at `date`, derived from the zone's wall-clock fields. Null if unsupported. */
export function offsetMinutes(tz: string, date: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    if (!Number.isFinite(asUtc)) return null;
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  } catch {
    return null;
  }
}

/** "Pacific Time" (falls back to the region, e.g. "America"). */
export function zoneLongName(tz: string, date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(date);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name) return name;
  } catch {
    // fall through
  }
  return tz.split('/')[0].replace(/_/g, ' ');
}

/** The second line of the picker row: "Pacific Time · GMT−7". */
export function zoneDetail(tz: string, date: Date = new Date()): string {
  return [zoneLongName(tz, date), gmtOffsetLabel(tz, date)].filter(Boolean).join(' · ');
}
