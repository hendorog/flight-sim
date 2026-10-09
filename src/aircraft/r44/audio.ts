// PLACEHOLDER synthesis: six-cylinder IO-540, two-blade main rotor. No R44 sound recording/calibration.
import type { AudioProfile } from '../types';
import { C152_AUDIO } from '../c152/audio';
import { R44_ROTORCRAFT as rotor } from './rotorcraft';
import { R44_REFERENCE as V } from './reference';
export const R44_AUDIO: AudioProfile = {
  ...C152_AUDIO, flapMotor: false, busPoweredV: 18, gyros: 'none',
  stallWarner: { kind: 'electric', baseHz: 800, sweepHz: 0, needsBus: true },
  engines: [{ engine: { ...C152_AUDIO.engines[0].engine, cylinders: 6,
    firingOffsets: [0, 0, 0, 0, 0, 0], cylGains: [1, 1, 1, 1, 1, 1],
    ratedPowerW: V.takeoffPower, gearRatio: rotor.engineRatio },
    prop: { blades: 2, diameterM: rotor.main.radius * 2, cruiseThrustN: 11000, level: 1 } }],
};
