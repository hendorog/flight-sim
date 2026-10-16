// MD 500E (369E): the sound profile, the first turbine helicopter voice. One Rolls-Royce (Allison) 250-C20B
// turboshaft right behind the cabin (no combustion pulses: the gas producer's high whine, the burner and the
// exhaust out of the tail cone, the starter-generator, the igniters, light-off) driving through a freewheel a main
// transmission overhead (its mesh) and a five-blade fully articulated rotor at 492 rpm: 5 x 492 / 60 = 41 Hz blade
// passage, the 500's quick, buzzing beat (through the `prop` voice: the rotor rpm is the propeller rpm the flight
// model publishes); and a two-blade tail rotor at about 2930 rpm, 98 Hz, slapping with its loading (the tail-rotor
// channel, AudioProfile.tailRotor). ENGINE OUT / low-rotor warning horn (the `horn` parameter, keyed on
// RotorcraftState.turboshaft.engineOutHorn). No flaps, no retractable gear, a 28 V bus. Plain data.
//
// Sources (tags as facts.ts; docs/md500-sources.md):
//   N1 100 % = 50 970 rpm, 849.5 Hz shaft rate (EASA IM.E.052 p15) ............... MD500_N1_100_RPM   P
//   250-C20B 313 kW (420 shp) rating (EASA IM.E.052 p9) .......................... MD500_ENGINE_RATED_W P
//   N2 / Nr 12.594, Nr 492 rpm normal (RFM 2-4, TCDS H3WE p12) ................... rotor.engineRatio (T2: MD500_ENGINE_RATIO)
//   five main blades, R 4.023 m; two tail blades, R 0.699 m (dimensions.ts) ...... rotor.main / rotor.tail
//   tail rotor 2933 rpm at 492 Nr (ratio 5.96) ................................... rotor.tailRatio (T2: MD500_TAIL_RATIO) ESTIMATE
//   starter-generator on N1, pad ratio 0.2361 (EASA IM.E.052 p10) ................ MD500_GENERATOR_PAD_RATIO P
//   ENGINE OUT light and audible horn below 55 % N1 or 468 rpm Nr, external horn in the cabin plus the ICS
//     (RFM Fig 3-1, 3-3; 4-13) .................................................... stallWarner (the horn)
//   the igniter's firing is heard on the RE-IGN test (RFM 4-13) .................. turbine.ignitor
// ESTIMATE (no source): the orders and strengths of the whine (the 250's blade and tooth counts are not published:
// the tones are put where its whine is heard, a strong one near 5 kHz), the roar, the commutator bar count (24),
// the transmission mesh (about 1.36 kHz at 492 rpm), the igniters' rate, the horn's pitch, the tail rotor's hover
// thrust and slap, the cabin.
//
// Until T2 publishes EngineState.ng and the turboshaft state, the gas producer is silent here (the stub definition
// still runs the S269's piston engine) and gearRatio follows the stub's engineRatio (plan 2.3).

import { STEM } from '../../audio/params';
import { DEG, LB } from '../../core/math';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from '../types';
import { MD500_BUS_DEAD_VOLTS, MD500_ENGINE_RATED_W, MD500_GENERATOR_PAD_RATIO, MD500_N1_100_RPM } from './facts';
import { MD500_ROTORCRAFT as rotor } from './rotorcraft';

/**
 * Fuel flow at 100 % N1, sea level ISA, kg/s: about 270 lb/h. ESTIMATE: the 420 shp rating at a specific fuel
 * consumption of 0.65 lb/shp/h (a typical 250-C20B figure; the RFM gives none, MD's operating-cost average is 184 lb/h
 * in cruise). It only scales the burner's roar.
 */
const FUEL_FLOW_100 = (270 * LB) / 3600;
/** Commutator bars of the starter-generator (ESTIMATE): its whine at 0.2361 x 24 = 5.67 times the N1 shaft rate. */
const COMMUTATOR_BARS = 24;
/**
 * Main-rotor thrust giving propLoad = 1: the hover at about 2700 lb, 12 kN. DERIVED (weight ESTIMATE between the
 * sample empty weight 1510 lb plus pilot and fuel and the 3000 lb maximum).
 */
const HOVER_THRUST_N = 12_000;
/**
 * Tail-rotor thrust in the hover, N: main-rotor torque / tail arm. About 210 kW to the main rotor at 492 rpm
 * (51.5 rad/s) is 4.1 kN m; the tail rotor at STA 284 is 184 in (4.67 m) behind the mast: 880 N. DERIVED (power ESTIMATE).
 */
const TAIL_HOVER_THRUST_N = 880;

