// Pilatus PC-12/47: the sound profile. One Pratt & Whitney Canada PT6A-67B free turbine (1200 shp; no combustion
// pulses: the gas generator's whine, the burner and exhaust roar, the starter-generator, the reduction gearbox, the
// igniters on a start) driving a Hartzell HC-E4A-3D four-blade 2.67 m propeller governed at a fixed 1700 rpm:
// 4 x 1700 / 60 = 113.3 Hz blade passage, the PC-12's deep drone; with beta and reverse, the growl of the disc in
// reverse. A retractable hydraulic gear (its power pack and its warning horn), electric Fowler flaps, a stick
// shaker (the stall warning: no separate horn), an aural overspeed warning at Vmo / Mmo, the CAWS chimes, a 28 V
// bus, a pressurised and insulated cabin. Plain data.
//
// Sources (tags as facts.ts; docs/pc12-sources.md):
//   Ng 100 % = 37 468 rpm, 624.5 Hz shaft rate (TCDS note; ETCDS IV.2) ............ PC12_NG_100_RPM
//   1200 shp take-off rating (ETCDS II.5) ......................................... PT6A_67B_RATED_W
//   propeller 1700 rpm, gear ratio 29 894 / 1700 (TCDS C.III.4.3, POH 2-6) ......... PC12_GEAR_RATIO
//   four blades, 2.67 m (TCDS C.III.4.2) .......................................... PC12_PROP
//   full reverse -17.5 deg at the 42 in station (TCDS C.III.4.2) .................. REVERSE_PITCH_DEG
//   Vmo 236 KIAS / Mmo 0.48 aural overspeed warning (placard; TCDS) ............... PC12_OVERSPEED
//   red CAWS / CAS message: a triple chime; amber: a single chime ................. 47E-PROXY sect. 3 (CAS description)
//   fuel flow 634 lb/h at 36.9 psi (MCP, SL ISA; 47E-PROXY Fig 5-2-31) ............ FUEL_FLOW_100 (DERIVED, below)
// ESTIMATE (no source): the orders and strengths of the whine (the PT6A's blade and tooth counts are not published,
// as for the C208: the tones are put where a PT6 is heard), the roar bands, the starter-generator's commutator, the
// gearbox mesh, the igniters' rate (2.5 snaps a second), the reverse growl's strength, the shaker's rate (22 Hz),
// the clacker's rate (8 strokes a second), the chime's pitch, the gear horn and the pump's pitch, the cabin.
//
// The PC-12/47 against the C208 (the voice it was tuned from, c208/audio.ts): a gas generator 0.1 % slower; one more
// axial compressor stage (four, ETCDS II.1), so one more tone in the whine (order 7, 4.4 kHz at 100 % Ng); 1200
// against 675 shp, so a louder roar and a heavier burner (roar gains about +2 dB); four blades at 1700 rpm (113 Hz)
// against three at 1900 (95 Hz); a quieter, pressurised cabin.

import { STEM } from '../../audio/params';
import { DEG, LB } from '../../core/math';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from '../types';
import { PC12_BUS_DEAD_VOLTS, PC12_GEAR_RATIO, PC12_NG_100_RPM, PC12_OVERSPEED, PT6A_67B_RATED_W } from './facts';
import { PC12_PROP, PC12_WING } from './geometry';

/**
 * Fuel flow at 100 % Ng, sea level ISA, kg/s: about 730 lb/h. DERIVED (ESTIMATE): 634 lb/h at the 1000 shp MCP
 * (47E-PROXY Fig 5-2-31, SL ISA), scaled to the 1200 shp take-off power with the PT6's falling specific consumption
 * (power^0.8): 634 x 1.2^0.8 = 732 lb/h. It only scales the burner's roar.
 */
const FUEL_FLOW_100 = (730 * LB) / 3600;
/** Blade angle of full reverse at the 42 in (0.80 R) station, deg (TCDS C.III.4.2: -17.5). */
export const REVERSE_PITCH_DEG = -17.5;
/**
 * Thrust giving propLoad = 1: a cruise at the 1000 shp MCP and about 265 KTAS (47E-PROXY Fig 5-2-31 at FL160),
 * propulsive efficiency 0.85: 745.7 kW x 0.85 / 136 m/s = 4.66 kN. DERIVED (efficiency ESTIMATE).
 */
const CRUISE_THRUST_N = 4700;

