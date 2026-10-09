// POH 2-9 placards, transcribed from the downloaded figure. See docs/r44-sources.md.
import { FT } from '../../core/math';
import type { ManifoldPlacard, SpeedPlacard } from '../../physics/rotorcraft/limits';
export const R44_ROTOR_LIMITS = { powerOn: [101, 102], powerOff: [90, 108], lowWarning: 97 } as const;
export const R44_MAP: ManifoldPlacard = {
  altitudeStep: 2000 * FT, temperatureMin: 243.15, temperatureStep: 10, takeoffIncrease: 2.8,
  continuous: [
    [21.5, 21.8, 22.1, 22.4, 22.6, 22.9, 23.1, 23.3],
    [20.9, 21.2, 21.5, 21.8, 22.1, 22.3, 22.5, 22.8],
    [20.4, 20.7, 21.0, 21.3, 21.5, 21.8, 22.0, 22.2],
    [19.9, 20.2, 20.5, 20.8, 21.0, 21.3, 21.5, 21.7],
    [19.5, 19.8, 20.1, 20.3, 20.6, 20.8, 21.0, 21.3],
    [19.1, 19.4, 19.6, 19.9, null, null, null, null],
    [null, null, null, null, null, null, null, null],
  ],
};
/** Base grid for TOGW ≤2200 lb. PLACEHOLDER: weight/power-off/doors-off corrections not yet applied. */
export const R44_VNE: SpeedPlacard = {
  altitudeStep: 2000 * FT, temperatureMin: 243.15, temperatureStep: 10,
  kias: [
    [130, 130, 130, 130, 130, 130, 130, 130],
    [130, 130, 130, 130, 130, 130, 127, 123],
    [130, 130, 130, 130, 126, 122, 118, 114],
    [130, 130, 126, 122, 117, 113, 108, 103],
    [126, 122, 117, 112, 107, 101, 96, 91],
    [117, 112, 106, 101, 95, 90, 85, 0],
    [107, 101, 95, 89, 0, 0, 0, 0],
    [95, 89, 0, 0, 0, 0, 0, 0],
  ],
};
