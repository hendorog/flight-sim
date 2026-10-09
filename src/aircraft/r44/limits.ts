// POH 2-9 placards, transcribed from the downloaded figure. See docs/r44-sources.md.
import { FT, LB, clamp } from '../../core/math';
import type { ManifoldPlacard, SpeedPlacard } from '../../physics/rotorcraft/limits';
import { placardMap, placardVne } from '../../physics/rotorcraft/limits';
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
/** Base grid for TOGW ≤2200 lb. Use r44Vne for configuration corrections. Shared HUD wiring is pending. */
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

/** POH 2-1/2-9. TOGW is departure weight, not current fuel-burned mass. SI arguments, result KIAS.
 * Autorotation subtracts 30 from the base grid (100 at SL), superseding the powered 10-kt correction.
 * Doors removed and power above MCP are separate 100 KIAS caps, not altitude-grid offsets. */
export function r44Vne(altitude: number, temperature: number, configuration: {
  takeoffMass: number; powerOff?: boolean; aboveMcp?: boolean; doorsOff?: boolean;
}): number {
  const base = placardVne(R44_VNE, altitude, temperature);
  if (base === 0) return 0;
  const correction = configuration.powerOff ? 30 : configuration.takeoffMass > 2200 * LB ? 10 : 0;
  return Math.max(0, Math.min(base - correction, configuration.aboveMcp || configuration.doorsOff ? 100 : Infinity));
}

/** POH 2-9 MCP, inHg. Full-throttle cells are unbounded, not a numerical MAP requirement.
 * At mixed finite/full-throttle corners use the common interpolator's finite altitude trend. */
export function r44Map(altitude: number, temperature: number): number {
  const rows = R44_MAP.continuous.length - 1, cols = R44_MAP.continuous[0].length - 1;
  const row = clamp(altitude / R44_MAP.altitudeStep, 0, rows);
  const col = clamp((temperature - R44_MAP.temperatureMin) / R44_MAP.temperatureStep, 0, cols);
  const i = Math.min(rows - 1, Math.floor(row)), j = Math.min(cols - 1, Math.floor(col));
  const a = row - i, b = col - j;
  if ([[i, j, (1-a)*(1-b)], [i+1, j, a*(1-b)], [i, j+1, (1-a)*b], [i+1, j+1, a*b]]
    .every(([r, c, w]) => w < 1e-10 || R44_MAP.continuous[r][c] === null)) return Infinity;
  return placardMap(R44_MAP, altitude, temperature);
}

/** POH 2-3/2-4, 21 Feb 2014. Longitudinal stations/lateral arms are inches; mass input kg. */
export function r44CgLimits(mass: number, station: number) {
  const lb = mass / LB;
  return {
    weightAllowed: lb >= 1600 && lb <= 2500,
    forward: 92 + clamp((lb - 2300) / 200, 0, 1),
    aft: 102.5 - 4.5 * clamp((lb - 2100) / 400, 0, 1),
    lateral: 3 - 1.5 * clamp((station - 100) / 2.5, 0, 1),
  };
}
export const R44_LOADING_LIMITS = { minimum: 1600 * LB, seatAndBaggage: 300 * LB, baggage: 50 * LB } as const;
