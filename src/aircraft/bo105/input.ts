// MBB Bo 105 CB-4: the input profile. Owner: BO (the profile fields are TW's, src/input/**).
//
// Two overhead power levers OFF - IDLE - FLIGHT on ControlInputs.engines[i].throttle with the stops of facts.ts
// BO105_POWER_LEVER (consistency: twistGrip deep-equals systems.turboshaft.grip); the engine-select keys 8 / 9 / 0 choose
// the lever (TW: src/input). ENGINE TRIM fore/aft (n2Beep: both N2) and left/right (n2BeepSplit: the torque split) on the
// collective head (P5 FM 7-12). Electric cyclic trim with feel springs (P5 FM 7-24). The keyboard cyclic is a
// position command (non-centring), as on the other helicopters; no mixture, carburettor heat or primer: turboshafts.
//
// Keyboard axes (plan 6.2, input only; the dynamics stay as calibrated): the Bo 105 rolls about 1.25 deg/s per % of
// lateral travel with a 0.12 s roll time constant at 80 KIAS (AR-280, D), about 1.5-2 x the MD 500E's, so the aileron
// key moves the stick more slowly (baseRate 0.03, maxRate 0.22, accelTime 1.5 against the MD 500E's 0.05 / 0.35 / 1.2)
// and the elevator key at baseRate 0.04; the mouse yoke's expo 0.9 and a 0.02 dead zone. ESTIMATE starting values,
// checked by the tap-to-bank row (a 1 s lateral key tap at 80 KIAS gives 8-14 deg of bank, tests/rotorcraft/
// bo105Handling.test.ts).
import type { InputProfile } from '../../input/profile';
import { MD500_INPUT } from '../md500/input';
import { BO105_POWER_LEVER } from './facts';

const md = MD500_INPUT, mdAxes = md.assists.axes!;

export const BO105_INPUT: InputProfile = {
  ...md,
  engines: 2,
  engineLever: 'overheadPowerLevers',
  twistGrip: { ...BO105_POWER_LEVER },
  n2Beep: true,
  n2BeepSplit: true,
  springTrim: true,
  mouseYoke: { expo: 0.9, deadzone: 0.02 },
  assists: { ...md.assists, axes: {
    elevator: { ...mdAxes.elevator, baseRate: 0.04 },
    aileron: { ...mdAxes.aileron, baseRate: 0.03, maxRate: 0.22, accelTime: 1.5 },
    rudder: mdAxes.rudder,
  } },
  // The power levers' texts come from the engineLever profile (bindings.ts); the MD 500E's twist-grip labels are dropped.
  labels: { pitchUp: 'Cyclic aft', pitchDown: 'Cyclic forward', rollLeft: 'Cyclic left', rollRight: 'Cyclic right',
    rudderLeft: 'Left pedal', rudderRight: 'Right pedal', flapsUp: 'Lower collective (hold)', flapsDown: 'Raise collective (hold)',
    trimNoseUp: 'Cyclic trim aft (hold)', trimNoseDown: 'Cyclic trim forward (hold)',
    rudderTrimLeft: 'Cyclic trim left (hold)', rudderTrimRight: 'Cyclic trim right (hold)',
    fuelPump: 'Fuel pumps', starter: 'STARTER/GENERATOR to START (hold)' },
};
