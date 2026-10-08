import { FT } from '../../core/math';
import { placardVne, type SpeedPlacard } from '../../physics/rotorcraft/limits';

/** POH 2-2, 2-9. The yellow arcs are usable power-off; they are not a power-on green arc. */
export const R22_ROTOR_LIMITS = { powerOn: [101, 104], powerOff: [90, 110], lowWarning: 97 } as const;

// POH 2-11 Beta II placard: columns −20 to +40°C, rows SL to 14,000 ft in 2,000 ft steps.
// Zero denotes a NO FLIGHT cell. Interpolation next to such a cell stays conservatively outside the envelope.
export const R22_VNE: SpeedPlacard = {
  altitudeStep: 2000 * FT, temperatureMin: 253.15, temperatureStep: 10, kias: [
  [102, 102, 102, 102, 102, 102, 102],
  [102, 102, 102, 102, 102, 99, 96],
  [102, 102, 102, 98, 94, 91, 87],
  [102, 98, 94, 90, 87, 82, 77],
  [94, 90, 86, 80, 75, 69, 64],
  [86, 80, 74, 68, 62, 57, 0],
  [74, 67, 61, 0, 0, 0, 0],
  [61, 0, 0, 0, 0, 0, 0],
  ],
};
export function r22Vne(pressureAltitude: number, temperature: number): number {
  return placardVne(R22_VNE, pressureAltitude, temperature);
}
