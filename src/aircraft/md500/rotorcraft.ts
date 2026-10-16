// MD 500E (369E): the RotorcraftDefinition. SCAFFOLD PROVISIONAL (owner: T2).
//
// The GEOMETRY of the rotors is the 500E's from dimensions.ts already (5 blades, R 4.023 m, chord 0.1715 m; 2-blade
// tail rotor R 0.699 m), so the exterior (M2) and the sound (A1) are built on the right rotor from the start. The
// hubs, the DYNAMICS and the drive (engineRatio, tailRatio, nominal/reference rpm, blade masses and inertia, the
// belt clutch, systems) are still the S269's: the stub definition still runs the S269 piston engine, and
// engineRatio 12.594 with that engine would turn the rotor at about 214 rpm. T2 replaces all of them together with
// the 250-C20B, the freewheel and the turboshaft governor (facts.ts: MD500_ENGINE_RATIO, MD500_NR_100, ...).
import { DEG } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { S269_ROTORCRAFT as base } from '../s269/rotorcraft';
import * as D from './dimensions';

export const MD500_ROTORCRAFT: RotorcraftDefinition = {
  ...base,
  main: { ...base.main, radius: D.MAIN_ROTOR_RADIUS, chord: D.MAIN_ROTOR_CHORD, blades: D.MAIN_ROTOR_BLADES,
    twist: D.MAIN_ROTOR_TWIST_DEG * DEG },
  tail: { ...base.tail, radius: D.TAIL_ROTOR_RADIUS, chord: D.TAIL_ROTOR_CHORD, blades: D.TAIL_ROTOR_BLADES,
    twist: D.TAIL_ROTOR_TWIST_DEG * DEG },
};
