// Powerplant provider ('powerplant'): the propeller lever and propeller speed every constant-speed type has, and
// the gas-generator readings of a turbine (Ng, ITT, propeller-shaft torque) that the core provider's piston
// signals (rpm, mags, oil) cannot show. Contract 3.9 / instructor spec step 4 ("type-specific providers").
//
// Engine 0 only, like the core provider's engine signals. On a piston or FADEC type the turbine signals read 0
// (never NaN), so a frame stays fully defined whatever the type.

import { engineControl } from '../../../core/types';
import type { SignalDef, SignalFrame, SignalProvider, TelemetrySources } from '../../types';
import { defineSignals } from './define';

/** N m to ft lbf. */
const FT_LBF_PER_NM = 1 / 1.3558179;

export const POWERPLANT_SIGNALS: readonly SignalDef[] = defineSignals([
  ['prop.lever', 'number', '', 0, 'Propeller lever 0..1 (1 high rpm; below 0.08 feather)'],
  ['prop.rpm', 'number', 'rpm', 10, 'Propeller speed (Np on a free turbine)'],
  ['turbine.ng', 'number', '%', 0.5, 'Gas-generator speed Ng, % (0 on a piston engine)'],
  ['turbine.itt', 'number', 'degC', 5, 'Inter-turbine temperature, deg C (0 on a piston engine)'],
  ['turbine.torqueFtLb', 'number', 'ft lbf', 20, 'Propeller-shaft torque, ft lbf (0 on a piston engine)'],
]);

export function createPowerplantProvider(): SignalProvider {
  return {
    id: 'powerplant',
    defs: POWERPLANT_SIGNALS,
    sample(out: SignalFrame, src: TelemetrySources): void {
      const e = src.state.engine, turbine = e.ng !== undefined;
      out['prop.lever'] = engineControl(src.controls, 0, 'propeller');
      out['prop.rpm'] = e.propRpm;
      out['turbine.ng'] = turbine ? e.ng ?? 0 : 0;
      out['turbine.itt'] = turbine ? e.itt ?? 0 : 0;
      out['turbine.torqueFtLb'] = turbine ? propShaftTorqueFtLb(e.torque, e.rpm, e.propRpm) : 0;
    },
  };
}

/**
 * Torque at the propeller shaft, ft lbf, from the power turbine's (EngineState.torque, N m) through the reduction
 * gear (power-turbine rpm / propeller rpm). 0 with the propeller (nearly) stopped.
 */
export function propShaftTorqueFtLb(torqueNm: number, rpm: number, propRpm: number): number {
  return propRpm > 1 && rpm > 0 ? (torqueNm * rpm / propRpm) * FT_LBF_PER_NM : 0;
}
