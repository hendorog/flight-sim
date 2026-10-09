import type { InputProfile } from '../../input/profile';
import { R22_INPUT } from '../r22/input';
/** PLACEHOLDER position-input tuning. Hydraulic cyclic/collective have no simulated feedback force. */
export const R44_INPUT: InputProfile = {
  ...R22_INPUT, has: { ...R22_INPUT.has, carbHeat: false, fuelPump: true },
};
