// Pure helpers behind the type-dependent HUD and widget cues: the speed-tape bands from the reference speeds,
// the gear chip from the gear state, the flap / gear overspeed chips from the limits, the carburettor-heat
// chip and the engine-selection mark. No DOM here, so all of it is unit tested (tests/ui/).

import type { LimitsDef, OverspeedRule, ReferenceSpeeds } from '../aircraft/types';
import { DEG } from '../core/math';
import { engineControl, type ControlInputs, type GearState } from '../core/types';
import type { CueLevel } from './status';

// --- Speed tape --------------------------------------------------------------------------------------

/** One coloured band along the speed tape, KIAS. `inner`: the white flap band, drawn inside the others. */
export interface SpeedBand {
  from: number;
  to: number;
  color: string;
  inner?: boolean;
}

/** A single speed marked across the band strip: the blue line (Vyse) and the red radial (Vmca) of a twin. */
export interface SpeedLine {
  kias: number;
  color: string;
}

export const BAND_GREEN = '#2fbf55';
export const BAND_YELLOW = '#f2c230';
export const BAND_RED = '#ff4d3d';
export const BAND_WHITE = '#ffffff';
export const LINE_BLUE = '#3d8bff';
/** Top of the red band, KIAS (beyond any tape the HUD draws). */
const RED_TOP = 400;

/**
 * The airspeed indicator's arcs as HUD bands, in drawing order: green Vs1..Vno, yellow Vno..Vne, red from Vne,
 * and the white flap arc Vs0..Vfe of the last flap detent (full flap).
 */
export function speedBands(ref: ReferenceSpeeds): SpeedBand[] {
  return [
    { from: ref.vs1, to: ref.vno, color: BAND_GREEN },
    { from: ref.vno, to: ref.vne, color: BAND_YELLOW },
    { from: ref.vne, to: RED_TOP, color: BAND_RED },
    { from: ref.vs0, to: ref.vfe[ref.vfe.length - 1], color: BAND_WHITE, inner: true },
  ];
}

/** The twin's marked speeds: the blue line at Vyse and the red radial at Vmca. None on a single. */
export function speedLines(ref: ReferenceSpeeds): SpeedLine[] {
  const out: SpeedLine[] = [];
  if (ref.vyse !== undefined) out.push({ kias: ref.vyse, color: LINE_BLUE });
  if (ref.vmca !== undefined) out.push({ kias: ref.vmca, color: BAND_RED });
  return out;
}

// --- Gear --------------------------------------------------------------------------------------------

/** HUD chip of a retractable gear, or null (fixed gear, or gear up and nothing wrong). */
export interface GearCue {
  text: string;
  level: CueLevel | 'ok';
}

/**
 * Three greens when every leg is down and locked; GEAR IN TRANSIT while a leg moves; GEAR UNSAFE (red) while
 * the gear warning sounds, or when the lever is down and a leg is not locked although nothing moves.
 */
export function gearCue(g: GearState | undefined): GearCue | null {
  if (!g || !g.retractable) return null;
  if (g.warning) return { text: 'GEAR UNSAFE', level: 'alert' };
  if (g.inTransit) return { text: 'GEAR IN TRANSIT', level: 'warn' };
  const allLocked = g.locked[0] && g.locked[1] && g.locked[2];
  if (allLocked) return { text: 'GEAR ● ● ●', level: 'ok' };
  if (g.lever === 'down') return { text: 'GEAR UNSAFE', level: 'alert' };
  return null;
}

// --- Overspeed ---------------------------------------------------------------------------------------

/** Flap deflection below which the flaps count as retracted, rad (half a degree). */
const FLAPS_RETRACTED = 0.5 * DEG;

/**
 * The flap limit speed that applies at a deflection, m/s CAS: that of the first detent at or beyond it (a flap
 * between two detents is held to the stricter limit). Infinity with the flaps retracted.
 */
export function flapLimitCas(limits: LimitsDef, detents: readonly number[], flapsRad: number): number {
  if (flapsRad < FLAPS_RETRACTED) return Infinity;
  for (let i = 1; i < detents.length; i++) if (detents[i] >= flapsRad - FLAPS_RETRACTED) return limits.vfeCas[i] ?? Infinity;
  return limits.vfeCas[limits.vfeCas.length - 1] ?? Infinity;
}

/** The gear limit speed that applies, m/s CAS: Vle down and locked, Vlo extend / retract while it moves. Infinity when up or not given. */
export function gearLimitCas(limits: LimitsDef, g: GearState | undefined): number {
  if (!g || !g.retractable) return Infinity;
  if (g.inTransit) return (g.lever === 'down' ? limits.vloExtendCas : limits.vloRetractCas) ?? limits.vleCas ?? Infinity;
  const anyDown = g.extension[0] > 0 || g.extension[1] > 0 || g.extension[2] > 0;
  return anyDown ? (limits.vleCas ?? Infinity) : Infinity;
}

/**
 * The 'warn' rule of LimitsDef.flapOverspeed / gearOverspeed: true while the speed has been above the limit x
 * (1 + margin) for longer than `time` s. A rule with consequence 'none' never warns (the Cessna 172S).
 */
export class OverspeedTimer {
  private above = 0;

  constructor(private readonly rule: OverspeedRule) {}

  /** Advance by dt seconds at `cas` against `limit` (both m/s); returns whether the chip shows. */
  step(dt: number, cas: number, limit: number): boolean {
    if (this.rule.consequence !== 'warn' || !(cas > limit * (1 + this.rule.margin))) {
      this.above = 0;
      return false;
    }
    this.above += dt;
    return this.above > this.rule.time;
  }

  reset(): void {
    this.above = 0;
  }
}

// --- Carburettor heat, engine selection --------------------------------------------------------------

/** Carburettor heat at least half on, on any of `engines` engines. */
export function carbHeatOn(c: ControlInputs, engines: number): boolean {
  for (let i = 0; i < engines; i++) if (engineControl(c, i, 'carbHeat') >= 0.5) return true;
  return false;
}

/** The control-position widget's mark of the engine(s) the engine keys act on. */
export function engineSelectionLabel(sel: 'all' | 0 | 1 | undefined): 'L' | 'R' | 'BOTH' {
  return sel === 0 ? 'L' : sel === 1 ? 'R' : 'BOTH';
}
