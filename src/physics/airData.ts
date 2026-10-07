// Air-data sensors: the airspeed indicator's position error (built from the type's AirDataDef, by default the
// Cessna 172S's) and the slip-skid inclinometer.

import { C172S_AIR_DATA, C172S_CONTROLS } from '../aircraft/c172s/systems';
import type { AirDataDef } from '../aircraft/types';
import { C172 } from '../core/c172';
import { DEG, G0, KT, clamp, interp1 } from '../core/math';
import { ISA_SEA_LEVEL } from './atmosphere';

// Static-source position error, after the POH airspeed calibration table (C172S: normal static source) and the
// stall-speed table (C172S: 48 KIAS = 53 KCAS flaps up, 40 KIAS = 48 KCAS flaps 30), as calibrated against
// indicated airspeed (knots) in steady 1-g flight at the reference mass.
//
// The error is a pressure error at the static port, a fixed fraction of dynamic pressure for a given flow
// field around the fuselage, so it is modelled as a function of the lift coefficient (angle of attack) and
// flaps: each table row is converted to the lift coefficient it was flown at. On the take-off roll, at
// small angle of attack, the error is then as small as in cruise rather than as large as at the stall.

export interface AirData {
  /** Indicated airspeed (m/s) for a calibrated airspeed (m/s), flap deflection (rad) and the current lift coefficient. */
  indicatedAirspeed(cas: number, flaps: number, liftCoefficient: number): number;
}

/**
 * The airspeed indicator of a type: `def`'s calibration rows, its wing area (m^2) and the flap travel (rad) whose
 * fraction places the flap deflection between the rows. Between two rows the error is linear in flap degrees.
 */
export function createAirData(def: AirDataDef, wingArea: number, flapTravel: number): AirData {
  /** Lift coefficient in 1-g flight at the reference mass at a calibrated airspeed (kt). */
  const liftCoefficientAt = (casKt: number) => (def.referenceMass * G0) / (0.5 * ISA_SEA_LEVEL.density * (casKt * KT) ** 2 * wingArea);
  /** Position error (CAS - IAS) / CAS against lift coefficient, ascending in CL. */
  const curves = def.calibration.map((row) => ({
    cl: row.cas.map(liftCoefficientAt).reverse(),
    error: row.cas.map((c, i) => (c - row.ias[i]) / c).reverse(),
  }));
  const n = curves.length;
  // The flap position is measured in units of the first row interval: rows at 0, 10 and 30 degrees are 0, 1 and 3.
  const unit = n > 1 ? def.calibration[1].flapDeg - def.calibration[0].flapDeg : 1;
  const at = def.calibration.map((row) => (row.flapDeg - def.calibration[0].flapDeg) / unit);
  // The travel in degrees, to a millionth (30 * DEG / DEG is 29.999999999999996).
  const travelDeg = Math.round((flapTravel / DEG) * 1e6) / 1e6;
  return {
    indicatedAirspeed(cas: number, flaps: number, liftCoefficient: number): number {
      let error = 0;
      if (n === 1) error = interp1(curves[0].cl, curves[0].error, liftCoefficient);
      else if (n > 1) {
        const f = ((clamp(flaps / flapTravel, 0, 1) * travelDeg) - def.calibration[0].flapDeg) / unit;
        let j = 0;
        while (j < n - 2 && f > at[j + 1]) j++;
        const lo = interp1(curves[j].cl, curves[j].error, liftCoefficient);
        const hi = interp1(curves[j + 1].cl, curves[j + 1].error, liftCoefficient);
        error = lo + ((hi - lo) * (f - at[j])) / (at[j + 1] - at[j]);
      }
      return Math.max(cas, 0) * (1 - error);
    },
  };
}

// The Cessna 172S under the names this module has always exported: its calibration rows by flap setting.
const [UP, F10, F30] = C172S_AIR_DATA.calibration;
export const TABLES = {
  up: { cas: UP.cas, ias: UP.ias },
  f10: { cas: F10.cas, ias: F10.ias },
  f30: { cas: F30.cas, ias: F30.ias },
};

const C172S = createAirData(C172S_AIR_DATA, C172.wing.area, C172S_CONTROLS.flaps.maxDeflection);

/**
 * Indicated airspeed (m/s) for a calibrated airspeed (m/s), flap deflection (rad) and the current lift
 * coefficient: the Cessna 172S's.
 */
export function indicatedAirspeed(cas: number, flaps: number, liftCoefficient: number): number {
  return C172S.indicatedAirspeed(cas, flaps, liftCoefficient);
}

/**
 * Inclinometer: the ball reaches the end of the tube at about 6 deg of lateral specific-force angle (~0.1 g).
 * The tube is a shallow arc, so the ball is sensitive: a quarter of rudder at cruise moves it visibly, half rudder
 * puts it about half way out, and a full-rudder sideslip pins it against the end.
 */
const BALL_RANGE = 6 * (Math.PI / 180);

/**
 * Slip-ball deflection (-1..1, + = right) from the body-axis specific force. The ball settles where the
 * tube's local vertical lines up with the specific force; a sideways push on the airframe leaves it behind.
 */
export function slipBall(fy: number, fz: number): number {
  return clamp(-Math.atan2(fy, Math.max(-fz, 1e-3)) / BALL_RANGE, -1, 1);
}
