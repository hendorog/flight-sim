// PLACEHOLDER four-cylinder/three-blade synthesis. No Schweizer recording or spectral calibration.
import type { AudioProfile } from '../types';
import { C152_AUDIO as base } from '../c152/audio';
import { S269_ROTORCRAFT as rotor } from './rotorcraft';
import { S269_REFERENCE as V } from './reference';
import { MAIN_ROTOR_BLADES } from './dimensions';
export const S269_AUDIO: AudioProfile = {
  ...base, flapMotor: false, busPoweredV: 18, gyros: 'none',
  engines: [{ engine: { ...base.engines[0].engine, ratedPowerW: V.continuousPower, gearRatio: rotor.engineRatio },
    prop: { blades: MAIN_ROTOR_BLADES, diameterM: rotor.main.radius * 2, cruiseThrustN: 7000, level: 1 } }],
};
