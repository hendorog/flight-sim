// Richard Pearse 1903 Monoplane: sound profile.
//
// Captures the distinctive slow, uneven chug of Pearse's unmuffled cast-iron double-acting horizontal twin (450 rpm
// idle to 1150 rpm full power, two stub pipes barking into the open air), the low-frequency whoosh of the wide 1.98 m
// two-blade paddle airscrew, and the open-air rush of wind through wire rigging and bamboo struts (interior and
// exterior share an open-cockpit acoustic balance). Plain data.

import { STEM } from '../../audio/params';
import { HP } from '../../core/math';
import type { AudioProfile } from '../types';
import { PEARSE_GEOMETRY } from './geometry';

const PROP = PEARSE_GEOMETRY.propellers[0];

export const PEARSE_AUDIO: AudioProfile = {
  engines: [
    {
      engine: {
        // Two double-acting cylinders = 4 combustion events per 720 deg cycle, with strong front/back chamber asymmetry!
        cylinders: 4,
        combustion: 'spark',
        firingOffsets: [0, 0.032, -0.018, 0.026],
        cylGains: [1.0, 0.68, 0.92, 0.64],
        ratedPowerW: 24 * HP,
        mapRange: [11, 29.2],
        crankRpm: 110,
        idleLopeRpm: 680,
        // Short unmuffled cast-iron stub pipes: deep chuffing fundamental plus metallic cast-iron bark.
        exhaust: [
          { hz: 68, perRps: 1.4, perLoad: 12, q: 2.8, gain: 1.8 },
          { hz: 195, perRps: 0.8, perLoad: 45, q: 3.4, gain: 1.35 },
          { hz: 540, perRps: 0, perLoad: 140, q: 4.2, gain: 0.75 },
        ],
        gearRatio: 1,
        level: 1.05,
      },
      prop: {
        blades: 2,
        diameterM: PROP.diameter,
        // ~480 N thrust in a 46 kt cruise, ~750 N static.
        cruiseThrustN: 480,
        level: 0.95,
      },
    },
  ],
  busPoweredV: 9.5,
  // Airflow reed / rigging whistle near the stall, independent of the battery.
  stallWarner: { kind: 'reed', baseHz: 920, sweepHz: 420, needsBus: false },
  flapMotor: false,
  flapMaxRad: PEARSE_GEOMETRY.wing.flap.maxDeflection,
  gear: null,
  gyros: 'electric',
  // Open bamboo frame: no enclosed cabin muffling — the pilot sits right behind the twin cylinders in the slipstream!
  cabin: {
    routes: [
      { stem: STEM.engine, lowpassHz: 2600, gain: 0.95 },
      { stem: STEM.prop, lowpassHz: 2400, gain: 0.85 },
      { stem: STEM.airframe, lowpassHz: 3200, gain: 0.65 },
      { stem: STEM.cabin, lowpassHz: 0, gain: 0.5 },
    ],
    bus: [
      { type: 'peaking', hz: 95, gainDb: 4, q: 1.1 },
      { type: 'peaking', hz: 320, gainDb: 2.5, q: 1.4 },
    ],
    level: 0.75,
  },
  exterior: {
    routes: [
      { stem: STEM.engine, lowpassHz: 0, gain: 1.05 },
      { stem: STEM.prop, lowpassHz: 0, gain: 1.0 },
      { stem: STEM.airframe, lowpassHz: 0, gain: 0.45 },
    ],
    level: 1.15,
  },
};
