// Blade geometry of a propeller definition: chord and thickness from its planform tables, blade angle from its
// twist. The default is the McCauley 1A170E/JHA7660 of the Cessna 172S (C172_PROPELLER): 76 in diameter, 60 in
// geometric pitch, two blades, the blade angle a constant-pitch helix, theta(r) = atan(P / (2 pi r)), measured
// to the flat lower face as McCauley specifies pitch.
//
// A variable-pitch blade turns as a whole about its pitch-change axis: every station moves by the same angle.
// Its blade angle is given at the definition's reference station (`pitch`), and the twist says how the other
// stations differ from that one: a table of differences, or the shape of a helix.

import { interp1 } from '../../core/math';
import { C172_PROPELLER } from './c172Powerplant';
import type { PropellerDef } from './defs';

/** Station (r / R) at which a variable-pitch blade's angle is quoted when the definition names none. */
export const PROP_REFERENCE_STATION = 0.75;

/** Geometric pitch of a constant-pitch (helix) blade, m. */
function helixPitch(def: PropellerDef): number {
  if (def.twist.kind !== 'helix') throw new Error(`${def.name}: the blade has a twist table, not a geometric pitch`);
  return def.twist.pitch;
}

/** Blade angle at r / R = `x` as the twist alone gives it, rad: the helix angle, or the table's entry. */
function twistAngle(def: PropellerDef, x: number): number {
  const twist = def.twist;
  return twist.kind === 'helix' ? Math.atan(twist.pitch / (2 * Math.PI * x * (def.diameter / 2))) : interp1(twist.x, twist.angle, x);
}

/**
 * What a blade set to `pitch` at the reference station adds to the twist angle of every station, rad. With no
 * `pitch` the blade is as its twist describes it (0; a table is then read as the blade angle itself).
 */
function pitchOffset(def: PropellerDef, pitch: number | undefined): number {
  return pitch === undefined ? 0 : pitch - twistAngle(def, def.referenceStation ?? PROP_REFERENCE_STATION);
}

// The Cessna 172S propeller under the names this module has always exported.
export const PROP_RADIUS = C172_PROPELLER.diameter / 2;
export const PROP_BLADES = C172_PROPELLER.blades;
export const PROP_PITCH = helixPitch(C172_PROPELLER);
export const PROP_HUB_RADIUS = C172_PROPELLER.hubRadius;
export const STATION_X = C172_PROPELLER.stationX;
export const CHORD_OVER_R = C172_PROPELLER.chordOverR;
export const THICKNESS_X = C172_PROPELLER.thicknessX;
export const THICKNESS = C172_PROPELLER.thickness;

export interface BladeElement {
  /** Radius of the element centre, m. */
  r: number;
  /** Radial width, m. */
  dr: number;
  /** Chord, m. */
  chord: number;
  /** Blade angle of the flat lower face to the plane of rotation, rad. */
  theta: number;
  tOverC: number;
  /** Snel rotational stall-delay factor 3 (c / r)^2. */
  stallDelay: number;
}

/**
 * Split the blade into `count` elements. Spacing is half-cosine so the elements crowd toward the tip,
 * where both the loading and the tip-loss gradient are largest. `pitch`: the blade angle at the reference
 * station of a variable-pitch blade, rad (absent: the blade as its twist describes it).
 */
export function bladeElements(count: number, def: PropellerDef = C172_PROPELLER, pitch?: number): BladeElement[] {
  if (pitch !== undefined || def.twist.kind !== 'helix') return turnedBladeElements(count, def, pitch);
  const elements: BladeElement[] = [];
  const radius = def.diameter / 2;
  const helix = helixPitch(def);
  const span = radius - def.hubRadius;
  const edge = (i: number): number => def.hubRadius + span * Math.sin((0.5 * Math.PI * i) / count);
  for (let i = 0; i < count; i++) {
    const r0 = edge(i);
    const r1 = edge(i + 1);
    const r = 0.5 * (r0 + r1);
    const x = r / radius;
    const chord = interp1(def.stationX, def.chordOverR, x) * radius;
    elements.push({
      r,
      dr: r1 - r0,
      chord,
      theta: Math.atan(helix / (2 * Math.PI * r)),
      tOverC: interp1(def.thicknessX, def.thickness, x),
      stallDelay: 3 * (chord / r) * (chord / r),
    });
  }
  return elements;
}

/** The elements of a blade with a twist table, or of any blade turned to `pitch` at its reference station. */
function turnedBladeElements(count: number, def: PropellerDef, pitch: number | undefined): BladeElement[] {
  const offset = pitchOffset(def, pitch);
  // The planform is that of the blade as built: only the angles differ.
  const elements = bladeElements(count, { ...def, twist: { kind: 'helix', pitch: 1 } });
  for (const e of elements) e.theta = twistAngle(def, e.r / (def.diameter / 2)) + offset;
  return elements;
}

/**
 * Blade angle of the flat lower face at the station r / R = `x`, rad (what PropellerState.bladePitch reports at
 * the reference station). `pitch`: as for bladeElements.
 */
export function bladeAngleAt(def: PropellerDef, x: number, pitch?: number): number {
  if (pitch !== undefined || def.twist.kind !== 'helix') return twistAngle(def, x) + pitchOffset(def, pitch);
  return Math.atan(helixPitch(def) / (2 * Math.PI * x * (def.diameter / 2)));
}

/** Activity factor per blade, AF = (1e5 / 16) * integral of (c / D) (r / R)^3 d(r / R). */
export function activityFactor(elements: readonly BladeElement[], radius = PROP_RADIUS): number {
  let sum = 0;
  for (const e of elements) {
    const x = e.r / radius;
    sum += (e.chord / (2 * radius)) * x * x * x * (e.dr / radius);
  }
  return (1e5 / 16) * sum;
}
