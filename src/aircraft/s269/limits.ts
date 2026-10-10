import { FT } from '../../core/math';
import type { SpeedPlacard } from '../../physics/rotorcraft/limits';
import { S269_REFERENCE as V } from './reference';
// RFM 2-2 Vne placard: original columns 0/4/6/8/10/12 thousand ft, rows 0..120°F.
// Insert the linearly interpolated 2000 ft row for the existing uniform-grid reader.
// Zero preserves the printed dash/no-flight cells; interpolation is not chart-reading precision.
const rows = [
  [94, 94, 94, 94, 83, 63], [94, 94, 94, 92, 73, 53], [94, 94, 94, 82, 62, 0],
  [94, 94, 91, 71, 53, 0], [94, 94, 82, 61, 0, 0], [94, 92, 73, 53, 0, 0], [94, 85, 64, 0, 0, 0],
];
export const S269_VNE: SpeedPlacard = {
  altitudeStep: 2000 * FT, temperatureMin: 273.15 - 32 * 5 / 9, temperatureStep: 20 * 5 / 9,
  kias: [rows.map(r => r[0]), rows.map(r => (r[0] + r[1]) / 2),
    ...Array.from({ length: 5 }, (_, i) => rows.map(r => r[i + 1]))],
};

/** RFM 2-5/2-6: absolute RPM, not percent tach markings. FAA 4H12 rev32 says engine
 * minimum 2534; the selected RFM says 2530. The discrepancy remains unresolved. */
export const S269_RPM_LIMITS = { engine: [2530, V.engineRpm100], powered: V.rotorPowerOn, autorotation: V.rotorPowerOff } as const;
/** RFM 2-5: fixed longitudinal/lateral envelope in datum inches. No minimum mass is stated here. */
export const S269_CG_LIMITS = { forward: 95, aft: 101, left: -2.5, right: 4 } as const;
