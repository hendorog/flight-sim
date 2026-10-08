import { R22_DEFINITION } from '../../src/aircraft/r22';
import { createFlightModelFor } from '../../src/physics';
import { cloneControls } from '../../src/core/types';
import { DEG, KT, clamp } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';

const world = flatEnvironment(undefined, 0);
/** A held sea-level ISA atmosphere isolates aircraft dynamics from height lost during a test. */
export const seaLevel = { ...world, atmosphere: () => world.atmosphere(0) };
export const DT = 1 / 240;
export function rig(kias = 65, gross = true) {
  const fm = createFlightModelFor(R22_DEFINITION);
  if (gross) fm.setLoading(R22_DEFINITION.mass.loadings.maxGross);
  fm.reset({ position: { x: 0, y: 0, z: -1000 }, heading: 0, airspeed: kias * KT,
    onGround: false, engineRunning: true, fuelFraction: gross ? 1 : 0.5 }, seaLevel);
  return { fm, c: cloneControls(fm.trimControls) };
}
export type Rig = ReturnType<typeof rig>;
export function run(r: Rig, seconds: number, pilot?: (dt: number) => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) { pilot?.(DT); r.fm.step(DT, r.c, seaLevel); }
}
/** Test pilot only: ordinary cyclic/pedals, no writes to rotor or rigid-body state.
 * PI speed-to-pitch outside a damped attitude loop; collective is left entirely to the caller.
 */
export function attitudePilot(r: Rig, kias = 65) {
  const pitchTrim = r.fm.state.pitch, elevatorTrim = r.c.elevator;
  let pitchI = 0, rollI = 0, yawI = 0, speedI = 0;
  return (dt: number, commandedPitch?: number): void => {
    const s = r.fm.state, heading = Math.atan2(Math.sin(s.heading), Math.cos(s.heading));
    speedI += 0.002 * (s.ias - kias * KT) * dt;
    const target = commandedPitch ?? clamp(pitchTrim + 0.06 * (s.ias - kias * KT) + speedI, -17 * DEG, 17 * DEG);
    pitchI += (target - s.pitch) * 0.25 * dt;
    rollI -= s.roll * 0.25 * dt; yawI -= heading * 0.2 * dt;
    r.c.elevator = clamp(elevatorTrim + 2.5 * (target - s.pitch) - s.angularVelocity.y + pitchI, -1, 1);
    r.c.aileron = clamp(-2.5 * s.roll - 0.8 * s.angularVelocity.x + rollI, -1, 1);
    r.c.rudder = clamp(-2 * heading - 0.7 * s.angularVelocity.z + yawI, -1, 1);
  };
}
