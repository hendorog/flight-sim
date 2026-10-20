// MBB Bo 105 CB-4: the input profile. SCAFFOLD STUB (owner after the scaffold: BO; the new profile fields are
// implemented by TW in src/input/**).
//
// Two engines (engine-select keys 8/9/0 move the selected overhead power lever OFF - IDLE - FLIGHT on
// ControlInputs.engines[i].throttle with the twistGrip stops), ENGINE TRIM fore/aft (n2Beep) and left/right
// (n2BeepSplit), electric spring trim, position-command (non-centring) keyboard cyclic. The stub keeps the MD 500E's
// lever stops (they deep-equal the stub rotorcraft's turboshaft.grip); BO moves both to facts.ts BO105_POWER_LEVER and
// tunes the keyboard axes (plan revision 2, section 6.2: aileron baseRate 0.03, maxRate 0.22, accelTime 1.5).
import type { InputProfile } from '../../input/profile';
import { MD500_INPUT } from '../md500/input';

export const BO105_INPUT: InputProfile = {
  ...MD500_INPUT,
  engines: 2,
  engineLever: 'overheadPowerLevers',
  n2BeepSplit: true,
};
