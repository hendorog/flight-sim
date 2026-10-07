// Diamond DA20-C1: the sound profile. The C172S's voices for this installation: a direct-drive, fuel-injected
// Continental IO-240-B flat four of 125 hp turning a two-blade 1.75 m fixed-pitch wooden propeller close in front
// of a bubble canopy, the pneumatic reed stall warner in the left of the panel, the electric flap actuator, vacuum
// and electric gyros on a 14 V system. Plain data.
//
// "s.N" is section N of the type's engineering data sheet (aircraft-data/da20.md in the design work folder).

import { STEM } from '../../audio/params';
import { HP } from '../../core/math';
import type { AudioProfile } from '../types';
import { DA20_GEOMETRY } from './geometry';

const PROP = DA20_GEOMETRY.propellers[0];

export const DA20_AUDIO: AudioProfile = {
  engines: [
    {
      // Continental IO-240-B (s.4): four cylinders, firing order 1-3-2-4 at even intervals; the small timing and
      // strength differences that give a flat four its beat.
      engine: {
        cylinders: 4,
        combustion: 'spark',
        firingOffsets: [0, 0.011, -0.013, 0.007],
        cylGains: [1, 0.86, 0.92, 0.8],
        // 125 hp at 2800 rpm, take-off and continuous (AFM 2.4.1).
        ratedPowerW: 125 * HP,
        // Manifold pressure at idle and at full throttle at sea level, inHg (load for the sound; no gauge on the
        // type, 29.5 inHg rated, s.4).
        mapRange: [10, 29.5],
        // Crankshaft speed while the 12 V starter turns an engine that has not caught.
        crankRpm: 170,
        idleLopeRpm: 1100,
        // The exhaust resonators: one short stub out of the lower cowl, a little higher than the C172S's muffler.
        exhaust: [
          { hz: 115, perRps: 1.2, perLoad: 0, q: 3.5, gain: 1.5 },
          { hz: 300, perRps: 0, perLoad: 60, q: 4, gain: 1.15 },
          { hz: 800, perRps: 0, perLoad: 180, q: 5, gain: 0.65 },
        ],
        // Direct drive.
        gearRatio: 1,
        level: 1,
      },
      prop: {
        // Sensenich W69EK7-63, two blades (s.5).
        blades: 2,
        diameterM: PROP.diameter,
        // Thrust giving propLoad = 1: a 75 % cruise (about 70 kW at 125 KTAS, efficiency 0.8: ~870 N); static
        // full power ~1500 N.
        cruiseThrustN: 870,
        level: 1,
      },
    },
  ],
  // 14 V system (s.9): the flap actuator, the starter and the electric gyro work above this bus voltage.
  busPoweredV: 10,
  // Pneumatic: a hole in the left wing leading edge blows a reed horn in the left of the panel, louder as the stall
  // approaches; it needs no electricity (AFM 7.13, s.9).
  stallWarner: { kind: 'reed', baseHz: 2000, sweepHz: 900, needsBus: false },
  flapMotor: true,
  flapMaxRad: DA20_GEOMETRY.wing.flap.maxDeflection,
  gear: null,
  gyros: 'vacuum+electric',
  // Interior: a thin composite tub under a big acrylic bubble close behind the engine: less low-frequency mass to
  // stop the engine and the propeller than a metal cabin, and the canopy rings in the upper mid range.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 900, gain: 0.9 },
      { stem: STEM.prop, lowpassHz: 1300, gain: 0.65 },
      { stem: STEM.airframe, lowpassHz: 2600, gain: 0.4 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 125, gainDb: 5, q: 1.2 },
      { type: 'peaking', hz: 420, gainDb: 2.5, q: 1.4 },
    ],
    // Full power on the ground inside the C172S's window (-17 .. -9 dBFS RMS at volume 1, tests/aircraft/da20.test.ts).
    level: 0.66,
  },
  // Exterior: the raw sources (the cabin stem is inaudible outside), then propagation.
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 1.0 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.1 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
    ],
    level: 1.2,
  },
};
