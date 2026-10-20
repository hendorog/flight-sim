// Lockheed AH-56A Cheyenne: high-advance-ratio rotor aerodynamics (section model, finer grids, periodic flap damping) and
// the scripted half-P hop. Owner after the scaffold: AH (stage 5). Plan revision 2, section 7.4. Empty at S0.
import type { RotorDefinition } from '../../physics/rotorcraft/definition';
import type { HalfPHopDef } from '../../physics/rotorcraft/halfPHop';

export const AH56_ROTOR_HIGH_SPEED: Partial<RotorDefinition> = {};
export const AH56_HALF_P: HalfPHopDef | undefined = undefined;
