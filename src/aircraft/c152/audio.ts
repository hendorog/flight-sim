// Cessna 152 (1978 model): the sound profile. The C172S's voices (audio from the C172S profile, contract 5.1)
// for the smaller installation: a direct-drive Lycoming O-235-L2C flat four of 110 hp turning a two-blade
// 1.75 m fixed-pitch propeller, the pneumatic reed stall warner in the upper left of the cabin, the electric
// flap motor in the right wing, vacuum and electric gyros, and a cabin smaller and closer to the engine. Plain data.
//
// "s.N" is section N of the type's engineering data sheet (aircraft-data/c152.md in the design work folder).

import { STEM } from '../../audio/params';
import { HP } from '../../core/math';
import type { AudioProfile } from '../types';
import { C152_GEOMETRY } from './geometry';

const PROP = C152_GEOMETRY.propellers[0];

export const C152_AUDIO: AudioProfile = {
  engines: [
    {
      // Lycoming O-235-L2C (s.4): four cylinders, firing order 1-3-2-4 at even intervals; the small timing and
      // strength differences that give a flat four its beat, a little different from the IO-360's.
      engine: {
        cylinders: 4,
        combustion: 'spark',
        firingOffsets: [0, 0.012, -0.012, 0.006],
        cylGains: [1, 0.84, 0.9, 0.78],
        // 110 hp at 2550 rpm (TCDS 3A19).
        ratedPowerW: 110 * HP,
        // Manifold pressure at idle and at full throttle at sea level, inHg (load for the sound; no gauge on the type).
        mapRange: [9, 28.8],
        // Crankshaft speed while the starter turns an engine that has not caught (a smaller engine: a little faster).
        crankRpm: 180,
        idleLopeRpm: 1100,
        // The exhaust resonators: a shorter tailpipe and a smaller muffler than the C172S's sound a little higher.
        exhaust: [
          { hz: 110, perRps: 1.2, perLoad: 0, q: 3.5, gain: 1.5 },
          { hz: 290, perRps: 0, perLoad: 55, q: 4, gain: 1.1 },
          { hz: 780, perRps: 0, perLoad: 170, q: 5, gain: 0.6 },
        ],
        // Direct drive.
        gearRatio: 1,
        level: 1,
      },
      prop: {
        // McCauley 1A103/TCM6958, two blades (s.5).
        blades: 2,
        diameterM: PROP.diameter,
        // Thrust giving propLoad = 1: a 75 % power cruise of the 152 (about 62 kW at 100 KTAS, efficiency 0.8:
        // ~950 N; static full power ~1500 N).
        cruiseThrustN: 950,
        level: 1,
      },
    },
  ],
  // 28 V system (s.9): the flap motor, starter, fan and electric gyro work above this bus voltage.
  busPoweredV: 20,
  // Pneumatic: a slot in the left wing leading edge blows a reed horn by the windshield (s.9). It needs no
  // electricity, so it sounds with the master off (the C172S's keeps its bus dependence for its goldens).
  stallWarner: { kind: 'reed', baseHz: 1900, sweepHz: 900, needsBus: false },
  flapMotor: true,
  flapMaxRad: C152_GEOMETRY.wing.flap.maxDeflection,
  gear: null,
  gyros: 'vacuum+electric',
  // Interior: the 152's cabin is narrower and its firewall is closer to the occupants than the 172's: the engine
  // and the propeller pass a little more of their upper harmonics, the smaller box resonates a little higher.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 820, gain: 0.9 },
      { stem: STEM.prop, lowpassHz: 1200, gain: 0.6 },
      { stem: STEM.airframe, lowpassHz: 2200, gain: 0.35 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 120, gainDb: 6, q: 1.2 },
      { type: 'peaking', hz: 215, gainDb: 3, q: 1.5 },
    ],
    // Full power on the ground inside the C172S's window (-17 .. -9 dBFS RMS at volume 1, tests/aircraft/c152.test.ts).
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
