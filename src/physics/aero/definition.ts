// The aerodynamic description of one aircraft type, as AeroModel consumes it: lifting strips, slender bodies,
// parasite items, the propeller stations whose jets wash the airframe, and the stall-warning sensors. A
// definition is built by a FACTORY (c172Aero.ts createC172AeroDefinition for the Cessna 172S): strips carry
// section objects, so it is not plain data.

import type { Vec3 } from '../../core/math';
import type { DragItem, FuselageDefinition, LiftingStrut } from './bodies';
import type { Strip } from './strips';

export interface PropellerStation {
  hub: Vec3; radius: number;
  /**
   * Finite-jet correction on the axial velocity INCREMENT wing strips see inside this jet (Koning), applied to
   * an increment of EITHER sign (so it also scales the deficit behind an idling or windmilling propeller):
   * 1 = the full two-dimensional value (today), about 0.6-0.8 for a wing-mounted tractor whose jet is about
   * one chord deep.
   */
  wingBlowing?: number;
  /**
   * Fraction of this jet's swirl the TAIL strips (tailplane and fin) see; absent: 1 (contract 3.1: undiminished
   * behind the wing, as on the C172S's high wing, where the jet core reaching the fin passes along the cabin
   * sides). A low wing whose root sections and a wing-body junction lie across the jet straighten much of it
   * before a fin standing in the jet (the DA20).
   */
  swirlBehindWing?: number;
  /**
   * Factor on this jet's axial velocity increment (or deficit) at the TAIL strips; absent: 1. For a fin far
   * behind the disc whose jet has mixed out more than the mixing-layer model gives (a slim tail boom with no
   * fuselage to keep the jet's core together).
   */
  jetAtTail?: number;
}

export interface StallSensor {
  /** Index into `wing` of the strip carrying the vane / port. */
  strip: number;
  /** How far below that strip's stall break the warning sounds, rad of local angle of attack. */
  margin: number;
  /** Active only while the flap deflection is inside this range, rad (PA-34: two detectors switched by flap). Absent: always. */
  flaps?: readonly [number, number];
  /**
   * An electric lift detector: it warns only while the bus is alive (above electrical.busDeadVolts), and so does
   * every consumer of FlightState.stallWarning (horn, HUD, coach). Absent: false (a pneumatic reed, the C172S's
   * definition; its horn's own bus dependence is the audio profile's).
   */
  needsBus?: boolean;
}

export interface AircraftAeroDefinition {
  /** Reference area, chord and span used for coefficients. */
  referenceArea: number; referenceChord: number; referenceSpan: number;
  /** Main wing strips incl. any winglet strips; one lifting-line system. */
  wing: Strip[];
  /** Tailplane / stabilator and fin strips; one lifting-line system (the tailplane end-plates the fin). */
  tail: Strip[];
  fuselage: FuselageDefinition;
  /** Engine nacelles: slender bodies off the centre line (their `axis` gives y, z). */
  nacelles?: FuselageDefinition[];
  dragItems: DragItem[];
  /** Lifting struts (their drag is in dragItems). */
  struts: LiftingStrut[];
  /** One per propeller, same order as PowerplantDef.engines. */
  propellers: PropellerStation[];
  /**
   * Stall-warning vane(s): the strip carrying each, and how far below that strip's stall break the horn sounds.
   */
  stallWarning: StallSensor | StallSensor[];
  /**
   * Body-x stations at which each jet's path is sampled, from just behind the disc to beyond the tail. Absent:
   * today's absolute table (the C172S definition sets nothing, so its numbers do not move).
   */
  jetStations?: number[];
  /** Jet path sample grid about each hub: lateral offsets (m) and vertical offsets (m). Absent: [-2, 0, 2] and -1.8 .. 1.2 step 0.25 in ABSOLUTE body coordinates (today). */
  jetGrid?: { rows: number[]; column: number[] };
  /**
   * Wing-wake immersion of the tail (aeroModel.ts applyWingWake). Absent members = today's module constants
   * (MAX_WAKE_LOSS 0.7 and the widths). The sanctioned handle for a T-tail whose trimmed stall will not recover.
   */
  wake?: { maxLoss?: number; widthScale?: number };
}

/**
 * Separated-flow normal force of a finite surface: cd90 = 1.11 + 0.018 AR (Viterna & Corrigan 1982, after
 * Hoerner's flat-plate data).
 */
export const viternaCd90 = (aspectRatio: number) => 1.11 + 0.018 * aspectRatio;
