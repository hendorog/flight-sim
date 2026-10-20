// MBB Bo 105 CB-4: sound profile (plain data). SCAFFOLD STUB (owner after the scaffold: AU): the MD 500E's turbine voice
// twice (one per 250-C20B) on the Bo 105 rotor (4 blades, 9.84 m, the drive ratio), with engine 2's rotor voice muted
// (a twin must not double the rotor). AU's rule (plan revision 2, section 7.7): every consistency-checked number is
// imported from the definition, powerplant or facts, never typed in.
import type { AudioProfile } from '../types';
import { MD500_AUDIO as base } from '../md500/audio';
import { BO105_ROTORCRAFT as rotor } from './rotorcraft';
import { BO105_ENGINE_RATED_W } from './facts';

const engine = { ...base.engines[0].engine, gearRatio: rotor.engineRatio, ratedPowerW: BO105_ENGINE_RATED_W };
const prop = { ...base.engines[0].prop, blades: rotor.main.blades as 4, diameterM: rotor.main.radius * 2 };

export const BO105_AUDIO: AudioProfile = {
  ...base,
  engines: [{ engine, prop }, { engine, prop: { ...prop, level: 0 } }],
  tailRotor: { ...base.tailRotor!, blades: rotor.tail.blades as 2, diameterM: rotor.tail.radius * 2, ratio: rotor.tailRatio },
};
