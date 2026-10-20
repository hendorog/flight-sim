// Lockheed AH-56A Cheyenne: the wheel gear (GearConfig). SCAFFOLD STUB (owner after the scaffold: AG): the MD 500E's
// compatibility gear() (skid contact points) until AG builds the retractable tail-wheel gear (tail wheel in the "nose"
// slot aft of the CG, castering with the lock read from gearIn.controls.tailWheelLock; mains FS about 285, track about
// 62 in; 5.00x4 tyres at 100 psi; dimensions.ts) and sets landingGear 'wheels'.
import { MD500_DEFINITION } from '../md500';

export const ah56Gear = MD500_DEFINITION.gear;
