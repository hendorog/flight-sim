// Piper PA-34-200 Seneca I: the sound profile. Two direct-drive Lycoming IO-360-C1E6 / LIO-360-C1E6 flat fours of
// 200 hp, each turning a two-blade 1.93 m Hartzell constant-speed propeller (the two voices unsynchronised, so
// their crank phases beat), the hydraulic gear pump and the gear warning horn, the electric stall warning horn
// (a different tone, dead with the master off), hand-operated flaps (no flap motor), vacuum and electric gyros, a
// 14 V bus, and a long cabin with the engines out on the wings either side of the front seats. Plain data.
//
// "s.N" is section N of the type's engineering data sheet (aircraft-data/pa34.md in the design work folder).

import { STEM } from '../../audio/params';
import { HP } from '../../core/math';
import type { AudioProfile, EngineSoundProfile, PropSoundProfile } from '../types';
import { PA34_GEOMETRY } from './geometry';

/** Stem gain of each of the two equal voices: together they carry the power of one (contract 3.8). */
const TWIN_VOICE_LEVEL = 0.71;

/**
 * Lycoming IO-360-C (s.4): four cylinders, firing order 1-3-2-4 at even intervals; the small timing and strength
 * differences that give a flat four its beat. The right engine (the LIO-360, turning the other way) sounds the
 * same.
 */
const ENGINE: EngineSoundProfile = {
  cylinders: 4,
  combustion: 'spark',
  firingOffsets: [0, 0.013, -0.011, 0.007],
  cylGains: [1, 0.82, 0.92, 0.76],
  // 200 hp at 2700 rpm (s.4).
  ratedPowerW: 200 * HP,
  // Manifold pressure at idle and at full throttle at sea level, inHg (s.4: about 28.5-29 at full throttle).
  mapRange: [10, 29],
  // Crankshaft speed while the starter turns an engine that has not caught.
  crankRpm: 170,
  idleLopeRpm: 1000,
  // The exhaust resonators: a short stack under each cowl (s.12), a bigger engine than the C172S's.
  exhaust: [
    { hz: 105, perRps: 1.15, perLoad: 0, q: 3.5, gain: 1.5 },
    { hz: 280, perRps: 0, perLoad: 55, q: 4, gain: 1.1 },
    { hz: 760, perRps: 0, perLoad: 160, q: 5, gain: 0.58 },
  ],
  // Direct drive.
  gearRatio: 1,
  level: TWIN_VOICE_LEVEL,
};

const PROP: PropSoundProfile = {
  // Hartzell HC-C2YK, two blades (s.5).
  blades: 2,
  diameterM: PA34_GEOMETRY.propellers[0].diameter,
  // Thrust giving propLoad = 1 for one propeller: a 75 % power cruise (about 112 kW at 160 KTAS, efficiency 0.82:
  // ~1100 N).
  cruiseThrustN: 1100,
  level: TWIN_VOICE_LEVEL,
};

export const PA34_AUDIO: AudioProfile = {
  // Left engine first, as AircraftState.engines.
  engines: [
    { engine: ENGINE, prop: PROP },
    { engine: ENGINE, prop: PROP },
  ],
  // 14 V system (s.9): the starter, the pumps, the turn coordinator, the gear pump and the horns work above this.
  busPoweredV: 10,
  // Electric: two lift-detector vanes on the left wing switch a horn behind the panel; dead with the master off
  // (s.9). A different tone from the gear horn.
  stallWarner: { kind: 'electric', baseHz: 2800, sweepHz: 0, needsBus: true },
  // Hand flaps on a floor lever (s.2.1): no motor.
  flapMotor: false,
  flapMaxRad: PA34_GEOMETRY.wing.flap.maxDeflection,
  // The electric hydraulic power pack in the nose and the gear warning horn (s.3); the handbook gives no pitch or
  // rate, so the framework's horn defaults stand.
  gear: { pump: true, warningHorn: true, warningKind: 'horn' },
  gyros: 'vacuum+electric',
  // Interior: a long cabin, the engines out on the wings beside the front seats: less of the engines' upper
  // harmonics through the cabin walls than from a nose engine, the propellers' blade passage stronger (the tips
  // pass close to the side windows), a lower cabin resonance in the larger box.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 700, gain: 0.85 },
      { stem: STEM.prop, lowpassHz: 1300, gain: 0.72 },
      { stem: STEM.airframe, lowpassHz: 2100, gain: 0.4 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 105, gainDb: 6, q: 1.2 },
      { type: 'peaking', hz: 200, gainDb: 3, q: 1.5 },
    ],
    // Full power on the ground inside the C172S's window (-17 .. -9 dBFS RMS at volume 1, tests/aircraft/pa34.test.ts).
    level: 0.62,
  },
  // Exterior: the raw sources (the cabin stem is inaudible outside), then propagation.
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 1.0 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.15 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
    ],
    level: 1.2,
  },
};