const ENGINE: EngineSoundProfile = {
  // A turbine has no cylinders: the field is the powerplant's, not read.
  cylinders: 4,
  combustion: 'turbine',
  firingOffsets: [0, 0, 0, 0],
  cylGains: [1, 1, 1, 1],
  ratedPowerW: MD500_ENGINE_RATED_W,
  mapRange: null,
  crankRpm: 0,
  idleLopeRpm: 0,
  exhaust: [],
  turbine: {
    ngRpm: MD500_N1_100_RPM,
    fuelFlowRef: FUEL_FLOW_100,
    tones: [
      // The gas producer's once-per-revolution tone: 850 Hz at 100 % N1.
      { order: 1, gain: 0.07, band: 0 },
      // The compressor's whine, the 250's signature, right behind the cabin: 5.1 kHz at 100 % N1 (3.3 kHz at ground
      // idle, 64 %), a weaker tone at 3.4 kHz below it and two higher ones.
      { order: 4, gain: 0.09, band: 0.4 },
      { order: 6, gain: 0.22, band: 0.3 },
      { order: 9, gain: 0.1, band: 0.5 },
      { order: 14, gain: 0.05, band: 0.7 },
    ],
    // The burner and the exhaust out of the top of the tail cone: a lighter roar than a PT6's (420 against 675-1200 shp).
    roar: [
      { hz: 140, perLoad: 70, q: 0.7, gain: 1.0 },
      { hz: 480, perLoad: 420, q: 0.8, gain: 0.7 },
      { hz: 1900, perLoad: 1400, q: 0.9, gain: 0.3 },
    ],
    // The 150 A starter-generator on the N1 accessory pad: its commutator whine, about 720 Hz at 15 % N1.
    starter: { perNgRev: MD500_GENERATOR_PAD_RATIO * COMMUTATOR_BARS, level: 0.06 },
    // The main transmission overhead: a mesh tone at 166 x the rotor's rate, 1.36 kHz at 492 rpm, at full strength
    // from about 8 rev/s of the rotor (480 rpm) up.
    gearMesh: { perPropRev: 166, level: 0.022 },
    gearMeshFullRps: 8,
    lightOff: 0.35,
    // The igniter fires through the start (and on the RE-IGN test): a dry snap, about four a second.
    ignitor: { perSecond: 4, level: 0.05 },
  },
  // Engine output shaft (N2) revolutions per rotor revolution.
  gearRatio: rotor.engineRatio,
  level: 1,
};

const ROTOR: PropSoundProfile = {
  // Five blades, 8.05 m: tip Mach 0.61 in the hover at 492 rpm.
  blades: rotor.main.blades as 5,
  diameterM: rotor.main.radius * 2,
  cruiseThrustN: HOVER_THRUST_N,
  level: 1,
};

export const MD500_AUDIO: AudioProfile = {
  engines: [{ engine: ENGINE, prop: ROTOR }],
  // 28 V: the starter-generator, the ENGINE OUT horn and the igniters work above this.
  busPoweredV: MD500_BUS_DEAD_VOLTS,
  // The ENGINE OUT / low-rotor warning horn (RFM Fig 3-1): a steady electric horn on the bus. Pitch ESTIMATE.
  stallWarner: { kind: 'electric', baseHz: 700, sweepHz: 0, needsBus: true },
  flapMotor: false,
  // No flaps: any non-zero value (the wind-noise mapping divides by it; the flaps never move).
  flapMaxRad: 30 * DEG,
  gear: null,
  // The attitude gyro and the turn indicator are electric (the GYRO circuit breaker, research section 11).
  gyros: 'electric',
  // Interior: a small cabin with the engine right behind the rear bulkhead and the transmission overhead: the
  // whine and the mesh reach the seats well (the turbine stem passes up to 4 kHz), the rotor's 41 Hz beat and the
  // tail rotor's 98 Hz come through the airframe, the doors and the bubble let a lot of wind in.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 4000, gain: 0.6 },
      { stem: STEM.prop, lowpassHz: 900, gain: 1.0 },
      { stem: STEM.airframe, lowpassHz: 2200, gain: 0.45 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 41, gainDb: 4, q: 1.0 },
      { type: 'peaking', hz: 98, gainDb: 3, q: 1.4 },
    ],
    // Hover inside the C172S's full-power window (-17 .. -9 dBFS RMS at volume 1, tests/audio/md500.test.ts).
    level: 0.75,
  },
  // Exterior: the raw sources, the rotors loudest (a 500 is heard by its buzz and its tail rotor long before its whine).
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 0.8 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.3 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
    ],
    level: 1.1,
  },
  // Two blades, R 0.699 m, at rotor.tailRatio x Nr (5.96 x 492 = 2933 rpm, 98 Hz, tip Mach 0.63 once T2 sets it).
  tailRotor: {
    blades: rotor.tail.blades as 2,
    diameterM: rotor.tail.radius * 2,
    ratio: rotor.tailRatio,
    hoverThrustN: TAIL_HOVER_THRUST_N,
    slap: 0.9,
    level: 0.8,
  },
};