const ENGINE: EngineSoundProfile = {
  // A turbine has no cylinders: the field is the powerplant's (inherited from the piston definition), not read.
  cylinders: 4,
  combustion: 'turbine',
  firingOffsets: [0, 0, 0, 0],
  cylGains: [1, 1, 1, 1],
  ratedPowerW: PT6A_67B_RATED_W,
  mapRange: null,
  crankRpm: 0,
  idleLopeRpm: 0,
  exhaust: [],
  turbine: {
    ngRpm: PC12_NG_100_RPM,
    fuelFlowRef: FUEL_FLOW_100,
    tones: [
      // The rotor's once-per-revolution tone: 624 Hz at 100 % Ng, a low note under the whine.
      { order: 1, gain: 0.08, band: 0 },
      // The compressor's whine: 3.1 kHz at 100 % Ng (1.7 kHz at ground idle, 52-61 % Ng), and the fourth axial
      // stage's tone above it, 4.4 kHz.
      { order: 5, gain: 0.18, band: 0.35 },
      { order: 7, gain: 0.09, band: 0.45 },
      { order: 12, gain: 0.11, band: 0.5 },
      { order: 18, gain: 0.05, band: 0.7 },
    ],
    // The burner and the two exhaust stacks (one each side of the nose): a low roar and a hiss above it, both
    // growing and brightening with power; heavier than the C208's (1200 against 675 shp).
    roar: [
      { hz: 105, perLoad: 60, q: 0.7, gain: 1.75 },
      { hz: 400, perLoad: 380, q: 0.8, gain: 1.1 },
      { hz: 1650, perLoad: 1300, q: 0.9, gain: 0.42 },
    ],
    // The 300 A starter-generator (GEN 1) on the accessory gearbox: a commutator whine of about 840 Hz at 15 % Ng.
    starter: { perNgRev: 9, level: 0.06 },
    // The second planetary stage of the reduction gearbox: about 2.3 kHz at 1700 propeller rpm, faint.
    gearMesh: { perPropRev: 80, level: 0.009 },
    lightOff: 0.5,
    // The igniters snap on a start while the starter turns the gas generator.
    ignitor: { perSecond: 2.5, level: 0.15 },
  },
  // Power-turbine revolutions per propeller revolution (29 894 : 1700).
  gearRatio: PC12_GEAR_RATIO,
  level: 1,
};

const PROP: PropSoundProfile = {
  // Hartzell HC-E4A-3D, four blades, 2.67 m: tip Mach 0.70 standing still at 1700 rpm.
  blades: PC12_PROP.blades,
  diameterM: PC12_PROP.diameter,
  cruiseThrustN: CRUISE_THRUST_N,
  // The blades pass the chin intake and the two exhaust stacks once a revolution: a growl, a little shallower than
  // the Caravan's (four blades share the disturbance).
  growl: 0.25,
  // Reverse: the disc churning its own wake, a hard roar beaten at the blade passage.
  reverse: { growl: 1.1, fullPitchDeg: REVERSE_PITCH_DEG },
  level: 1,
};

export const PC12_AUDIO: AudioProfile = {
  engines: [{ engine: ENGINE, prop: PROP }],
  // 28 V system: the starter-generator, the shaker, the clacker, the CAWS and the flap motor work above this.
  busPoweredV: PC12_BUS_DEAD_VOLTS,
  // No stall horn: the stall warning is the stick shaker (47E-PROXY 7-21; the 47E's "Stall" voice belongs to its
  // FAS, not to the /47's CAWS). AGENT choice.
  stallWarner: { kind: 'none', baseHz: 0, sweepHz: 0, needsBus: true },
  flapMotor: true,
  flapMaxRad: PC12_WING.flap.detentsDeg[PC12_WING.flap.detentsDeg.length - 1] * DEG,
  // The hydraulic power pack runs while a leg moves; the gear warning is a beeping horn. ESTIMATE pitch and rate.
  gear: { pump: true, warningHorn: true, warningKind: 'horn', warningHz: 520, warningPerMinute: 120, pumpHz: 400 },
  // No vacuum system: the attitude and heading instruments run on the inverter (CAWS INVERTER), the turn rate on DC.
  gyros: 'electric',
  // Interior: a long nose, a firewall and a pressurised, insulated cabin: the whine reaches the cockpit only below
  // about 2 kHz, the propeller's 113 Hz drone dominates, the cabin resonates low.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 2000, gain: 0.7 },
      { stem: STEM.prop, lowpassHz: 1200, gain: 0.8 },
      { stem: STEM.airframe, lowpassHz: 1900, gain: 0.35 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 113, gainDb: 5, q: 1.2 },
      { type: 'peaking', hz: 227, gainDb: 3, q: 1.5 },
    ],
    // Full power on the ground inside the C172S's window (-17 .. -9 dBFS RMS at volume 1, tests/audio/pc12.test.ts).
    level: 0.6,
  },
  // Exterior: the raw sources (the cabin stem is inaudible outside), then propagation. The -67's roar is louder.
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 1.1 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.1 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
    ],
    level: 1.0,
  },
  // The stick shaker: an eccentric motor on the column, rattling it at about 22 Hz. ESTIMATE.
  stickShaker: { hz: 22, level: 1.4 },
  // The aural overspeed warning above Vmo 236 KIAS or Mmo 0.48: a clacker, 8 strokes a second (ESTIMATE rate).
  overspeedWarning: { kias: PC12_OVERSPEED.kias, mach: PC12_OVERSPEED.mach, perSecond: 8, level: 1.8 },
  // CAWS: a triple chime with a new red warning, a single chime with a new amber caution (47E-PROXY). Pitch ESTIMATE.
  caws: { hz: 1047, level: 1.2 },
};
