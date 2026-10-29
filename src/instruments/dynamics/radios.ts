// The radios' tuning: the frequencies the panel displays and the radio traffic is heard on (docs/atc.md). One live
// store, like the GPS destination (navigation.ts): the menu and the push-to-talk menu tune it, the resume snapshot
// keeps COM1, and the rack units redraw when its revision changes.

import { airfields, type Airfield } from '../../world/airfields';

/** Radio frequencies shown on the displays (MHz): [active, standby]. NAV1 is the runway 07 ILS; COM1 starts on the home tower, its ATIS in standby. */
export interface RadioTuning {
  com1: [number, number];
  nav1: [number, number];
  com2: [number, number];
  nav2: [number, number];
  squawk: string;
}

export const DEFAULT_TUNING: Readonly<RadioTuning> = Object.freeze({
  com1: [118.3, 120.3] as [number, number],
  nav1: [110.3, 113.9] as [number, number],
  com2: [124.85, 118.0] as [number, number],
  nav2: [113.9, 116.8] as [number, number],
  squawk: '1200',
});

/** The home field's stations (its tower is HOME_AIRFIELD.frequency). */
export const HOME_GROUND = 121.9;
export const HOME_ATIS = 120.3;

const live: RadioTuning = copy(DEFAULT_TUNING);
let revision = 0;

function copy(t: Readonly<RadioTuning>): RadioTuning {
  return { com1: [...t.com1], nav1: [...t.nav1], com2: [...t.com2], nav2: [...t.nav2], squawk: t.squawk };
}

/** The live tuning (the panel holds this object and redraws on radioRevision()). */
export function radioTuning(): Readonly<RadioTuning> {
  return live;
}

/** Bumped on every change, for the displays' latches. */
export function radioRevision(): number {
  return revision;
}

/** A COM frequency on the 25 kHz raster, or null if it is outside the airband. */
export function validCom(mhz: number): number | null {
  if (!Number.isFinite(mhz) || mhz < 118 || mhz > 136.975) return null;
  return Math.round(mhz * 40) / 40;
}

/** Tune COM1: the new frequency becomes active and the old one goes to standby, as a flip-flop radio does. */
export function tuneCom1(mhz: number): void {
  const f = validCom(mhz);
  if (f === null || Math.abs(f - live.com1[0]) < 1e-6) return;
  live.com1 = [f, live.com1[0]];
  revision++;
}

/** Swap COM1's active and standby frequencies. */
export function swapCom1(): void {
  live.com1 = [live.com1[1], live.com1[0]];
  revision++;
}

/** COM1 as a pair (a restored flight); an invalid frequency falls back to the default. */
export function setCom1(pair: readonly [number, number]): void {
  live.com1 = [validCom(pair[0]) ?? DEFAULT_TUNING.com1[0], validCom(pair[1]) ?? DEFAULT_TUNING.com1[1]];
  revision++;
}

/** COM1 differs from the defaults (the snapshot keeps it only then). */
export function com1Changed(): boolean {
  return live.com1[0] !== DEFAULT_TUNING.com1[0] || live.com1[1] !== DEFAULT_TUNING.com1[1];
}

/** Back to the defaults (a new world, or a snapshot that carries no tuning). */
export function resetRadios(): void {
  Object.assign(live, copy(DEFAULT_TUNING));
  revision++;
}

export type StationKind = 'tower' | 'ground' | 'atis' | 'traffic';

export interface Station {
  field: Airfield;
  kind: StationKind;
  frequency: number;
}

/** Every station in the world: the home field's tower, ground and ATIS, and each generated field's common frequency. */
export function stations(): Station[] {
  const out: Station[] = [];
  for (const f of airfields()) {
    if (f.kind === 'home') {
      out.push({ field: f, kind: 'tower', frequency: f.frequency }, { field: f, kind: 'ground', frequency: HOME_GROUND }, { field: f, kind: 'atis', frequency: HOME_ATIS });
    } else {
      out.push({ field: f, kind: 'traffic', frequency: f.frequency });
    }
  }
  return out;
}

/**
 * The station a frequency reaches from a position (NED, m): the nearest one on it, so two generated fields that
 * share a common frequency are told apart by distance. Null when nothing on the frequency is in use.
 */
export function stationOn(mhz: number, north: number, east: number): Station | null {
  let best: Station | null = null;
  let bestD = Infinity;
  for (const s of stations()) {
    if (Math.abs(s.frequency - mhz) > 0.004) continue;
    const d = Math.hypot(s.field.north - north, s.field.east - east);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
