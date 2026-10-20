// Lockheed AH-56A Cheyenne: sound profile (plain data). SCAFFOLD STUB (owner after the scaffold: AU): the MD 500E's voice
// on the stub rotor (base.ts: the MD 500E rotor with four blades; 15.62 m once AG lands it) and tail rotor. AU's rule (plan revision 2, section 7.7):
// every consistency-checked number is imported from the definition, powerplant or facts, never typed in; the pusher
// channel (AudioProfile.pusher) stays absent until def.pusher exists.
import type { AudioProfile } from '../types';
import { MD500_AUDIO as base } from '../md500/audio';
import { AH56_ROTORCRAFT as rotor } from './rotorcraft';

export const AH56_AUDIO: AudioProfile = {
  ...base,
  engines: [{ engine: { ...base.engines[0].engine, gearRatio: rotor.engineRatio },
    prop: { ...base.engines[0].prop, blades: rotor.main.blades as 4, diameterM: rotor.main.radius * 2 } }],
  tailRotor: { ...base.tailRotor!, blades: rotor.tail.blades as 2, diameterM: rotor.tail.radius * 2, ratio: rotor.tailRatio },
};
