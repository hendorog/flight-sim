// The one swashplate law every reader uses: the rotor solver's new branches, the blade pose, the ground rotor and both
// new exteriors (BX, AX import it; they must not read the controls directly as md500/exteriorRotor.ts:139 does).
// Owner after the scaffold: RC. Plan revision 2, section 4 item 5. Legacy rotorcraft.ts sites keep their own text.
import type { ControlInputs } from '../../core/types';
import { cyclicAngles, type RotorcraftDefinition, type RotorcraftState } from './definition';
import { gyroBladeCyclic } from './controlGyro';

/**
 * Blade cyclic, rad: aft (+ = disc aft, elevator +) and right (+ = disc right, aileron +), shaft axes.
 * - A control-gyro type with its state present: the gyro's tilt through the SSL gain (the stick commands moments).
 * - Otherwise the stick law (cyclicAngles), then, on a hingeless hub with `controlPhase`, rotated by the control phase
 *   about the shaft in the rotor's rotation sense. RC owns the sign convention and verifies it with R13 (the steady
 *   hover hub moment turns by the phase). Consistency: a gyro type has no controlPhase (no double rotation).
 */
export function swashplateCyclic(d: RotorcraftDefinition, c: Pick<ControlInputs, 'elevator' | 'aileron'>,
  s?: Pick<RotorcraftState, 'controlGyro'>): { aft: number; right: number } {
  if (d.controlGyro && s?.controlGyro) return gyroBladeCyclic(d, s.controlGyro);
  const base = cyclicAngles(d, c);
  const phase = d.hubModel?.kind === 'hingeless' ? d.hubModel.controlPhase ?? 0 : 0;
  if (!phase) return base;
  const cs = Math.cos(phase), sn = Math.sin(phase) * d.rotation;
  return { aft: base.aft * cs - base.right * sn, right: base.right * cs + base.aft * sn };
}
