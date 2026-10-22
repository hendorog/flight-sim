// Lockheed AH-56A Cheyenne: the RotorcraftDefinition ASSEMBLY. FROZEN at the scaffold (integrator-owned). Plan revision
// 2, section 2.3. Each stage owns one input file, so the stages never edit the same file:
//   base.ts       AG  the helicopter (rotor, hub, drive, T64, wheels, airframe)        stage 2
//   gyro.ts       AG  the control gyro configurations                                  stage 2
//   compound.ts   AC  wing, pusher and the airframe aero they change (applied last)     stages 3-4
//   highSpeed.ts  AH  section model, grids, periodic damping; the half-P event         stage 5
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { AH56_BASE } from './base';
import { AH56_GYRO } from './gyro';
import { AH56_COMPOUND } from './compound';
import { AH56_HALF_P, AH56_ROTOR_HIGH_SPEED } from './highSpeed';
import { mergeDefinition } from './patch';

export const AH56_ROTORCRAFT: RotorcraftDefinition = mergeDefinition(AH56_BASE,
  { ...(AH56_GYRO ? { controlGyro: AH56_GYRO } : {}), ...(AH56_HALF_P ? { halfPHop: AH56_HALF_P } : {}) },
  { main: AH56_ROTOR_HIGH_SPEED },
  AH56_COMPOUND);
