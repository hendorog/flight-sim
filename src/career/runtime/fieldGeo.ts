// Field geometry for the job runtime (docs/career.md "The job runtime"): the Flight School's geo signals
// (rwyAlongM, rwyAcrossM, distAimFt, gpDevFt, onRunway, onPaved, pastHoldLine, circuitLeg, downwindOffsetNm,
// headwindKt, crosswindKt) measured at any airfield, relative to the end being landed on, and a touchdown builder
// that uses the type's own main gear instead of the Cessna 172's.
//
// Why a second provider: the school's geo provider (src/training/telemetry/providers/geo.ts) is the home runway 07
// only, and Telemetry refuses a provider whose signal ids collide with one already registered, so the job monitor
// builds its own Telemetry from [core, fieldGeo, powerplant] (never the default list). The school's provider,
// touchdownData and LandingDetector are reused untouched: the detector reads these same ids from the frame, so
// with this provider it measures a landing at a generated field correctly.
//
// The landing end: 0 lands toward the field's `heading` (the low-numbered runway), 1 the reciprocal. It starts as
// the end the aircraft points along, and while airborne it changes only when the aircraft is lined up with the
// other end: heading within 45 deg of it and within 600 m of the extended centreline (final, a low approach, a
// climb-out). The downwind leg (heading the other way but 1 km out) and base keep it; on the ground it is frozen,
// so a turn off the runway after landing never flips the sign of rwyAlongM in the middle of a roll-out.
//
// At the home field landing on 07 every signal is computed by the school's own helpers (airportSurface, the
// hold-line rule with the type's nose, classifyCircuitLeg), so the two providers agree to rounding there
// (tests/career/fieldGeo.test.ts). Elsewhere: onPaved is the generated field's pavement (airfieldSurface; a grass
// strip is never paved), pastHoldLine uses a hold FIELD_HOLD_M beyond the runway edge (generated fields paint none),
// and circuitLeg is the ATC's leg classifier for the field's own circuit (src/atc/calls.ts circuitLeg), 'ground'
// on the ground and 'none' where it fits no leg. The aim point is min(150 m, 0.15 x length)
// (LANDING_SCORE_RULES): 150 m at home (the final scenario's AIM_POINT), 97.5 m on a 650 m strip.
//
// Node-safe and three.js-free; imports no aircraft module (the type's gear and nose come in as numbers).

import { circuitLeg as atcCircuitLeg } from '../../atc/calls';
import { C172 } from '../../core/c172';
import { FT, KT, NM, quat, RAD, type Vec3 } from '../../core/math';
import type { AircraftState } from '../../core/types';
import { GLIDE_PATH } from '../../sim/scenarios';
import { classifyCircuitLeg } from '../../training/geo/circuit';
import { wrap180 } from '../../training/geo/angles';
import { GEO_SIGNALS } from '../../training/telemetry/providers/geo';
import type { CircuitLeg, SignalFrame, SignalProvider, TelemetrySources, TouchdownData } from '../../training/types';
import { airfieldSurface, fieldCoords, type Airfield } from '../../world/airfields';
import { airportSurface, HOLD_LINE_V } from '../../world/airport/layout';
import { LANDING_SCORE_RULES } from '../types';

/** The runway end being landed on: 0 toward the field's `heading` (low-numbered end), 1 the reciprocal. */
export type FieldEnd = 0 | 1;

/** Generated fields paint no hold lines: the nose counts as past one this far beyond the runway edge, m. */
export const FIELD_HOLD_M = 30;
/** The runway's protected area beyond each end (as the school's provider), m. */
const PROTECTED_BEYOND_END_M = 60;
/** The landing end changes in the air only lined up with the other one: heading within 45 deg (cos)... */
const END_SWITCH_COS = Math.cos(45 / RAD);
/** ...and this close to the extended centreline, m. */
const END_SWITCH_ACROSS_M = 600;

