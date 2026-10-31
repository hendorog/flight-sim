// The radios' tuning: the frequencies the panel displays and the radio traffic is heard on (docs/atc.md). One live
// store, like the GPS destination (navigation.ts): the menu and the radio window (R) tune it, the resume snapshot
// keeps both COMs and the audio panel's MIC selection, and the rack units redraw when its revision changes.

import { airfields, type Airfield } from '../../world/airfields';

/** Radio frequencies shown on the displays (MHz): [active, standby]. NAV1 is the runway 07 ILS; COM1 starts on the home tower, its ATIS in standby. */
export interface RadioTuning {
  com1: [number, number];
  nav1: [number, number];
  com2: [number, number];
  nav2: [number, number];
  squawk: string;
  /** The audio panel's MIC selection: the COM transmitted and listened on. */
  mic: ComRadio;
  /** The NAV selected to the course indicator on a panel with one indicator and two NAV receivers (cdiSelect). */
  cdi: ComRadio;
}

export type ComRadio = 1 | 2;

export const DEFAULT_TUNING: Readonly<RadioTuning> = Object.freeze({
  com1: [118.3, 120.3] as [number, number],
  nav1: [110.3, 113.9] as [number, number],
  com2: [124.85, 118.0] as [number, number],
  nav2: [113.9, 116.8] as [number, number],
  squawk: '1200',
  mic: 1,
  cdi: 1,
});

/** The home field's stations (its tower is HOME_AIRFIELD.frequency). */
export const HOME_GROUND = 121.9;
export const HOME_ATIS = 120.3;

const live: RadioTuning = copy(DEFAULT_TUNING);
let revision = 0;

function copy(t: Readonly<RadioTuning>): RadioTuning {
  return { com1: [...t.com1], nav1: [...t.nav1], com2: [...t.com2], nav2: [...t.nav2], squawk: t.squawk, mic: t.mic, cdi: t.cdi };
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

/** Tune a COM: the new frequency becomes active and the old one goes to standby, as a flip-flop radio does. */
export function tuneCom(n: ComRadio, mhz: number): void {
  const f = validCom(mhz);
  const com = n === 1 ? live.com1 : live.com2;
  if (f === null || Math.abs(f - com[0]) < 1e-6) return;
  if (n === 1) live.com1 = [f, com[0]];
  else live.com2 = [f, com[0]];
  revision++;
}

export function tuneCom1(mhz: number): void {
  tuneCom(1, mhz);
}

/** Swap a COM's active and standby frequencies (the flip-flop button). */
export function swapCom(n: ComRadio): void {
  if (n === 1) live.com1 = [live.com1[1], live.com1[0]];
  else live.com2 = [live.com2[1], live.com2[0]];
  revision++;
}

export function swapCom1(): void {
  swapCom(1);
}

/** A NAV frequency on the 50 kHz raster (108.00-117.95), or null. */
export function validNav(mhz: number): number | null {
  if (!Number.isFinite(mhz) || mhz < 108 || mhz > 117.95) return null;
  return Math.round(mhz * 20) / 20;
}

/** Tune a NAV receiver: the new frequency active, the old one to standby. */
export function tuneNav(n: ComRadio, mhz: number): void {
  const f = validNav(mhz);
  const nav = n === 1 ? live.nav1 : live.nav2;
  if (f === null || Math.abs(f - nav[0]) < 1e-6) return;
  if (n === 1) live.nav1 = [f, nav[0]];
  else live.nav2 = [f, nav[0]];
  revision++;
}

export function swapNav(n: ComRadio): void {
  if (n === 1) live.nav1 = [live.nav1[1], live.nav1[0]];
  else live.nav2 = [live.nav2[1], live.nav2[0]];
  revision++;
}

/** A NAV as a pair (a restored flight); an invalid frequency falls back to the default. */
export function setNav(n: ComRadio, pair: readonly [number, number]): void {
  const d = n === 1 ? DEFAULT_TUNING.nav1 : DEFAULT_TUNING.nav2;
  const v: [number, number] = [validNav(pair[0]) ?? d[0], validNav(pair[1]) ?? d[1]];
  if (n === 1) live.nav1 = v;
  else live.nav2 = v;
  revision++;
}

export function navChanged(n: ComRadio): boolean {
  const [c, d] = n === 1 ? [live.nav1, DEFAULT_TUNING.nav1] : [live.nav2, DEFAULT_TUNING.nav2];
  return c[0] !== d[0] || c[1] !== d[1];
}

let tx = false;

/** The MIC is keyed (a call going out): the radios light TX. */
export function setTransmitting(on: boolean): void {
  if (tx === on) return;
  tx = on;
  revision++;
}

export function transmitting(): boolean {
  return tx;
}

/** The audio panel's MIC selector. */
export function selectMic(n: ComRadio): void {
  if (live.mic === n) return;
  live.mic = n;
  revision++;
}

/** The NAV source switch of a single course indicator. */
export function selectCdi(n: ComRadio): void {
  if (live.cdi === n) return;
  live.cdi = n;
  revision++;
}

/** A COM as a pair (a restored flight); an invalid frequency falls back to the default. */
export function setCom(n: ComRadio, pair: readonly [number, number]): void {
  const d = n === 1 ? DEFAULT_TUNING.com1 : DEFAULT_TUNING.com2;
  const v: [number, number] = [validCom(pair[0]) ?? d[0], validCom(pair[1]) ?? d[1]];
  if (n === 1) live.com1 = v;
  else live.com2 = v;
  revision++;
}

export function setCom1(pair: readonly [number, number]): void {
  setCom(1, pair);
}

/** A COM differs from the defaults (the snapshot keeps it only then). */
export function comChanged(n: ComRadio): boolean {
  const [c, d] = n === 1 ? [live.com1, DEFAULT_TUNING.com1] : [live.com2, DEFAULT_TUNING.com2];
  return c[0] !== d[0] || c[1] !== d[1];
}

export function com1Changed(): boolean {
  return comChanged(1);
}

/** Back to the defaults (a new world, or a snapshot that carries no tuning). */
export function resetRadios(): void {
  Object.assign(live, copy(DEFAULT_TUNING));
  tx = false;
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
