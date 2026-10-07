// The simulated local clock: weather.timeOfDay (hours) and dayOfYear advance with simulated time.

import type { WeatherSettings } from '../core/types';

/** Advance the local solar time by `simSeconds` of simulated time; past midnight the date advances (1..365). */
export function advanceTimeOfDay(w: WeatherSettings, simSeconds: number): void {
  if (!(simSeconds > 0)) return;
  let t = w.timeOfDay + simSeconds / 3600;
  if (t >= 24) {
    const days = Math.floor(t / 24);
    t -= days * 24;
    w.dayOfYear = ((Math.round(w.dayOfYear) - 1 + days) % 365) + 1;
  }
  w.timeOfDay = t;
}
