// Lockheed AH-56A Cheyenne: the control gyro data (ICS 1972 and AMCS 1973 configurations). Owner after the scaffold: AG
// (stage 2). Plan revision 2, section 7.2. Undefined until AG lands the gyro: the S0 stub flies the stick as cyclic
// position. The ICS / AMCS selector (URL config=, InitialConditions.rotorcraftConfig) is plumbed from S0.
import type { ControlGyroDef } from '../../physics/rotorcraft/controlGyro';

export const AH56_GYRO: ControlGyroDef | undefined = undefined;
