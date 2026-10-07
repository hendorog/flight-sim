// Airframe points that must never touch the ground in normal operation. Each is a stiff penalty contact
// (so the airframe cannot sink through the terrain after a crash) with sliding friction, and each carries
// the crash message reported when it strikes. Positions are body axes relative to the reference point
// (core/c172.ts); the static ground plane is 1.25 m below the reference point.

import { C172 } from '../../core/c172';
import type { StructuralPoint } from './gearConfig';

export type { StructuralPoint } from './gearConfig';

const tipZ = C172.wing.quarterChord.z - (C172.wing.span / 2) * Math.tan(C172.wing.dihedral);
const halfSpan = C172.wing.span / 2;
const hTailHalfSpan = C172.hTail.span / 2;

export const C172_STRUCTURE: readonly StructuralPoint[] = [
  { position: { x: -0.1, y: -halfSpan, z: tipZ }, message: 'Left wingtip struck the ground', tolerance: 0 },
  { position: { x: -0.1, y: halfSpan, z: tipZ }, message: 'Right wingtip struck the ground', tolerance: 0 },
  // Tail tie-down ring under the tail cone: tail strike at ~13 degrees nose-up on the mains. The ring is a
  // forged fitting on a reinforced bulkhead: an over-rotation or an aft-CG aircraft settling onto its tail at
  // taxi or take-off-roll speeds scrapes it (and dents the tail cone skin) without a crash; slamming the tail
  // down in a landing flare is not survivable.
  { position: { x: -5.35, y: 0, z: 0.1 }, message: 'Tail strike', tolerance: 2.5 },
  { position: { x: C172.hTail.quarterChord.x, y: -hTailHalfSpan, z: C172.hTail.quarterChord.z }, message: 'Left horizontal stabilizer struck the ground', tolerance: 0 },
  { position: { x: C172.hTail.quarterChord.x, y: hTailHalfSpan, z: C172.hTail.quarterChord.z }, message: 'Right horizontal stabilizer struck the ground', tolerance: 0 },
  // Fuselage belly (cabin floor ~0.63 m above the ground) and lower cowling.
  { position: { x: -1.2, y: 0, z: 0.62 }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: 0.8, y: 0, z: 0.6 }, message: 'Belly struck the ground', tolerance: 0 },
  { position: { x: 1.7, y: 0, z: 0.45 }, message: 'Nose struck the ground', tolerance: 0 },
  // Upper surfaces, for a nose-over or roll-over.
  { position: { x: C172.vTail.tip.x, y: 0, z: C172.vTail.tip.z }, message: 'Aircraft flipped over', tolerance: 0 },
  { position: { x: 0.2, y: 0, z: -0.95 }, message: 'Aircraft flipped over', tolerance: 0 },
];

/** Propeller disc: the lowest blade tip is found at run time from the attitude. */
export const C172_PROPELLER = {
  hub: C172.prop.hub,
  radius: C172.prop.diameter / 2,
  message: 'Propeller strike',
} as const;

/** Penalty contact parameters for airframe points: stiff enough to stop 1 t within centimetres, well damped. */
export const STRUCTURE_CONTACT = {
  stiffness: 3e5,
  damping: 2e4,
  friction: 0.5,
} as const;
