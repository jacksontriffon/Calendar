import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { key, minutesOfDay } from '@calendar/core';

export interface Now {
  /** epoch ms, rounded down to the minute so memoised blocks only refresh once a minute */
  nowMs: number;
  /** minutes past local midnight */
  nowMin: number;
  /** local midnight today */
  today: Date;
  todayKey: string;
}

/** The clock: refreshes every 30 s and when the app returns to the foreground (day rollover included). */
export function useNow(): Now {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const tick = () => setMinute(Math.floor(Date.now() / 60000));
    const t = setInterval(tick, 30000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, []);
  const nowMs = minute * 60000;
  const d = new Date(nowMs);
  const todayKey = key(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => new Date(d.getFullYear(), d.getMonth(), d.getDate()), [todayKey]);
  return { nowMs, nowMin: minutesOfDay(d), today, todayKey };
}
