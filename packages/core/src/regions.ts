/**
 * Regions with typical sunrise/sunset (minutes past midnight) for the
 * day/night shading in the day view.
 */
export interface Region { k: string; label: string; tz: string; sr: number; ss: number }

export const REGIONS: readonly Region[] = [
  { k: 'London', label: 'London, UK', tz: 'Europe/London', sr: 398, ss: 1163 },
  { k: 'Dublin', label: 'Dublin, IE', tz: 'Europe/Dublin', sr: 412, ss: 1180 },
  { k: 'Paris', label: 'Paris, FR', tz: 'Europe/Paris', sr: 437, ss: 1203 },
  { k: 'Berlin', label: 'Berlin, DE', tz: 'Europe/Berlin', sr: 410, ss: 1175 },
  { k: 'Madrid', label: 'Madrid, ES', tz: 'Europe/Madrid', sr: 472, ss: 1235 },
  { k: 'Stockholm', label: 'Stockholm, SE', tz: 'Europe/Stockholm', sr: 382, ss: 1155 },
  { k: 'New York', label: 'New York, US', tz: 'America/New_York', sr: 391, ss: 1153 },
  { k: 'Chicago', label: 'Chicago, US', tz: 'America/Chicago', sr: 397, ss: 1157 },
  { k: 'Denver', label: 'Denver, US', tz: 'America/Denver', sr: 400, ss: 1155 },
  { k: 'Los Angeles', label: 'Los Angeles, US', tz: 'America/Los_Angeles', sr: 405, ss: 1152 },
  { k: 'Toronto', label: 'Toronto, CA', tz: 'America/Toronto', sr: 415, ss: 1168 },
  { k: 'Sao Paulo', label: 'São Paulo, BR', tz: 'America/Sao_Paulo', sr: 372, ss: 1093 },
  { k: 'Dubai', label: 'Dubai, AE', tz: 'Asia/Dubai', sr: 363, ss: 1116 },
  { k: 'Mumbai', label: 'Mumbai, IN', tz: 'Asia/Kolkata', sr: 385, ss: 1125 },
  { k: 'Singapore', label: 'Singapore', tz: 'Asia/Singapore', sr: 420, ss: 1145 },
  { k: 'Tokyo', label: 'Tokyo, JP', tz: 'Asia/Tokyo', sr: 320, ss: 1070 },
  { k: 'Sydney', label: 'Sydney, AU', tz: 'Australia/Sydney', sr: 360, ss: 1070 },
  { k: 'Cape Town', label: 'Cape Town, ZA', tz: 'Africa/Johannesburg', sr: 405, ss: 1130 },
];

/** The region for an IANA time zone (e.g. `profiles.tz`), or null. The prototype read it from `Intl`; the caller passes it in. */
export const regionForTz = (tz: string | null | undefined): Region | null => REGIONS.find((r) => r.tz === tz) || null;

export const regionByKey = (k: string | null | undefined): Region | null => REGIONS.find((r) => r.k === k) || null;
