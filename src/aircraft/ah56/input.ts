// Lockheed AH-56A Cheyenne: the input profile. SCAFFOLD STUB (owner after the scaffold: AG; the new profile fields are
// implemented by TW in src/input/**). The MD 500E's until AG sets the AH-56A's: re-centring keyboard cyclic
// (centringCyclic), the pusher twist grip on the propeller keys with snaps at -2.2 / +8 / -12 deg (propLever), the
// tail-wheel lock, the gear lever and the wheel brakes (plan revision 2, sections 0 item 7 and 5).
import type { InputProfile } from '../../input/profile';
import { MD500_INPUT } from '../md500/input';

export const AH56_INPUT: InputProfile = MD500_INPUT;