/** Aim point past the landing threshold, m: min(aimMaxM, aimFraction x length) (LANDING_SCORE_RULES). */
export function aimPointM(f: Pick<Airfield, 'length'>): number {
  return Math.min(LANDING_SCORE_RULES.aimMaxM, LANDING_SCORE_RULES.aimFraction * f.length);
}

/** The landing direction of an end, rad true. */
export function endHeading(f: Pick<Airfield, 'heading'>, end: FieldEnd): number {
  return f.heading + (end === 1 ? Math.PI : 0);
}

/** The end an aircraft on this heading (rad true) would land on: the one it points along. */
export function landingEndFor(f: Pick<Airfield, 'heading'>, heading: number): FieldEnd {
  return Math.cos(heading - f.heading) >= 0 ? 0 : 1;
}

/**
 * A point in the landing frame of a field end: `alongThr` from the landing threshold (+ down the runway, m) and
 * `across` from the centreline (+ right of the landing direction, m); `along`/`acrossCentre` are the field's own
 * centre frame (src/world/airfields.ts fieldCoords).
 */
export function fieldRunwayFrame(f: Airfield, end: FieldEnd, north: number, east: number): { alongThr: number; across: number; along: number; acrossCentre: number } {
  const { along, across } = fieldCoords(f, north, east);
  return end === 0
    ? { alongThr: along + f.length / 2, across, along, acrossCentre: across }
    : { alongThr: f.length / 2 - along, across: -across, along, acrossCentre: across };
}

/** Height of the 3 deg path to the aim point above the field, ft, `alongThr` m past the landing threshold. */
export function fieldGlidePathHeightFt(f: Pick<Airfield, 'length'>, alongThr: number): number {
  return (Math.max(0, aimPointM(f) - alongThr) * Math.tan(GLIDE_PATH)) / FT;
}

/** On the runway surface (centre frame along/across, m). */
function onRunwayOf(f: Airfield, along: number, across: number): boolean {
  return Math.abs(along) <= f.length / 2 && Math.abs(across) <= f.width / 2;
}

/** The field geo provider with the end it is measuring from (for fieldTouchdownData). */
export interface FieldGeoProvider extends SignalProvider {
  /** The landing end in use, or null with no field. */
  landingEnd(): FieldEnd | null;
}

/** Options of the field geo provider. */
export interface FieldGeoOptions {
  /** The type's spinner, body x, m (the hold-line test). Default: the Cessna 172's (core/c172.ts). */
  noseX?: number;
}

/**
 * The geo signals relative to `getField()` (the job's destination; null: every geo signal undefined: NaN, false,
 * 'none'). Same ids, kinds and units as the school's GEO_SIGNALS. Provider id 'fieldGeo'.
 */
