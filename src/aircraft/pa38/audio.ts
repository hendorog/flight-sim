// Piper PA-38-112 Tomahawk II: the sound profile. The C172S's voices for the type's installation: a direct-drive
// Lycoming O-235-L2C flat four of 112 hp turning a two-blade 1.83 m fixed-pitch Sensenich propeller, the electric
// stall warning horn behind the panel (dead with the master off), hand-operated flaps (no flap motor), vacuum and
// electric gyros, a 14 V bus, and a small cabin with a large glazed area close to the engine. Plain data.
//
// "s.N" is section N of the type's engineering data sheet (aircraft-data/pa38.md in the design work folder).

import { STEM } from '../../audio/params';
import { HP } from '../../core/math';
import type { AudioProfile } from '../types';
import { PA38_GEOMETRY } from './geometry';

const PROP = PA38_GEOMETRY.propellers[0];

export const PA38_AUDIO: AudioProfile = {
  engines: [
    {
      // Lycoming O-235-L2C (s.4): four cylinders, firing order 1-3-2-4 at even intervals; the small timing and
      // strength differences that give a flat four its beat (the same engine as the Cessna 152's).
      engine: {
        cylinders: 4,
        combustion: 'spark',
        firingOffsets: [0, 0.012, -0.012, 0.006],
        cylGains: [1, 0.84, 0.9, 0.78],
        // 112 hp at 2600 rpm (POH 1.3, 2.7).
        ratedPowerW: 112 * HP,
        // Manifold pressure at idle and at full throttle at sea level, inHg (load for the sound; no gauge on the type).
        mapRange: [9, 28.8],
        // Crankshaft speed while the starter turns an engine that has not caught.
        crankRpm: 180,
        idleLopeRpm: 1100,
        // The exhaust resonators: twin short stacks out of the lower cowling (s.4), a little higher than the
        // C172S's single muffler.
        exhaust: [
          { hz: 112, perRps: 1.2, perLoad: 0, q: 3.5, gain: 1.5 },
          { hz: 300, perRps: 0, perLoad: 55, q: 4, gain: 1.15 },
          { hz: 800, perRps: 0, perLoad: 170, q: 5, gain: 0.62 },
        ],
        // Direct drive.
        gearRatio: 1,
        level: 1,
      },
      prop: {
        // Sensenich 72CK-0-56, two blades (s.5).
        blades: 2,
        diameterM: PROP.diameter,
        // Thrust giving propLoad = 1: a 75 % power cruise (about 63 kW at 100 KTAS, efficiency 0.8: ~970 N; static
        // full power ~1500 N).
        cruiseThrustN: 970,
        level: 1,
      },
    },
  ],
  // 14 V system (s.9): the starter, the fuel pump, the turn coordinator and the horn work above this bus voltage.
  busPoweredV: 10,
  // Electric: the lift-detector vane in the left wing leading edge switches a horn behind the panel; it is dead
  // with the master off (POH 4.35, s.9).
  stallWarner: { kind: 'electric', baseHz: 2600, sweepHz: 0, needsBus: true },
  // Hand flaps: a lever between the seats, no motor (s.9).
  flapMotor: false,
  flapMaxRad: PA38_GEOMETRY.wing.flap.maxDeflection,
  gear: null,
  gyros: 'vacuum+electric',
  // Interior: a small cabin, most of it glass, the firewall close to the occupants: the engine and the propeller
  // pass a little more of their upper harmonics, the small box resonates a little higher.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 850, gain: 0.9 },
      { stem: STEM.prop, lowpassHz: 1250, gain: 0.62 },
      { stem: STEM.airframe, lowpassHz: 2300, gain: 0.38 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 125, gainDb: 6, q: 1.2 },
      { type: 'peaking', hz: 225, gainDb: 3, q: 1.5 },
    ],
    // Full power on the ground inside the C172S's window (-17 .. -9 dBFS RMS at volume 1, tests/aircraft/pa38.test.ts).
    level: 0.7,
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
