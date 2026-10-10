import type { InputProfile } from '../../input/profile';
import { R22_INPUT } from '../r22/input';
// Placeholder position-control sensitivity; spring trim/forces and ENGAGE/HOLD/RELEASE are unfinished.
export const S269_INPUT: InputProfile = { ...R22_INPUT, rotorGovernor: false };
