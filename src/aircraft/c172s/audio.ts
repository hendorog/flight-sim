// Cessna 172S: the sound profile. A direct-drive flat four with a two-blade propeller, a pneumatic reed stall
// warner, an electric flap motor, vacuum and electric gyros, and the cabin / exterior mix. Plain data.
//
// The numbers of the sound live HERE: audio/mapping.ts and audio/mix.ts take their Cessna 172S constants from
// this profile, and the synthesis worklet's built-in voice is this profile (audio/synthSource.ts).

import { STEM } from '../../audio/params';
import { C172 } from '../../core/c172';
import type { AudioProfile } from '../types';

export const C172S_AUDIO: AudioProfile = {
  engines: [
    {
      // Lycoming IO-360-L2A. The worklet's flat four: firing order 1-3-2-4 at even 180-degree intervals; small
      // per-cylinder timing and strength differences (unequal exhaust runners, mixture distribution) give the
      // characteristic lumpy beat.
      engine: {
        cylinders: 4,
        combustion: 'spark',
        firingOffsets: [0, 0.014, -0.01, 0.008],
        cylGains: [1, 0.8, 0.93, 0.74],
        ratedPowerW: C172.engine.ratedPower,
        // Manifold pressure at idle and at full throttle at sea level in the flight model, inHg.
        mapRange: [8.5, 28.8],
        // Crankshaft speed while the starter is turning an engine that has not caught, rev/min (typical 150-200).
        crankRpm: 170,
        idleLopeRpm: 1100,
        // The three exhaust resonators: the tailpipe quarter-wave (shifts a little with gas temperature / flow)
        // and two that brighten with load.
        exhaust: [
          { hz: 95, perRps: 1.2, perLoad: 0, q: 3.5, gain: 1.6 },
          { hz: 260, perRps: 0, perLoad: 60, q: 4, gain: 1.1 },
          { hz: 720, perRps: 0, perLoad: 180, q: 5, gain: 0.6 },
        ],
        gearRatio: 1,
        level: 1,
      },
      prop: {
        blades: C172.prop.blades,
        diameterM: C172.prop.diameter,
        // Thrust giving propLoad = 1: the flight model's thrust in a 75% power cruise (~1400 N at 110 KIAS;
        // static full power ~2200 N, pattern ~1100 N, approach ~600 N, idle ~250 N).
        cruiseThrustN: 1400,
        level: 1,
      },
    },
  ],
  // The stall horn, flap motor, starter, fan and electric gyro work above this bus voltage (28 V system).
  busPoweredV: 20,
  // The reed needs no electricity in the aeroplane; the simulator silences it with the bus, and that is kept.
  stallWarner: { kind: 'reed', baseHz: 1900, sweepHz: 900, needsBus: true },
  flapMotor: true,
  flapMaxRad: C172.wing.flap.maxDeflection,
  gear: null,
  gyros: 'vacuum+electric',
  // Interior: the cabin transmits the exhaust and propeller mostly below ~1 kHz, and the airframe panels and
  // cabin volume resonate around 100-200 Hz. The engine and propeller are the loudest things in a C172 cockpit
  // (~95 dBA at full power, ~80 dBA at idle); airframe wind noise is well below them until high speed; the stall
  // horn must cut through at approach power.
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 750, gain: 0.9 },
      { stem: STEM.prop, lowpassHz: 1100, gain: 0.6 },
      { stem: STEM.airframe, lowpassHz: 2200, gain: 0.35 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 1.0 },
    ],
    bus: [
      { type: 'peaking', hz: 105, gainDb: 6, q: 1.2 },
      { type: 'peaking', hz: 190, gainDb: 3, q: 1.5 },
    ],
    // Full-power static run-up ~ -12 dBFS RMS / ~ -4 dBFS peak at volume 1, so the limiter only ever touches
    // transients (measured by tests/audio/levels.test.ts). The earlier -18 dBFS target left idle near -40 dBFS,
    // inaudible on ordinary speakers.
    level: 0.7,
  },
  // Exterior: the raw sources (the cabin stem is inaudible outside), then propagation. Full power heard from the
  // chase camera (15 m) ~ -12 dBFS RMS at volume 1.
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 1.0 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.1 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.25 },
    ],
    level: 1.2,
  },
};
