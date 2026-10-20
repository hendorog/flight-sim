// Fixed wing of a compound rotorcraft (AH-56A stage 3): the contract and an S0 stub. Owner after the scaffold: AC.
// Plan revision 2, section 7.3. Seam (S0, airframe.ts, RC keeps it): airframeLoads calls wingLoads after the
// stabiliser when `d.wings` exists, with the same `add(point, force)` accumulator, and returns the wing power in a
// separate `wings` field (never in the legacy power object); Rotorcraft publishes it in `compoundPower.wings`.
import type { Vec3 } from '../../core/math';
import type { BodyState } from '../interfaces';
import type { Table1D } from './controlGyro';

export interface WingPanelDef {
  /** 1 right panel, -1 left: each panel has its own local flow (roll damping and dihedral effect emerge). */
  side: 1 | -1;
  /** Panel quarter-chord MAC point, body FRD m. */
  centre: Vec3;
  /** m^2, m, 1/rad, -, -, - (195 ft^2 total, span 4.069 m per panel, AR 3.66; P / D). */
  area: number; span: number; liftSlope: number; maxCl: number; cd0: number; inducedK: number;
  /** Root setting to the body x axis, rad (L 11 deg 52 min, R 12 deg 58 min P; datum unstated: AC checks it). */
  incidence: number;
  /** Camber of the trailing-edge extension, rad (ESTIMATE). */
  zeroLiftAlpha: number;
  /** 5 deg P. */
  dihedral: number;
  /**
   * Rotor-wake factor on the panel as a function of wake skew chi = atan(mu / lambda), rad: the hover download and a
   * documented 150 kt value (about 0.8 deg of downwash, 10-15 % of the wing lift at 50 % rotor lift). Plain table.
   */
  washBySkew: Table1D;
}

/** S0 STUB: no load. Returns the wing power, W (sum of add()'s return values). */
export function wingLoads(_wings: readonly WingPanelDef[], _b: BodyState, _air: Vec3, _density: number, _meanInflow: number,
  _skew: number, _add: (point: Vec3, force: Vec3) => number): number {
  return 0;
}
