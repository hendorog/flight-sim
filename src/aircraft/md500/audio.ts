// MD 500E: sound profile (plain data). SCAFFOLD STUB (owner: A1): the Schweizer 300CB's voice on the 500E rotor (5
// blades, the rotor's diameter and drive ratio, so the consistency check holds) until A1 writes the first turbine
// helicopter voice (plan 6.5). A1 reads facts.ts (MD500_ENGINE_RATED_W, MD500_ENGINE_RATIO) once T2 has wired them.
import type { AudioProfile } from '../types';
import { S269_AUDIO as base } from '../s269/audio';
import { MD500_ROTORCRAFT as rotor } from './rotorcraft';

export const MD500_AUDIO: AudioProfile = {
  ...base,
  engines: [{ engine: { ...base.engines[0].engine, gearRatio: rotor.engineRatio },
    prop: { ...base.engines[0].prop, blades: rotor.main.blades as 5, diameterM: rotor.main.radius * 2 } }],
};
