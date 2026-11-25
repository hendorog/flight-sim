// Richard Pearse Waitohi Monoplane (Waitohi Flat, South Canterbury, NZ; 1903 / NZ Patent No. 21476, 1906, and the
// Richard Pearse Memorial full-scale reconstruction at Waitohi):
//
// Configuration (matching NZ Patent 21476 & the Waitohi Memorial):
//   - Tailless-boom parasol monoplane: flat rectangular grid-framed bamboo & canvas wing (~25 ft / 7.62 m span,
//     2.00 m chord, 0 deg dihedral);
//   - Inset rectangular ailerons WITHIN the outer wing bays (inboard of fixed wingtip framing);
//   - All-moving rectangular elevator hinged directly to the REAR EDGE of the centre wing;
//   - Tall rectangular vertical rudder sail standing upright in the CENTRE OF THE WING, guy-wired to the wingtips;
//   - Front wing-mounted 2-cylinder double-acting engine driving a two-vane diamond-paddle variable-pitch airscrew;
//   - Open vertical tubular-steel undercarriage frame below the wing with three large wire-spoked wheels (steerable
//     front wheel and wide-track rear wheels) and an open suspended pilot seat.
//
// All positions are in body axes (FRD: x forward, y right, z DOWN), metres, relative to the REFERENCE POINT: on the
// centreline at the wing quarter-chord x = 0, at the height of the loaded CG (0.92 m below the wing plane).

import { DEG } from '../../core/math';
import type { AircraftGeometry } from '../types';

export const PEARSE_GEOMETRY: AircraftGeometry = {
  // --- Flat rectangular grid-ribbed parasol wing (leading edge x = +0.50, trailing edge x = -1.50, z = -0.92) ---
  wing: {
    mount: 'high',
    /** 25 ft (7.62 m) wingspan. */
    span: 7.62,
    /** Rectangular 7.62 m x 2.00 m planform = 15.24 m^2 (~164 ft^2). */
    area: 15.24,
    rootChord: 2.0,
    tipChord: 2.0,
    taperStartY: 3.81,
    meanChord: 2.0,
    /** Parasol wing carried on vertical tubular hangers 0.92 m above the loaded CG. */
    quarterChord: { x: 0, z: -0.92 },
    /** Flat zero-dihedral wing braced by overhead mast wires and lower flying wires. */
    dihedral: 0,
    rootIncidence: 3.5 * DEG,
    tipIncidence: 3.0 * DEG,
    rootY: 0.002,
    /** Inboard trailing-edge camber flaps (0, 8, 16 deg). */
    flap: { innerY: 0.24, outerY: 1.35, chordFraction: 0.28, maxDeflection: 16 * DEG },
    /**
     * Inset rectangular ailerons WITHIN the outer wing panels (2.55 m to 3.45 m), enclosed outboard by the fixed
     * 3.45..3.81 m outer wingtip bay and framed along the continuous rear spar.
     */
    aileron: { innerY: 2.55, outerY: 3.45, chordFraction: 0.36, maxUp: 22 * DEG, maxDown: 18 * DEG },
    /** Lower diagonal flying-wire brace line from lower undercarriage chassis to outer wing spar. */
    strut: { fuselage: { x: 0.1, y: 0.3, z: 0.62 }, wing: { x: 0.0, y: 2.55, z: -0.9 } },
  },

  // --- All-moving rectangular elevator attached directly to the REAR EDGE of the wing (x = -1.50 m) ---
  hTail: {
    mount: 'fuselage',
    allMoving: true,
    span: 2.1,
    area: 2.1,
    rootChord: 1.0,
    tipChord: 1.0,
    /** Leading-edge hinge at x = -1.50 (wing trailing edge), quarter-chord at -1.75, trailing edge at -2.50. */
    quarterChord: { x: -1.75, z: -0.9 },
    incidence: -3.2 * DEG,
    elevator: { chordFraction: 1, maxUp: 24 * DEG, maxDown: 20 * DEG },
  },

  // --- Tall rectangular canvas sail standing upright in the CENTRE OF THE WING ---
  vTail: {
    area: 2.18,
    height: 1.45,
    rootChord: 1.5,
    tipChord: 1.5,
    /** Sits directly on top of the centre of the wing (z = -0.95) and rises 1.45 m straight up to z = -2.40. */
    base: { x: -0.68, z: -0.95 },
    tip: { x: -0.68, z: -2.4 },
    rudder: { chordFraction: 0.82, maxDeflection: 25 * DEG },
  },

  // --- Compact tailless-boom envelope (propeller shaft boss +1.02 m to rear-edge wing elevator TE -2.50 m) ---
  fuselage: {
    length: 3.52,
    noseX: 1.02,
    tailX: -2.5,
    maxWidth: 0.56,
    maxHeight: 1.62,
    /** Open pilot seat suspended in the forward tubular frame beneath the wing. */
    pilotEye: { x: 0.08, y: 0, z: -0.22 },
  },

  // --- Open tubular-steel tricycle undercarriage with large narrow wire-spoked wheels ---
  gear: {
    nose: { x: 0.72, y: 0, z: 1.06 },
    leftMain: { x: -0.45, y: -1.1, z: 1.06 },
    rightMain: { x: -0.45, y: 1.1, z: 1.06 },
    /** 22 in (0.56 m OD) narrow wire-spoked steerable front wheel. */
    noseWheelRadius: 0.28,
    /** 28 in (0.72 m OD) tall narrow wire-spoked rear wheels. */
    mainWheelRadius: 0.36,
    maxNoseSteer: 18 * DEG,
    retractable: false,
  },

  // --- Wing-leading-edge direct-drive two-vane diamond-paddle variable-pitch airscrew ---
  propellers: [
    {
      hub: { x: 0.86, y: 0, z: -0.84 },
      diameter: 1.98,
      blades: 2,
      rotation: 1,
    },
  ],

  restHeight: 1.0,
  bounds: { radius: 4.3, fitSize: 9.6 },
};