export function createFieldGeoProvider(getField: () => Airfield | null, opts: FieldGeoOptions = {}): FieldGeoProvider {
  const noseX = opts.noseX ?? C172.fuselage.noseX;
  let field: Airfield | null = null;
  let end: FieldEnd = 0;
  let homeLeg: CircuitLeg = 'none';
  return {
    id: 'fieldGeo',
    defs: GEO_SIGNALS,
    landingEnd: () => (field ? end : null),
    sample(out: SignalFrame, src: TelemetrySources): void {
      const f = getField();
      const s = src.state;
      if (f !== field) {
        field = f;
        if (f) end = landingEndFor(f, s.heading);
        homeLeg = 'none';
      }
      if (!f) {
        out.rwyAlongM = out.rwyAcrossM = out.distAimFt = out.gpDevFt = out.downwindOffsetNm = out.headwindKt = out.crosswindKt = NaN;
        out.onRunway = out.onPaved = out.pastHoldLine = false;
        out.circuitLeg = 'none';
        return;
      }
      const n = s.position.x;
      const e = s.position.y;
      if (!s.onGround) {
        const c = Math.cos(s.heading - f.heading);
        if (Math.abs(c) > END_SWITCH_COS && Math.abs(fieldCoords(f, n, e).across) < END_SWITCH_ACROSS_M) end = c >= 0 ? 0 : 1;
      }
      const fr = fieldRunwayFrame(f, end, n, e);
      out.rwyAlongM = fr.alongThr;
      out.rwyAcrossM = fr.across;
      out.distAimFt = (fr.alongThr - aimPointM(f)) / FT;
      out.gpDevFt = (s.altitudeMSL - f.elevation) / FT - fieldGlidePathHeightFt(f, fr.alongThr);
      out.onRunway = onRunwayOf(f, fr.along, fr.acrossCentre);
      const home = f.kind === 'home';
      out.onPaved = home ? airportSurface(n, e) !== null : f.kind === 'sealed' && airfieldSurface(n, e) !== null;

      const nose = fieldCoords(f, n + Math.cos(s.heading) * noseX, e + Math.sin(s.heading) * noseX);
      const holdM = home ? -HOLD_LINE_V : f.width / 2 + FIELD_HOLD_M;
      out.pastHoldLine = s.onGround && Math.abs(nose.across) < holdM && Math.abs(nose.along) <= f.length / 2 + PROTECTED_BEYOND_END_M;

      if (home && end === 0) {
        homeLeg = classifyCircuitLeg(n, e, s.heading * RAD, s.onGround, homeLeg);
        out.circuitLeg = homeLeg;
      } else {
        homeLeg = 'none';
        out.circuitLeg = s.onGround ? 'ground' : atcCircuitLeg(f, end, n, e, s.heading) ?? 'none';
      }
      out.downwindOffsetNm = ((f.circuit === 'left' ? -1 : 1) * fr.across) / NM;

      const w = src.weather;
      const rel = (w.windDirectionDeg / RAD) - endHeading(f, end);
      out.headwindKt = w.windSpeedKt * Math.cos(rel);
      out.crosswindKt = w.windSpeedKt * Math.sin(rel);
    },
  };
}

/** The type's main-gear midpoint, body axes, m (from AircraftGeometry.gear). */
export function mainsMidpoint(gear: { leftMain: Vec3; rightMain: Vec3 }): Vec3 {
  return {
    x: (gear.leftMain.x + gear.rightMain.x) / 2,
    y: (gear.leftMain.y + gear.rightMain.y) / 2,
    z: (gear.leftMain.z + gear.rightMain.z) / 2,
  };
}

/**
 * TouchdownData at a field, for LandingDetector.onTouchdown: the school's touchdownData with the type's own main
 * gear (`mainsBody`, body m; mainsMidpoint(def.geometry.gear)) and the field's landing frame instead of the home
 * runway 07. `sinkFpm` from the SimEvents touchdown's sinkRate (m/s) / FPM; `end` defaults to the one the heading
 * points along. With no field the runway numbers are NaN and onRunway false.
 */
export function fieldTouchdownData(
  s: Readonly<AircraftState>, wheel: TouchdownData['firstWheel'], sinkFpm: number, field: Airfield | null, mainsBody: Vec3, end?: FieldEnd,
): TouchdownData {
  const off = quat.rotate(s.orientation, mainsBody);
  const hdg = s.heading * RAD;
  const base = {
    sinkFpm,
    kias: s.ias / KT,
    firstWheel: wheel,
    driftDeg: s.groundSpeed / KT < 5 ? 0 : wrap180(hdg - s.track * RAD),
    bankDeg: s.roll * RAD,
    pitchDeg: s.pitch * RAD,
  };
  if (!field) return { ...base, distAimFt: NaN, rwyAcrossM: NaN, onRunway: false };
  const fr = fieldRunwayFrame(field, end ?? landingEndFor(field, s.heading), s.position.x + off.x, s.position.y + off.y);
  return { ...base, distAimFt: (fr.alongThr - aimPointM(field)) / FT, rwyAcrossM: fr.across, onRunway: onRunwayOf(field, fr.along, fr.acrossCentre) };
}
