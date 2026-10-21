// Numbers a helicopter's sound profile derives from its rotor definition, so a voice follows the flight model
// without an edit when the definition changes (plan revision 2, section 7.7, the import rule). Pure: types only.

import type { RotorcraftDefinition } from '../physics/rotorcraft/definition';

/** Sea-level ISA density, kg/m^3. */
const RHO0 = 1.225;
/** Hover figure of merit of a main rotor, for the tail rotor's hover thrust. ESTIMATE (0.6-0.75 is usual). */
export const HOVER_FIGURE_OF_MERIT = 0.7;

/**
 * The tail rotor's thrust in a sea-level hover at main-rotor thrust `thrustN`, N (D): the main rotor's hover power
 * P = T^1.5 / sqrt(2 rho A) / FM, its torque P / Omega at the nominal rotor speed, over the tail arm (the distance
 * along the body x axis between the main and tail hubs of the definition). The voice's `hoverThrustN` (tailLoad 1).
 */
export function tailHoverThrustN(rotor: RotorcraftDefinition, thrustN: number, figureOfMerit = HOVER_FIGURE_OF_MERIT): number {
  const area = Math.PI * rotor.main.radius ** 2;
  const power = thrustN ** 1.5 / Math.sqrt(2 * RHO0 * area) / figureOfMerit;
  const omega = (rotor.nominalRpm * 2 * Math.PI) / 60;
  const arm = Math.abs(rotor.tail.hub.x - rotor.main.hub.x);
  return power / omega / arm;
}

/** Blade-passage frequency of `blades` at `rpm`, Hz. */
export const bladePassageHz = (blades: number, rpm: number): number => (blades * rpm) / 60;
